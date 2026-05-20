---
name: Sentinel check perf metrics
description: Per-check latency/retries/queue-depth via sentinel_check_runs + v_sentinel_check_perf_24h + /admin/sentinel-perf
type: feature
---
Per-sentinel-check performance tracking.

- Table `public.sentinel_check_runs` — one row per `(tick_id, check_key)` with `duration_ms`, `candidates_emitted`, `alerts_dispatched`, `alert_retries`, `open_depth_after`, `error`. Operator-only RLS, realtime on.
- View `v_sentinel_check_perf_24h` — per `check_key` over 24h: runs, errors, p50/p95/max ms, total candidates/alerts/retries, avg open depth, last_run_at.
- `sentinel-tick` change: each check runs inside `timeCheck(key, fn)`; candidates are tagged with `__check_key`; persist loop bumps `alerts`/`retries` per check; open depth sampled from existing post-persist snapshot (no extra query); rows batch-inserted at end of tick.
- `dispatchAlert` now returns `{ delivered, attempts }`. `retries = max(0, attempts - 1)` per alert.
- UI: `/admin/sentinel-perf` sortable table + last-50 drawer with bar chart. Linked from `/admin/edge-health` and via slowest-3 pill on `/morning-review` (`TimelineNowChip`).
- Visual flags only — no sentinel-on-sentinel alert when a check is slow or backed up.
- Backfill: none. Metrics start from first tick after migration.
