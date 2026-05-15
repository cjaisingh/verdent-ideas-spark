# Clear stale sentinel findings and reset the night shift

## What the data actually shows

The three "stalled cron" findings are **false positives**:

- `cron.job_run_details`: `sentinel-tick`, `overnight-phase-runner-15m`, `morning-review` all running on schedule (sentinel-tick last fired 21:00 UTC today, morning-review 06:00 UTC today).
- `automation_runs`: 96 runs in last 24h for both 15-min crons; morning-review last ran today.
- The two open `cron_silence` findings are dated 2026-05-09 17:17 and have never been auto-resolved despite the cron being healthy ever since.

So nothing is actually broken in the cron schedule. What **is** broken is the sentinel auto-resolve loop — findings from May 9 should have been cleared on the next tick. Discussion action `45032d7d` ("Reactivate stalled crons") is chasing a phantom.

## Plan

### Step 1 — Trigger sentinel-tick once and observe
Invoke `sentinel-tick` directly via `curl_edge_functions`. Check the response for `resolved: N` and re-query `sentinel_findings` to see if the three stale rows flipped to `resolved`.

### Step 2a — If auto-resolve worked
The issue is "auto-resolve only runs on the cron's own cadence and we're impatient" → just close discussion_action `45032d7d` as `done` with a note pointing at the corrected state. No code change.

### Step 2b — If auto-resolve did NOT work
There's a real bug in the resolve loop (likely RLS on `sentinel_findings.update` or a status enum mismatch). Then:
- Migration: `UPDATE public.sentinel_findings SET status='resolved', resolved_at=now() WHERE id IN (...3 ids...)` to unblock the dashboard.
- Read `sentinel-tick/index.ts` lines 167–180, add error logging to the update, and inspect RLS on `sentinel_findings`. Fix whichever is silently swallowing the update.
- Add a test in `sentinel-tick/checks_test.ts` covering "open finding whose dedupe_key no longer fires gets resolved".

### Step 3 — Close the discussion action
Mark `discussion_actions.id = 45032d7d-...` as `done` with a note: "Crons were never actually stalled — automation_runs shows 96 ticks/24h. Stale sentinel findings cleared. Root cause: [auto-resolve worked late | bug fixed in step 2b]."

### Step 4 — Confirm tonight's path
Re-check (read-only) that for tonight there is still:
- 0 night-eligible discussion_actions
- 0 phases with `run_overnight=true`

If yes, tell the operator explicitly that the crons will tick but no phase work will happen overnight unless they queue something before 21:55 UTC, and offer to flag a specific phase.

## Out of scope

- No new features. No schema changes beyond the targeted update in step 2b if needed.
- Not touching the broader cron infrastructure or model-policy.
- Not queuing phases for overnight without operator approval — that's a separate decision.

## Technical notes

- `sentinel-tick` runs with service role; if the auto-resolve `update` is failing it'll be silent because the result isn't checked. Step 2b would add `.select('id')` + log on the update.
- The three finding IDs:
  - `1e94d481-9d14-4787-8bad-a5fd67433537` (sentinel-tick)
  - `c0c0329b-c248-4e30-8e15-917dff2b1e4f` (overnight-phase-runner-15m)
  - one more for morning-review (need to re-query; the earlier list showed only the two high-sev)
