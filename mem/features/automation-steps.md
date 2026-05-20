---
name: Live platform timeline
description: automation_steps table + v_automation_step_p95_30d view + recordStep helper + /admin/timeline page; per-phase instrumentation of sentinel-tick, postmortem-generate, morning-review, night-agent, overnight-phase-runner
type: feature
---
Live "what's running now" surface for cron/edge-fn/sentinel work.

- Table `public.automation_steps` (run_id, job, step_key, step_label, phase_kind, started_at/finished_at, duration_ms, status, detail). Operator-only RLS, realtime on. Complements `automation_runs` (one parent row per run).
- View `public.v_automation_step_p95_30d` exposes p95/p50/max per (job, step_key) over last 30d for `status='ok'` rows.
- Helper `supabase/functions/_shared/steps.ts` exports `recordStep(sb, init, fn)` + `beginStep`/`endStep`. Instrumentation NEVER throws — insert/update failures are swallowed.
- Instrumented sites (this PR): sentinel-tick (4 db_scan bands + 1 compute), postmortem-generate (db_scan:slipped_subjects, db_scan:context per subject, ai_call:gateway per subject), morning-review (db_scan:sources), night-agent (compute:<job> wrapping dispatch), overnight-phase-runner (db_scan:phase_context, ai_call:gateway).
- Per-check sentinel instrumentation deliberately skipped — in-memory checks are sub-ms, wrapping each would add 56 DB writes per tick. Bands wrap the DB scans where wall time lives.
- UI: `/admin/timeline` (3 summary cards + filtered live stream, realtime channel `admin-timeline-<rand>`); `TimelineNowChip` on Morning Review polls every 30s.
- p95 flag: duration > baseline AND (duration - baseline) > 50ms (50ms guard avoids fast-path jitter false-positives).
- Out of scope: no historical backfill, no alerting/sentinel detector on p95 regression, no per-AI-call token rollup beyond `ai_usage_log`.
