## Auto-postmortem on schedule slip

Trigger: a roadmap phase or sprint passes its end date without `status ∈ (done, shipped, cancelled)`. A daily cron drafts a postmortem; operator reads it on a new page. Prose only — no enforcement, no auto-detector creation.

### Data

New table `postmortems`:
- `subject_kind` (`'phase' | 'sprint'`), `subject_id` (uuid), `subject_label` (text)
- `slipped_on` (date — first day past due that we detected)
- `days_late` (int)
- `root_cause` (text — AI draft)
- `contributing_factors` (jsonb array of strings)
- `timeline` (jsonb — key events: created, last status change, blockers, related sentinel findings, related failed overnight runs)
- `what_changed` (text — AI draft of what's already been done since the slip)
- `status` (`'draft' | 'reviewed' | 'archived'`, default `draft`)
- `created_at`, `reviewed_at`, `reviewed_by`
- unique `(subject_kind, subject_id, slipped_on)` so one slip → one report

Operator-only RLS via `has_role(auth.uid(),'admin')`. Realtime enabled.

### Cron + edge function

New edge function `postmortem-generate` (wrapped with `withLogger`, contract under `_shared/contracts/postmortem-generate.ts`):
1. Query phases + sprints past `ends_on` (or equivalent end-date column — confirm during build) and not done/shipped/cancelled.
2. For each, skip if a `postmortems` row already exists for `(kind, id, slipped_on=ends_on)`.
3. Gather context: status history, linked `discussion_actions`, `sentinel_findings` in the period, `roadmap_phase_overnight_runs` failures, `okr_node_events` for the phase's OKR.
4. Call `pickModel()` (night-cheap policy still applies) via Lovable AI Gateway with a structured-output schema: `{ root_cause, contributing_factors[], what_changed, timeline[] }`.
5. Insert one `postmortems` row per slip.

New cron `scheduled-postmortem-generate` runs daily 06:30 UTC (after Morning Review at 06:00) using `AWIP_SERVICE_TOKEN`.

### UI

New route `/postmortems`:
- Table of draft + reviewed postmortems, newest first, filter by kind/status.
- Row click → drawer with full prose (root cause, contributing factors, timeline, what changed) + link back to the phase/sprint.
- "Mark reviewed" button stamps `reviewed_at`/`reviewed_by`.
- Count badge on Morning Review row when there are unreviewed drafts.

### Out of scope (per your answers)

- No sentinel detector or rule proposal from postmortems.
- No automatic discussion_action creation.
- No migration drafting.
- Cost-overrun and overnight-failure postmortems — separate future request.

### Files

- migration: `postmortems` table + RLS + realtime
- `supabase/functions/_shared/contracts/postmortem-generate.ts`
- `supabase/functions/postmortem-generate/index.ts`
- cron registration `scheduled-postmortem-generate`
- `src/pages/Postmortems.tsx` + route in `App.tsx`
- `src/components/postmortems/PostmortemDrawer.tsx`
- Morning Review badge addition
- `mem/features/postmortems.md` + `mem/index.md` entry
- `CHANGELOG.md`

### Verification before claiming done

- Migration applied; `read_query` confirms table + RLS.
- Manually invoke `postmortem-generate` against a synthetic slipped phase; assert row inserted with non-empty `root_cause`.
- Re-invoke; assert no duplicate (unique constraint holds).
- Load `/postmortems`; confirm drawer renders and "Mark reviewed" updates the row (network + console clean).
