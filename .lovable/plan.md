## Goal

A single panel where you can see every background job that is **currently running** (or just finished), what step it's on, an honest ETA, and a tail of its edge-function logs — without bouncing between `/admin/timeline`, `automation_runs`, and Supabase logs.

## What's there now

- `automation_runs` — one row per job execution (status, duration_ms, message, detail).
- `automation_steps` — one row per phase inside a run (started_at, finished_at, duration_ms, status, phase_kind). **No `run_id` FK** — only `job` + `started_at` link them today.
- `v_automation_step_p95_30d` — rolling p95 per `(job, step_key)`.
- `edge_request_logs` — per HTTP call (request_id, function_name, status, latency_ms, error_message, meta, created_at).
- No `request_id` on `automation_runs` or `automation_steps`, so logs are joined heuristically (function_name + time window).

## What this adds

### 1. Migration — link runs ↔ steps ↔ logs

- Add `run_id uuid` to `public.automation_steps` (nullable, indexed). Backfill is **not** attempted; new ticks populate it forward.
- Add `request_id text` and `run_id uuid` columns to `public.automation_runs` (nullable, indexed on `request_id`). `request_id` lets us join `edge_request_logs` exactly; `run_id` is just the row's own id for forward-compat with externally-started runs.
- New view `v_running_jobs`:
  ```
  select r.id as run_id, r.job, r.trigger, r.created_at as started_at,
         coalesce(r.duration_ms, extract(epoch from (now() - r.created_at))*1000)::int as elapsed_ms,
         r.status, r.message, r.detail
    from automation_runs r
   where r.created_at > now() - interval '6 hours'
     and (r.status in ('running','ok','error','rejected'))
  ```
- New view `v_run_eta` per `(job)`: median + p95 total duration over last 30 days (computed from `automation_runs.duration_ms` where `status='ok'`). ETA = `max(0, median - elapsed_ms)`; if `elapsed > p95`, mark **`overdue`**.

### 2. Edge-function instrumentation (small)

- `withLogger` already mints a `requestId`. Expose it on the request context and update the cron-style functions (`sentinel-tick`, `morning-review`, `postmortem-generate`, `night-agent-*`, `overnight-phase-runner`) so their `recordRun` insert into `automation_runs` includes `request_id` and a self-referential `run_id` (return it from the insert, then pass it to every `recordStep` call as `run_id`).
- `_shared/steps.ts → recordStep()` gains an optional `run_id` field on `init` and writes it on the row. Backward-compatible: omitted → null (existing instrumentation keeps working).
- No new edge function. No new cron.

### 3. UI — `/admin/jobs`

- Top: live cards for each currently running run (status badge, elapsed, step now executing, ETA "~2m left" or "overdue by 45s").
- Below: table of last 50 finished runs in the 6h window (job, trigger, started, duration, status, message). Click → drawer.
- **Run drawer**:
  - Header: job, started, duration / ETA, status, message.
  - **Steps timeline**: ordered list of `automation_steps` for that `run_id`, with duration bars, status pip, p95 baseline tick mark. Running step pulses.
  - **Logs tail**: `edge_request_logs` rows matched by `request_id` (exact) if present, otherwise by `function_name=job` + `created_at` within `[started_at, started_at + elapsed + 1m]`. Show timestamp, status, latency, error_message, expandable `meta`. Banner "fuzzy match — request_id not recorded" when fallback is used.
- Realtime: subscribe to `automation_runs` + `automation_steps` so cards/steps update live.
- Filter chip: **all jobs / cron only / errored only**.

### 4. Surfacing

- New top-nav link "Jobs" under the existing admin area.
- Add an entry on `/admin/timeline` linking to `/admin/jobs` for the run-centric view (timeline stays step-centric).

## Out of scope

- No retry / cancel buttons. This is read-only.
- No log streaming beyond `edge_request_logs` (no `console.log` capture — those live in the platform log tool only).
- No ETA modelling beyond median/p95; no per-step ETA prediction (covered by the existing p95 tick on the timeline).
- No backfill of `run_id` / `request_id` on historical rows.
- No notifications when a job goes "overdue" — visual flag only.

## Verification

1. Migration applied; `select run_id from automation_steps limit 1` returns null for old rows.
2. Hand-invoke `sentinel-tick`; new run row has `request_id` populated; its `automation_steps` rows all carry the same `run_id`.
3. `/admin/jobs` shows the run; drawer steps tab lists ~30 steps; logs tab lists at least one `edge_request_logs` row for that `request_id`.
4. Median ETA cross-checks against `select percentile_cont(0.5) within group (order by duration_ms) from automation_runs where job='sentinel-tick' and status='ok' and created_at > now()-interval '30 days'`.
5. Force a run to overshoot (or pick an old slow one) → "overdue" badge renders.

## Files

- `supabase/migrations/<ts>_jobs_status_panel.sql` (add columns, indexes, two views)
- `supabase/functions/_shared/logger.ts` (export requestId on context if not already)
- `supabase/functions/_shared/steps.ts` (accept `run_id`)
- `supabase/functions/sentinel-tick/index.ts`, `morning-review/index.ts`, `postmortem-generate/index.ts`, `night-agent-open/index.ts`, `night-agent-close/index.ts`, `overnight-phase-runner/index.ts` (pass `requestId` + `run_id` into `recordRun`/`recordStep`)
- `src/pages/AdminJobs.tsx` (new)
- `src/components/admin/JobRunDrawer.tsx` (new)
- `src/App.tsx` route + nav
- `CHANGELOG.md`, `mem://features/jobs-status-panel`
