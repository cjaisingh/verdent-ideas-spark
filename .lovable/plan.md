# Tomorrow Plan dashboard

Add a daily-plan surface as a second tab on `/morning-review` ("Yesterday" = current review, "Tomorrow" = the plan), backed by a new `daily_plans` table. Each checklist item can auto-tick from a live source (sentinel finding, discussion_action, cron name) and also be manually overridden. Today's Block 1–4 plan is seeded as the first row.

## Data model

New tables (operator-only RLS, realtime enabled, single edit history via `updated_at`):

- **`daily_plans`** — one row per plan
  - `plan_date` (date, unique) — the day the plan is *for*
  - `title`, `notes` (text)
  - `success_criteria` (jsonb array of `{label, source?, target?, met?}`)
  - `status` ('draft' | 'active' | 'archived')
  - `created_by`, timestamps

- **`daily_plan_blocks`** — Block 1–4 grouping
  - `plan_id`, `ordinal` (int), `title`, `est_minutes`, `summary`

- **`daily_plan_items`** — checklist row
  - `block_id`, `ordinal`, `label`, `detail`
  - `source_kind` ('sentinel_finding' | 'discussion_action' | 'cron' | 'manual')
  - `source_ref` (text — finding id / action id / cron jobname)
  - `auto_done` (bool, computed by edge fn), `manual_done` (bool, operator tick), `done_at`
  - `notes`

RLS: operators can read/write all rows. Realtime added for all three tables. `enforce_updated_at` trigger.

## Edge function

`daily-plan-refresh` (operator JWT or `x-awip-service-token`) — for a given `plan_id`, walks every item and updates `auto_done`:
- `sentinel_finding` → done if finding `status='resolved'` or row missing
- `discussion_action` → done if action `status in ('done','cancelled','blocked')`
- `cron` → done if `automation_runs` for that jobname has a success in the last 24h
- `manual` → leaves `auto_done` null (manual only)

Effective `done = manual_done OR auto_done`. Function also recomputes `success_criteria[].met` using the same rules and writes back. Wired to a cron (`scheduled-daily-plan-refresh`, every 15 min) — cadence registered with Sentinel so silence triggers a finding (per existing pattern).

## UI — `/morning-review`

Wrap existing page in a `Tabs` component:
- **Yesterday** — current MorningReview content, unchanged.
- **Tomorrow** — new `TomorrowPlan` view:
  - Header: plan date, status pill, "Refresh now" (invokes edge fn), "Mark plan complete" (sets archived).
  - 4 stacked Block cards (CardHeader with ordinal + title + est minutes + progress `n/total`).
  - Each item row: checkbox (manual override), label, detail, source badge linking to the source (sentinel finding, action drawer, cron name), small auto/manual indicator.
  - Success-criteria panel at the bottom: list with ✓/⏳ from `success_criteria[].met`.
  - "Edit plan" drawer for operator (add/remove items, change blocks, edit success criteria) — minimal CRUD using existing form patterns.
  - Realtime subscribe to `daily_plan_items` so ticks reflect live.

## Seed

Insert today's plan (date = tomorrow UTC) with the Block 1–4 content and success criteria from the last approved plan, with sources mapped:
- Block 1 → sentinel findings (`qa-validate`, `night-agent-close`, `lessons-synthesize`)
- Block 2 → discussion_actions `dfba3284…`, `007b16bd…`
- Block 3 → discussion_actions `26beccf8…`, `7a61bdb5…`
- Block 4 → manual items
- Success criteria → mix of cron + finding queries.

## Memory

Add `mem://features/daily-plan` describing the table set, edge fn, and the rule that the Tomorrow tab is the operator's source of truth for the next-day plan (replaces ad-hoc plan messages in chat).

## Files (new)

- `supabase/migrations/<ts>_daily_plans.sql`
- `supabase/functions/daily-plan-refresh/index.ts`
- `src/pages/MorningReview.tsx` — wrap in Tabs
- `src/components/morning-review/YesterdayReview.tsx` — extracted from current page
- `src/components/morning-review/TomorrowPlan.tsx`
- `src/components/morning-review/PlanBlockCard.tsx`
- `src/components/morning-review/PlanEditorDrawer.tsx`
- `src/lib/dailyPlan.ts` — small client helpers (effectiveDone, sourceLink)
- `mem/features/daily-plan.md`
- `CHANGELOG.md` entry

## Out of scope

- Multi-day calendar view / plan history browser (reachable via DB but no UI).
- AI-generated next-day plans (operator authors for now).
- Mobile/Rork surface.
