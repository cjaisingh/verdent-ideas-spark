# Roadmap: Inline Editing + Work Log + Master Plan

Four changes, all on the existing `/roadmap` page and schema where possible.

## 1. Inline editing for tasks

In the expanded timeline panel (the selected task), make `description` and `acceptance` editable in place.

- Click the text → swaps to a `Textarea` with Save / Cancel
- Save writes via `supabase.from("roadmap_tasks").update({...})`
- Optimistic update + toast on error; realtime keeps other sessions in sync
- Empty state shows "Add description…" / "Add acceptance criteria…" placeholders, click to start editing
- Also make task `title` editable (single-line `Input`) — same pattern
- Operator-only (RLS already enforces this; UI just shows the affordance)

No schema changes needed — fields already exist and are writable.

## 2. Epic (phase) descriptions

`roadmap_phases.summary` already exists but is hidden in the UI.

- Render the phase summary under the phase title in the timeline pane (muted, italic)
- Make it inline-editable too (same pattern as task fields)
- Sprints already have `goal` — surface and inline-edit that the same way

## 3. Work log (per task)

New table `roadmap_work_log` capturing each AI work session against a task:

```
id              uuid pk
task_id         uuid → roadmap_tasks
started_at      timestamptz
ended_at        timestamptz nullable
duration_ms     integer generated/computed on close
tokens_in       integer nullable
tokens_out      integer nullable
tokens_total    integer nullable
model           text nullable           -- e.g. "claude-sonnet-4.5"
summary         text nullable           -- what was done
issues          text nullable           -- problems hit
fixes           text nullable           -- how resolved
created_at      timestamptz default now()
```

RLS: operators read + write (same pattern as roadmap_tasks).

UI in selected-task panel, new "Work log" section below comments:
- Table of past entries: date · duration · tokens · summary (issues/fixes expandable)
- "+ Log work" form with the fields above (manual entry for now)
- Total time + total tokens shown as a small summary chip on the task row

For now this is **manually logged** by the operator after each AI turn. A future enhancement (out of scope) can auto-create entries from edge function calls.

## 4. Master plan doc

Single source of truth at `docs/master-plan.md`:
- Vision (one paragraph)
- Phases overview (mirrors roadmap_phases) — purpose + success criteria per phase
- Module map + capability registry pointer
- Links to ADRs

Also: link to `docs/master-plan.md` from the Roadmap page header ("View master plan →") and from `README.md`.

## Files touched

- `supabase/migrations/<new>.sql` — create `roadmap_work_log` + RLS + updated_at trigger
- `src/pages/Roadmap.tsx` — inline editors (title/description/acceptance/summary/goal), work-log section, master-plan link
- `src/components/InlineEdit.tsx` (new) — small reusable inline text/textarea editor
- `docs/master-plan.md` (new)
- `README.md` — link to master plan
- `.lovable/plan.md` — append entry noting these additions

## Out of scope

- Auto-capturing tokens from LLM calls (manual entry only this pass)
- Editing phase/sprint `key` or reordering via drag (status cycling stays as-is)
- Gantt / horizontal timeline

Approve and I'll build it in one pass.