---
name: night-shift
description: Four new nightly batch jobs (rollup analytics 23:00, snapshot 23:30, ingest 22:30, cache-warm 00:00) + /admin/night-shift unified operator page.
type: feature
---
**Jobs (all auth via AWIP_SERVICE_TOKEN):**
- `nightly-rollup-analytics` 23:00 UTC daily — backfills last 7d into `analytics_daily_ai_usage` (job+model), `analytics_daily_automation` (job), `analytics_daily_cost` (date). Idempotent upsert on date dims.
- `snapshot-daily-report` 23:30 UTC daily — writes `daily_snapshots` (system + contract kinds), AI brief via `pickModel("google/gemini-2.5-flash")` so flash-lite at night. Unique on (snapshot_date, kind).
- `ingest-external-data` 22:30 UTC daily — dispatches per-source from `ingestion_sources` table by `kind`. Built-in handler: `awip_docs_refresh` (counts stale docs >30d). Add new handler = add `case` in dispatcher + insert source row. Idempotent on (source_key, YYYY-MM-DD).
- `cache-warm` 00:00 UTC daily — touches 8 heavy read paths (automation_runs/ai_usage/sentinel/discussion_actions/audits/morning_reviews/snapshots/cost) to warm Postgres plan cache. Logs to `cache_warm_runs`.

**Tables:** all operator-read RLS, no client write, realtime enabled. Retention: rollups + ingestion_runs 365d, cache_warm_runs 30d, daily_snapshots indefinite.

**Operator surface:** `/admin/night-shift` (sidebar: Admin → "Night Shift (all jobs)"). Reads `list_all_nightly_jobs()` RPC which categorises every cron job (rollup/ingest/cache/monitor/night-agent/audit/hygiene/other). "Run now" button per row → `supabase.functions.invoke()`.

**First nightly fire is unverified** until 22:30 UTC tonight produces an `automation_runs` row.
