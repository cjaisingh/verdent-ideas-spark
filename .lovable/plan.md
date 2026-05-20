## Live platform timeline with labelled phases + p95 flagging

A live view of every cron / edge function / sentinel check as it runs, with per-phase labels (AI call, DB scan, lock wait, back-off) and an auto-flag when a step exceeds its rolling p95 baseline.

### Data

**New table `automation_steps`** (one row per phase inside a run; complements existing `automation_runs` which holds the parent summary):
- `id`, `created_at`
- `run_id` (uuid, nullable FK → `automation_runs.id` for stitching; sometimes the parent row arrives last)
- `job` (text — same value as `automation_runs.job`, denormalised so we can query without the join)
- `step_key` (text — stable identifier, e.g. `ai_gateway_call`, `db_scan:slipped_subjects`, `sentinel_check:companion_streams_stalled`)
- `step_label` (text — human-readable)
- `phase_kind` (text — `ai_call` | `db_scan` | `lock_wait` | `backoff` | `external_http` | `compute` | `other`)
- `started_at`, `finished_at` (timestamptz; finished_at null while in-flight)
- `duration_ms` (int, generated/updated on finish)
- `status` (`running` | `ok` | `error` | `skipped`)
- `detail` (jsonb — model name, rows scanned, retry count, error snippet)
- index on `(job, started_at desc)`, partial index on `(status) where status='running'`

**New view `v_automation_step_p95_30d`**: per `(job, step_key)`, the p95 `duration_ms` over the trailing 30 days where `status='ok'`. Used by the UI to flag regressions.

Operator-only RLS via `has_role()`; inserts service-role only; realtime on (for the live page).

### Shared helper

`supabase/functions/_shared/steps.ts`:
- `recordStep(sb, { job, run_id?, step_key, step_label, phase_kind, detail? }, fn)` — wraps an async fn, inserts a `running` row before, updates to `ok`/`error` with `finished_at`+`duration_ms`+merged detail after.
- `beginStep(...)` / `endStep(id, status, detail?)` for cases where the operation can't be wrapped (e.g. fire-and-forget heartbeats).
- Failures inside `recordStep` never throw to the caller — instrumentation must not break the underlying job.

### Instrumentation rollout (this PR)

Wrap the steps that account for visible latency. Each instrumented site = one labelled phase.

1. **`sentinel-tick`** — each of the ~15 checks in `checks.ts` becomes a `db_scan` or `compute` step (`step_key='sentinel_check:<name>'`). This is the headline win: today you only see one `automation_runs` row for the whole tick.
2. **`postmortem-generate`** — `db_scan:slipped_subjects`, `ai_call:gateway` per subject, `db_scan:context` per subject.
3. **`morning-review`** — top-level aggregator phases (`db_scan:triage`, `db_scan:findings`, `compute:render`, `ai_call:summarise` if present).
4. **`night-agent-open` / `night-agent-close`** — per-action loop iteration as a step.
5. **`overnight-phase-runner`** — `lock_wait:claim`, `ai_call:gateway`, `db_scan:write_back`.

Other functions stay unchanged; they can opt in later. Logger middleware is untouched.

### UI

**New page `/admin/timeline`** (added to admin nav):
- Top strip: 3 cards — `Running now` (count + oldest start), `Slowest in last 1h` (top 5 by duration), `Over p95` (count flagged this hour).
- Main panel: live stream of steps newest first, columns = `Job`, `Step`, `Phase`, `Started`, `Duration` (live ticking for `running`), `Status`, `Detail` (expand). Filters: job, phase_kind, status, "over p95 only".
- Each row joins to `v_automation_step_p95_30d` client-side; if `duration_ms > p95` (or `now - started_at > p95` for running rows), show an amber chip "p95 was Xms".
- Realtime subscribe to `automation_steps` inserts/updates with unique channel name per mount.

**Compact chip on `/morning-review`**: `TimelineNowChip` component showing `running: N · over-p95: M (1h)` linking to `/admin/timeline`. Polls every 30s.

### Out of scope

- No backfill of historical step data — p95 builds from new rows forward.
- No instrumentation of every edge function — only the 5 listed above. Adding more is a one-line wrap per call site.
- No alerting / sentinel detector on p95 regression — UI signal only this round.
- No per-AI-call token breakdown beyond what `ai_usage_log` already stores (separate `task_id` work).

### Files

- migration: `automation_steps` table + RLS + realtime + `v_automation_step_p95_30d` view
- `supabase/functions/_shared/steps.ts` (new helper)
- edits to `supabase/functions/{sentinel-tick,postmortem-generate,morning-review,night-agent,overnight-phase-runner}/index.ts` (wrap target phases)
- `src/pages/AdminTimeline.tsx` (new page)
- `src/components/timeline/TimelineNowChip.tsx` (Morning Review chip)
- route registration in `src/App.tsx`
- `mem/features/automation-steps.md` + `mem/index.md` entry
- `CHANGELOG.md`

### Verification before claiming done

- Migration applied; `read_query` confirms table + view + RLS.
- Invoke `postmortem-generate` manually; `read_query` confirms ≥1 step row per call with `ok`/`error` status and non-null `duration_ms`.
- Run `sentinel-tick` once; assert ≥10 step rows tagged `sentinel_check:*`, all terminal, with sensible durations.
- Load `/admin/timeline`; confirm realtime row appears within 2s of a manual `postmortem-generate` invoke; confirm "over p95" chip doesn't false-fire on the first run (needs baseline).
- Load `/morning-review`; confirm `TimelineNowChip` renders and link works.
- Console + network clean.
