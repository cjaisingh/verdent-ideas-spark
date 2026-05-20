---
name: Jobs status panel
description: /admin/jobs live panel for background-job runs (current step, ETA, logs); joins runs↔steps↔edge logs by request_id
type: feature
---
`/admin/jobs` is the operator-facing status view for every background job.

- Data: `v_jobs_recent` (6h window, computed `elapsed_ms`) + `v_job_eta_baseline` (30d p50/p95 per job from `status='ok'` runs).
- Linkage: every cron/edge-fn handler wrapped with `withLogger` now passes `ctx.requestId` to both its `automation_runs` insert and every `recordStep` call. `automation_runs.request_id` and `automation_steps.request_id` are both indexed. The drawer joins exactly by `request_id`; older rows without one fall back to `function_name + started_at` window with a visible "fuzzy match" badge.
- ETA = `median_ms − elapsed_ms`. Row is **overdue** when `elapsed > p95_ms`.
- Realtime on `automation_runs` + `automation_steps`. Filter chips: all / cron only / errored.
- Read-only — no retry, no cancel, no log streaming beyond `edge_request_logs`.

Instrumented surfaces threading `reqId`: `sentinel-tick`, `morning-review`, `postmortem-generate`, `night-agent`, `overnight-phase-runner`. Add `request_id: reqId` to any new `recordRun` insert and `recordStep` init when adding more.
