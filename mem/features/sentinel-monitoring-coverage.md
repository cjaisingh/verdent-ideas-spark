---
name: Sentinel monitoring coverage
description: SENTINEL_CADENCES must list every essential cron; automation_runs query filters by .in(job, monitoredJobs) to dodge PostgREST 1000-row cap. Includes telegram_webhook_silent + approvals_stale + autologger gate watchers.
type: feature
---

22 monitored crons in `SENTINEL_CADENCES` (15m / 30m / 12h / daily / weekly buckets) — anything not listed is NOT watched. Add new cron → add cadence here.

`automation_runs` fetch in `sentinel-tick/index.ts` MUST keep `.in("job", monitoredJobs).order("created_at",{ascending:false}).limit(5000)` — without the `.in` filter, high-frequency jobs (`automation-auth-monitor` ~1440 rows/15d) push monitored jobs out of the default 1000-row PostgREST window and fabricate `cron_silence` findings.

Operator-channel watchers:
- `telegram_webhook_silent` — `edge_request_logs` for `function_name=telegram-webhook` > 6h with zero hits → high. Catches webhook breakage even when allowlist silently 200s.
- `approvals_stale` — `approval_queue` max(created_at) > 72h → medium. Upstream-channel canary.

Autologger + observability gate watchers (added 2026-05-21):
- `out_of_scope_stale` — `discussion_actions` with `source IN ('plan_footer','session_summary')` and `created_at > 14d` and `status='open'` → medium, grouped by `source_ref`. Catches deferred items that never get triaged.
- `telegram_send_failures_burst` — `telegram_send_log` rows with `status IN ('failed','error')` in last hour ≥ threshold → high. Now active since `telegram-send/index.ts` writes on every send (2026-05-21).
- `telegram_outbound_silent` — `telegram_send_log` max(created_at) > 24h → medium. Permanent false-positive risk if writer is missing (was the case pre-2026-05-21).
- `observability_coverage_gap` — surfaces in `observability_registry` with no recent activity in expected window → medium. Surface at `/admin/observability-registry`.

Lesson: "no findings" ≠ "healthy". Silence detectors need their own silence detectors (cron + domain). Default monitoring stance is **per essential service**, not per error class.
