## Reality check (read live, not from cached findings)

Open findings right now: **3**, not 8. And only one of them is a real signal.

| Finding | What the DB actually says | Verdict |
|---|---|---|
| `job_error_rate` sentinel-tick 48 err / 24h (46%) | 1h window = 1 error. All 48 errors clustered around the `AWIP_SERVICE_TOKEN` rotation. Auto-decaying. | **Detector too wide**, not a real fire. |
| `approvals_stale` 324h | `approval_queue` truly has no rows newer than 2026-05-06. | **Real-but-noise**: detector measures wrong thing (last-created, not pending-eligible). |
| `whats_new_drafts_stale` 445 | Backlog real; schema has `archived` status but sweep never ran. | **Real backlog**, mechanical. |

Telegram `reregister`: green on every tick from 04:15 UTC onward. The one 5:00 UTC `upstream_request_failed` was a transient connector-gateway hiccup with no Telegram-side `last_error_date`. **No fix needed.**

## Plan — 3 small slices, in order

### Slice 1 — `job_error_rate` window tightening *(highest leverage, ~20 min)*

In `supabase/functions/sentinel-tick/checks.ts`:

- Fire `high` only when **errors_1h ≥ 5** OR **errors_24h ≥ 20 AND errors_1h ≥ 1**.
- Drop `info` finding when `errors_24h > 0` but `errors_1h = 0` (stale spike, don't surface).
- Keep dedupe key per job.

Result: today's stale spike auto-resolves on next tick.

### Slice 2 — `approvals_stale` detector fix *(~15 min)*

Currently: `now() - max(approval_queue.created_at) > 168h`. Wrong: it fires forever if the operator simply has nothing waiting on them.

Change to: fire only when **`approval_queue` has ≥ 1 row with `status='pending'`** AND its `created_at > 168h ago`. No pending row → no finding.

### Slice 3 — `whats_new` bulk archive sweep *(~15 min)*

One-shot migration: archive `whats_new_entries` rows where `status='draft' AND created_at < now() - interval '7 days'`. Plus a `retention-sweep` cron entry to keep it ongoing (auto-archive drafts > 7d old).

## Stop point

After these three slices, open findings should be **0 high / 0 medium**. I stop there per your "stop on first green signal" rule. Lint debt (517 occurrences across 106 files), CodeQL operator click, and edge-fn audit follow-ups are real but separate work — I'll list them once findings are clean and you pick.

## Technical notes

- All three changes are in `supabase/functions/sentinel-tick/{checks.ts,index.ts}` plus one migration for the whats-new archive backfill + cron registration.
- No new tables, no new edge functions, no contract changes.
- Verification: after deploy I'll re-query `sentinel_findings status='open'` and paste the count. Not claiming done until it shows 0.

## What I am NOT doing in this pass

- Telegram diagnosis (not broken)
- Lint shrink (real but separate session — needs scope decision)
- CodeQL / audit follow-ups (operator clicks, not code)
- Touching anything in `app-walkthrough` / `ci-status-sync` (already removed from cadence map last turn)
