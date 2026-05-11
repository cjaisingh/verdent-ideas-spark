---
name: Tomorrow Plan dashboard
description: Operator daily plan surface — tomorrow_plans/_blocks/_items tables, /morning-review Tomorrow tab, 15-min auto-refresh
type: feature
---
**Tables:** `tomorrow_plans` (one per `plan_date`, with `success_criteria` jsonb + status), `tomorrow_plan_blocks` (Block 1–4 grouping with `est_minutes`), `tomorrow_plan_items` (label + detail + `source_kind` of `sentinel_finding|discussion_action|cron|manual` + `source_ref` + `auto_done` + `manual_done` + `done_at`). Operator/admin RLS, realtime on, `stamp_tomorrow_plan_item_done` trigger sets `done_at` when effective-done flips.

**Edge fn:** `tomorrow-plan-refresh` walks every item in `status='active'` plans (or one passed via `plan_id`/`plan_date`) and recomputes `auto_done` + `success_criteria[].met`:
- `sentinel_finding` → done if finding `status='resolved'` or row missing
- `discussion_action` → done if action `status in ('done','cancelled','blocked')`
- `cron` → done if any successful `automation_runs` row in last 24h for that `job` name
- `manual` → leaves `auto_done` null (operator ticks)
Effective `done = manual_done OR auto_done`.

**Cron:** `scheduled-tomorrow-plan-refresh` every 15 min via pg_cron + `net.http_post` → edge fn with `x-awip-service-token`. Logs to `automation_runs(job='tomorrow-plan-refresh')`.

**UI:** `/morning-review` is now a Tabs page — "Yesterday" (existing morning-review report) and "Tomorrow" (`src/components/morning-review/TomorrowPlan.tsx`). Tomorrow tab shows progress bar, 4 stacked Block cards with checkbox rows, success-criteria list. Realtime via `tomorrow-plan-live` channel. Helpers in `src/lib/tomorrowPlan.ts`.

**Note:** the unrelated `daily_plans` table is the AI overnight-plan markdown, not this feature.
