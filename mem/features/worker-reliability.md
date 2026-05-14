---
name: worker-reliability
description: Heartbeat + reclaim + retry caps for overnight jobs and night shifts (Hermes slice 1)
type: feature
---

Pattern for any long-running queued worker in AWIP. Imported from Hermes Agent v0.13.0 to kill the "ran overnight, nothing happened, no one knows why" class of failure.

## Schema contract

Tables that carry the columns: `roadmap_phase_overnight_runs`, `night_shifts`. Any new queued-job table of the same shape MUST add:

- `heartbeat_at timestamptz`
- `attempts int default 0`
- `max_retries int default 3`
- `last_error text`

Statuses extended with `auto_blocked` (terminal — operator must clear).

## Worker contract (`overnight-phase-runner`, `night-agent/open`)

1. On pickup: `attempts = attempts + 1`, `status = 'running'`, `heartbeat_at = now()`.
2. While running: heartbeat every 30s via `setInterval` guarded on `status='running'`.
3. On success: `status = 'done'`, clear `last_error`.
4. On failure: write `last_error`. If `attempts < max_retries` requeue (`status='queued'`), else `status='auto_blocked'`.
5. `night-agent/open` heartbeats per audited candidate, not just per shift.

## Reclaim path

`public.reclaim_stale_night_jobs(_stale_minutes int default 5)` — reverts `running` rows whose `heartbeat_at` is older than the threshold to `queued` (or `auto_blocked` if `attempts >= max_retries`). Called by `sentinel-tick` every tick. **Never call from the worker itself** — that's how you get double-reclaim races.

## Sentinel

`night_jobs_stalled` (medium severity) fires when reclaim returns rows. Rolled into Morning Review.

## UI

`/master-plan` and `/morning-review` show `attempts/max_retries` chip and red `auto-blocked` pill. Clearing requires operator action (no silent retry-from-zero).

## Anti-patterns

- Silent `try/catch {}` in the runner — failures must populate `last_error`.
- Skipping the `attempts` bump on pickup — defeats the retry cap.
- Hand-resetting `auto_blocked` rows without recording why in `last_error` or a discussion_action.
- Calling `reclaim_stale_night_jobs` from anywhere except `sentinel-tick`.
