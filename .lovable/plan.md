## What failed overnight

I traced "nothing happened overnight" to a single root cause: **the cron jobs are firing on schedule, but every overnight edge function rejects them with 401 because the service token they look up doesn't exist in the database.**

### Evidence

1. `cron.job_run_details` — every scheduled tick succeeds at the *cron* level:
   - `night-agent-open` fired 22:00 UTC ✅
   - `overnight-phase-runner-15m` fired every 15 min from 21:00 → 03:30 UTC ✅
   - `night-agent-close` is scheduled for 06:00 UTC (still in the future today)

2. `automation_runs` for the same window — almost empty:
   - No `night-agent-open` row.
   - No `overnight-phase-runner-15m` rows.
   - The only entry is `qa-validate` at 16:00 UTC yesterday with status `error`, message: **"Missing service token and no Authorization header."**

3. Edge function logs for `night-agent` and `overnight-phase-runner` over the last 12h: **none** (they exit at the auth gate before logging).

4. `night_shifts` — last row started 2026-05-08 11:03 UTC and is still `status='running'`. No new shift was opened at 22:00 UTC, no shift was closed at 06:00, so the schedule has been silently dead since at least Wednesday.

5. `night_observations` table is empty.

6. `roadmap_phase_overnight_runs` is empty — no phase was queued by the operator, so even if the runner authenticated, it would still have nothing to execute.

7. `discussion_actions` with `night_eligible=true AND status='open'` → **0 rows**. Even a healthy night-agent would have nothing in its work queue.

### Root cause

The cron jobs read the token from the database, not from the edge-function environment:

```sql
-- night-agent-open / -close
'x-service-token', (SELECT value FROM public.app_secrets WHERE key = 'AWIP_SERVICE_TOKEN' LIMIT 1)

-- overnight-phase-runner-15m
'x-service-token', (select decrypted_secret from vault.decrypted_secrets where name = 'AWIP_SERVICE_TOKEN' limit 1)
```

But `public.app_secrets` is **empty** (`SELECT key FROM app_secrets` returns 0 rows). The vault entry is almost certainly missing too — same symptom on the runner.

`AWIP_SERVICE_TOKEN` *is* configured as an edge-function env var, which is why functions invoked from the UI work, but cron has no way to read function env vars. So every cron-triggered call ships an empty `x-service-token` header, `night-agent/index.ts` line 36–37 fails the equality check, and the function returns 401 before doing any work.

### Why this looks like "nothing happened"

- 22:00 open: rejected at the door → no shift, no observations, no proposals.
- Every 15 min runner: rejected at the door → no overnight phase work (and the queue was empty anyway).
- 06:00 close: even if it lands, there is nothing to close because the shift was never opened.

There are also two secondary issues worth noting but they're not the cause of the overnight blackout:
- `night_eligible` is not set on any open `discussion_actions`, so the night agent has nothing to audit even when it does run. This is an operator-facing decision, not a bug.
- No operator queued any phases via "Run overnight", so the phase runner had no rows to execute regardless.

## Proposed fix (for the next plan/build cycle)

1. **Populate the service token in the database**
   - Insert `AWIP_SERVICE_TOKEN` into `public.app_secrets` (used by night-agent crons).
   - Insert the same value into `vault.secrets` under the name `AWIP_SERVICE_TOKEN` (used by `overnight-phase-runner-15m`).
   - The value must match the `AWIP_SERVICE_TOKEN` already configured as an edge-function secret. Because this is environment-specific data, do this via the **insert** tool / Cloud secrets UI, not via a migration (per the cron-secret guidance).

2. **Standardise the lookup source.** Two crons read from `app_secrets`, one from `vault`. Pick one (recommendation: `vault.decrypted_secrets`) and update the three cron job bodies so we never have this split-brain again.

3. **Make silent 401s loud.** Add an `automation_runs` row with `status='error', message='unauthorized'` from inside `night-agent/index.ts` and `overnight-phase-runner/index.ts` *before* returning 401. Today the auth failure leaves zero trace anywhere, which is exactly why this went undetected. Optionally fire an entry into `alert_log` so the existing alert webhook surfaces it.

4. **Backfill / verify**
   - Re-run `night-agent/open` once the token is set so we get a healthy shift today.
   - Manually close the stale `night_shifts` row from 2026-05-08 (status `running`, never ended) so the dashboard isn't lying about an active shift.

5. **(Optional, separate task)** Surface "no eligible discussion_actions" and "no queued overnight phases" in `AutomationPanel` so an empty work queue is distinguishable from a broken pipeline at a glance.

### Technical notes

- Files touched if you approve step 2/3:
  - `supabase/functions/night-agent/index.ts` (log-then-401)
  - `supabase/functions/overnight-phase-runner/index.ts` (log-then-401, switch lookup)
  - Three `cron.job` bodies updated via `cron.alter_job` (insert tool).
- No schema changes, no RLS changes, no new tables.
- Step 1 is the only thing that has to happen tonight to unblock the overnight pipeline; everything else is hardening.
