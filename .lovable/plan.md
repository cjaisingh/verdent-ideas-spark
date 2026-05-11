## Goal

Replace the confusing **Mirror / Defer / Done / Skip** footer with three clear actions — **Fix · Cancel · Escalate** — and add a sentinel for jobs that night-shift 3+ times without closing.

## Why

- "Mirror" today inserts a near-empty `discussion_actions` row with no context and no link back. Nobody knows what it did.
- Items can sit in night shift forever; we have no escalation signal.
- Done/Skip just hide the panel — the underlying issue (stuck cron, drift, etc.) keeps reappearing with no record of why we cancelled it.

## New behavior

### Footer buttons
1. **Fix** — primary. Opens a small inline form (title prefilled from panel + AI summary, risk select default `med`, owner = current operator, optional due date). On submit:
   - inserts a `discussion_actions` row with `details` containing: panel ref, review date, AI summary of the chat (3 bullets), link back to discussion, last 6 turns
   - `subject_type='morning_review_panel'`, new column `morning_review_panel_ref`
   - dedupes against existing **open** action with same `morning_review_panel_ref` (appends a note instead of duplicating)
   - closes discussion with `outcome='fixed'`, panel triage → `revisit`
   - toast: `Queued as job #<short_num>` with **Open** action linking to `/jobs?focus=<short_num>`

2. **Cancel** — destructive variant. Asks for a one-line reason. On submit:
   - closes discussion with `outcome='cancelled'`
   - inserts a `system` message: `Cancelled: <reason>`
   - panel triage → `done`
   - **No suppression** — if the underlying detector fires again tomorrow, it shows up again (this is the simple semantics chosen).

3. **Escalate** — shortcut. Same as Fix but pre-sets `risk='high'`, `priority='high'`, `night_eligible=false`, and **also** writes a `sentinel_findings` row (`severity='high'`, `kind='operator_escalation'`) so it surfaces tomorrow's morning review at the top.

(Defer/Done/Skip removed from the drawer. The panel-header chip strip still has Focus/Revisit/Done/Skip for quick triage without a discussion — unchanged.)

### Auto-escalation: 3 night-shift attempts
- New table `night_shift_job_attempts` (`id`, `action_id`, `night_shift_id`, `attempted_at`, `outcome`).
- Existing `night-agent-close` edge function logs one row per audited action per shift.
- New SQL view `discussion_actions_stuck_in_night` returning open jobs with `attempts >= 3`.
- New scheduled function `night-stuck-escalator` (runs once after `night-agent-close`, ~06:05 UTC) iterates that view and:
  - flips `risk` to `high`
  - clears `night_eligible`
  - inserts a `sentinel_findings` row (`kind='night_stuck_3x'`, `severity='high'`, links to action)
  - emits a `discussion_action_events` row of type `auto_escalated`
- Morning review aggregator picks up these sentinel findings via the existing open-findings panel — no UI change needed there, but it gets a small "🔁 night-stuck" badge.

## Schema changes

```sql
alter table discussion_actions add column morning_review_panel_ref text;
create unique index discussion_actions_open_per_mr_panel
  on discussion_actions (morning_review_panel_ref)
  where status = 'open' and morning_review_panel_ref is not null;

create table night_shift_job_attempts (
  id uuid pk, action_id uuid fk discussion_actions,
  night_shift_id uuid fk night_shifts, attempted_at timestamptz default now(),
  outcome text  -- 'no_change' | 'progressed' | 'closed'
);
-- operator-only RLS, realtime on

create view discussion_actions_stuck_in_night as
  select da.id, da.short_num, da.title, count(a.id) as attempts
  from discussion_actions da
  join night_shift_job_attempts a on a.action_id = da.id
  where da.status = 'open' and da.night_eligible = true
  group by da.id having count(a.id) >= 3;
```

Add `outcome='cancelled'` and `'fixed'` to the discussion `outcome` check.

## Edge functions

- **New** `morning-review-resolve` (operator JWT, `withLogger`): single endpoint, body `{ discussion_id, action: 'fix'|'cancel'|'escalate', payload }`. Handles all three flows server-side so the client doesn't juggle 3 inserts. Returns `{ short_num?, action_id?, finding_id? }`.
- **Edited** `night-agent-close`: at the end, insert `night_shift_job_attempts` rows for every action it touched.
- **New** `night-stuck-escalator` + cron entry (06:05 UTC daily, `AWIP_SERVICE_TOKEN`).

## Frontend

- **Edited** `PanelDiscussionDrawer.tsx`: footer rebuilt as 3 buttons, each opens a small inline form (no nested dialog — keep it in the sheet). Toast becomes a sonner action toast with **Open** linking to `/jobs?focus=<short_num>`.
- **Edited** `useMorningReviewTriage.ts`: no change needed; resolve endpoint sets triage server-side.
- **Edited** `MorningReview.tsx`: open-findings panel renders a small badge `🔁 night-stuck ×N` when `sentinel_findings.kind='night_stuck_3x'`.

## Docs / memory

- `docs/morning-review.md` — replace Mirror section with Fix/Cancel/Escalate
- `docs/jobs-board.md` — add night-stuck auto-escalation
- `mem/features/morning-review-triage.md` — update footer buttons
- `mem/features/night-agent.md` — add 3-attempts rule
- `mem/index.md` — note auto-escalation in core
- `CHANGELOG.md`

## Out of scope

- No suppressions table (per your answer).
- No CI-failure auto-escalation (not in this pass).
- No "snooze until tomorrow" defer button — Cancel + the underlying detector re-firing covers it.
- No edit UI for the 3-attempts threshold (hardcoded constant; change via PR if needed).
