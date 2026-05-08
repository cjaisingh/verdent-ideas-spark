## Answering your questions

1. **Did actions come out of the most recent discussion?** No. The only things the discussion currently writes are: chat messages in the transcript, and a single `decision_outcome` label on the finding. Even picking **convert_to_task** today is just a label — no roadmap task or action item is created anywhere.
2. **Unique ID per discussion?** Yes — each discussion already has a UUID, but it isn't shown. We'll surface a short, mentionable handle so you can say "look at FND-12-D3".
3. **Jobs board?** Yes — lightweight, generic (works for any subject, like the discussion history is now), with a one-click "promote to roadmap task" escape hatch.

## What we'll build

### 1. Discussion handles — `FND-12-D3`

- Add a per-subject ordinal (`subject_ordinal`) to each discussion: 1st, 2nd, 3rd discussion on this subject.
- Add a short subject prefix derived from `subject_type` (e.g. `roadmap_finding` → `FND`) plus a per-subject sequence on the subject itself (so findings get `FND-1`, `FND-2`…). Findings get a `short_id` column populated by trigger.
- Final handle format: `FND-12-D3` = the 3rd discussion on finding #12.
- Shown next to the discussion title in the sheet header, in the history list, and copyable with a click. Same handle appears on every action item that came out of that discussion, so you can reference them back to me as "the action items from FND-12-D3".

### 2. Jobs board (action items)

A new lightweight, generic table — works exactly like discussions did once we generalized them.

**Data**

- `discussion_actions` table:
  - `id`, `short_id` (e.g. `JOB-42` — sequential, easy to say)
  - `subject_type`, `subject_id` (so jobs can also be created outside discussions later)
  - `discussion_id` (nullable — set when the job came from a discussion)
  - `title`, `details`, `status` (`open` | `in_progress` | `done` | `cancelled`)
  - `priority` (`low` | `med` | `high`), `owner` (text), `due_at` (nullable)
  - `source` (`manual` | `extracted`), `extracted_confidence` (nullable)
  - `promoted_task_id` (nullable — set when promoted to a `roadmap_tasks` row)
  - timestamps + `created_by`
- Operator-only RLS, realtime enabled.

**How items get created**

- **Manual** — "Add action item" button always visible in the Copilot discussion sheet. Type or dictate, sets `source='manual'`.
- **Auto-extract** — "Extract action items" button (also runs automatically when you press **Record decision**). Calls a new edge function `discussion-extract-actions` that:
  - Loads the transcript + finding context.
  - Asks `google/gemini-2.5-flash` for a JSON array of `{title, details, priority, owner_hint, due_hint}`.
  - Returns the proposals; the UI shows them as **pending** chips with **Accept** / **Edit** / **Reject**. Accepted ones insert with `source='extracted'`.
  - Nothing is created without your confirmation — keeps it auditable.

**Where you see them**

- **In the discussion sheet** — a new "Action items" panel under the transcript, listing this discussion's jobs with status pills and quick status changes.
- **On the finding card** — a small badge "3 jobs · 1 open" linking to the board filtered to that subject.
- **New `/jobs` page** — kanban-style board (Open / In progress / Done) with filters by `subject_type`, `status`, `owner`, and a search. Each card shows `JOB-42`, title, the originating discussion handle (`FND-12-D3`), and a "Promote to roadmap task" action.
- **Reusable `<JobsList subjectType subjectId />`** drop-in for any future subject.

**Promote to roadmap task**

- One click on a job → creates a `roadmap_tasks` row in a dedicated "Discussion follow-ups" sprint (auto-created if missing), copies title/details, sets `discussion_actions.promoted_task_id`, and the job stays linked but flips to `status='done'` with a "promoted" tag.

### 3. Surfacing in the existing UI

- Risk dashboard finding card: small "FND-12 · 3 jobs (1 open)" pill.
- Discussion sheet header: shows `FND-12-D3` next to the title.
- Sidebar: new **Jobs** entry with a count badge for `open` jobs.

## Out of scope this iteration

- Notifications/Slack/email when jobs change.
- Subtasks or dependencies between jobs.
- Auto-extraction running on historical discussions (only newly recorded decisions trigger it).
- Editing/deleting individual transcript messages.

## Technical details

- **Migration**: new `discussion_actions` table with RLS + realtime; sequence + trigger to fill `short_id` (`JOB-<n>`); add `subject_ordinal` (per-subject) to `roadmap_finding_discussions` via trigger; add `short_id` to `roadmap_review_findings` via trigger (`FND-<n>`). Backfill for existing rows.
- **Edge function**: `discussion-extract-actions` (operator JWT, no streaming). Returns `{proposals: [...]}`; client persists on accept.
- **Files**:
  - `supabase/migrations/<new>.sql`
  - `supabase/functions/discussion-extract-actions/index.ts`
  - `src/components/discussions/DiscussionActionsPanel.tsx` (in-sheet)
  - `src/components/discussions/JobsList.tsx` (reusable, drop-in)
  - `src/pages/Jobs.tsx` (kanban)
  - `src/components/AppSidebar.tsx` (add Jobs entry)
  - `src/pages/RiskDashboard.tsx` (jobs pill on finding cards, handle display)
  - `src/components/risk/CopilotDiscussionSheet.tsx` (handle in header, actions panel under transcript)
  - `src/App.tsx` (route `/jobs`)
