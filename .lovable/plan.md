## Goal

Per-sentinel-check performance metrics so you can see which checks are slow, noisy, or backed up — not just the aggregate `compute:run_checks` step that exists today.

## What's there now

`sentinel-tick` runs ~28 check functions inside one `recordStep("compute:run_checks", ...)` block. The whole batch shares one `duration_ms`. There's no per-check timing, no per-check candidate count, no queue-depth signal, and `dispatchAlert` retries (if any) aren't counted anywhere.

## What this adds

### 1. New table `sentinel_check_runs`

One row per (tick, check kind). Operator-only RLS, realtime on.

| Column | Notes |
|---|---|
| `id`, `created_at` | standard |
| `tick_id uuid` | groups all rows from one tick |
| `check_kind text` | e.g. `five_xx_spike`, `voice_pipeline_red` — matches existing finding kinds |
| `duration_ms int` | wall-time of just that check fn |
| `candidates_emitted int` | findings produced this tick |
| `alerts_dispatched int` | high/critical alerts fired |
| `alert_retries int` | retry attempts inside `dispatchAlert` (0 if first try succeeded) |
| `open_depth_after int` | `count(sentinel_findings where kind=X and status='open')` after persist |
| `error text` | non-null when the check threw |

Indexes: `(check_kind, created_at desc)`, `(tick_id)`.

### 2. View `v_sentinel_check_perf_24h`

Per `check_kind` over last 24h: `runs`, `errors`, `p50_ms`, `p95_ms`, `max_ms`, `total_candidates`, `total_alerts`, `total_retries`, `avg_open_depth`, `last_run_at`.

### 3. `sentinel-tick` instrumentation

- Add a tiny `timeCheck(kind, fn)` helper that wraps each check call, captures duration + error, accumulates results into both `candidates` (existing flow) and a `perCheck` map.
- Replace the giant `[...checkX(), ...checkY()]` spread with a loop over an array of `{ kind, fn }` entries so timing is uniform.
- Instrument `dispatchAlert` to return `{ ok, attempts }` and accumulate `alert_retries` into the per-check tally (attempts − 1 on success, attempts on final failure).
- After the persist loop, single batched `insert` into `sentinel_check_runs` with one row per check kind, including `open_depth_after` from a grouped count query (`select kind, count(*) from sentinel_findings where status='open' and kind = any($kinds) group by kind`).
- Keep the existing `compute:run_checks` `automation_steps` row as the umbrella — don't double-record.

### 4. UI: `/admin/sentinel-perf`

- Sortable table from `v_sentinel_check_perf_24h`: kind, runs, errors, p50, p95, max, candidates, alerts, retries, open depth, last run.
- Row click → drawer with last 50 ticks for that kind: tiny inline bar chart of `duration_ms`, list with timestamp / candidates / alerts / retries / error.
- Highlight rules (visual only, no alerting):
  - `p95_ms > 500` → amber row
  - `errors > 0` in window → red row
  - `avg_open_depth > 10` → amber "backed up" badge
- Realtime subscribe to `sentinel_check_runs` so the table updates as ticks land.

### 5. Surfacing

- Add a "Sentinel checks" tab on `/admin/edge-health` linking to the new page.
- Add a top-3-slowest-checks line to the existing `TimelineNowChip` block on `/morning-review` (uses `v_sentinel_check_perf_24h`, p95 desc, limit 3).

## Out of scope

- No sentinel-on-sentinel: nothing auto-flags a slow check as a finding. Operator interprets.
- No historical backfill — metrics start from first tick after migration.
- No per-row DB scan cost — `db_scan:*` aggregates already exist in `automation_steps` and stay as-is.
- No changes to check logic, thresholds, or alert routing.

## Verification

1. Migration applied, view returns rows after one tick.
2. Hand-invoke `sentinel-tick` → confirm ~28 rows in `sentinel_check_runs` sharing one `tick_id`.
3. Force a check to throw (temporary) → confirm `error` column populated and row still inserted.
4. `/admin/sentinel-perf` renders, sort + drawer work, realtime row appends on next tick.
5. Morning Review chip shows top-3 slowest by p95.

## Files

- `supabase/migrations/<ts>_sentinel_check_runs.sql`
- `supabase/functions/sentinel-tick/index.ts` (refactor checks into table + timing wrapper, instrument dispatchAlert)
- `supabase/functions/_shared/alerts.ts` or wherever `dispatchAlert` lives — return attempts
- `src/pages/admin/SentinelPerf.tsx` (new)
- `src/components/admin/SentinelCheckDrawer.tsx` (new)
- `src/components/morning-review/TimelineNowChip.tsx` (append slowest-checks line)
- `src/App.tsx` route
- `CHANGELOG.md`, `mem://features/sentinel-perf` (new memory)
