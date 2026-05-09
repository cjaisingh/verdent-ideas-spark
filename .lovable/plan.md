## Goal

When the operator clicks **Preview re-queue**, the panel currently shows raw `planned_inserts` JSON. It does not warn that one of those inserts will collide with an existing row — e.g. there's already a `queued` run for the same `phase_id` today, or a `running` row started 5 minutes ago. Add a diff view that highlights duplicates *before* the operator flips off dry-run.

## What "duplicate" means

For each planned insert (`phase_id`, `scheduled_for = today`):

1. **Hard duplicate** — an existing row with the same `phase_id` AND same `scheduled_for`, in any non-terminal status (`queued`, `running`). Re-queueing would create a second active run for the same phase on the same day.
2. **Active elsewhere** — an existing row for the same `phase_id` in `queued` or `running` for *any* `scheduled_for` (covers stale rows from yesterday that never finished).
3. **Recently done** — same `phase_id` finished `done` within the last 6 hours. Probably wasted work.
4. **Clean** — no collision. Safe to insert.

Severity ordering (worst wins): hard > active > recent > clean.

## Behaviour

- Dry-run query is extended: in addition to building `planned_inserts`, fetch existing `roadmap_phase_overnight_runs` for the selected `phase_id`s scoped to the relevant window (today + last 24h). One round-trip via `.in('phase_id', [...])`.
- Each planned insert is annotated with `{ collision: 'hard'|'active'|'recent'|'clean', existing: [{id, status, scheduled_for, requested_at, started_at}] }`.
- The result panel renders a **diff table** above the raw JSON:
  - Columns: phase_key · planned status · collision badge · existing rows (compact: `queued@today`, `running@2026-05-08 (started 14m ago)`, etc.) · per-row checkbox to *exclude* this phase from the actual run.
  - Badge colors: hard → destructive, active → secondary, recent → outline, clean → default.
- Summary chip strip at the top: `3 clean · 1 recent · 2 active · 1 hard`.
- The **Re-queue & run** button (when dry-run is off) also runs the same collision check first; if any `hard` collisions remain in the selection it requires a second click on a confirm dialog ("X hard duplicates will be created — proceed anyway?"). `active` and `recent` only warn.
- Excluded phases are tracked in a `Set<string>` of `phase_id` and stripped from `inserts` at execution time.

## Technical changes (single file)

`src/components/admin/OvernightBackfillPanel.tsx`:

- Add types `Collision = 'hard' | 'active' | 'recent' | 'clean'` and `AnnotatedInsert = { phase_id, phase_key, scheduled_for, collision, existing: ExistingRef[] }`.
- New state: `excluded: Set<string>` (phase_id), `confirmOpen: boolean`.
- Refactor `backfillAndRun` into:
  - `buildPlan()` — builds `inserts`, queries existing rows, returns `AnnotatedInsert[]` and summary counts.
  - `previewPlan()` — calls `buildPlan`, sets `lastResult` with the annotated structure.
  - `executePlan()` — calls `buildPlan`, filters out `excluded`, opens AlertDialog if any `hard` remain, otherwise inserts + invokes runner (existing logic).
- Render a new `<Table>` for the annotated diff between the summary chips and the raw JSON `<pre>`. Keep the raw JSON behind a `<details>` toggle so it doesn't dominate the panel.
- Use existing `STATUS_VARIANT` for existing-row badges; add a small `COLLISION_VARIANT` map.
- Confirm dialog uses shadcn `AlertDialog`.

No schema changes, no edge function changes, no new tables.

## Out of scope

- Server-side uniqueness constraint on `(phase_id, scheduled_for)` — would be the proper fix but is a behavior change for cron and out of this request's scope. Mention in a follow-up note.
- Auto-cancelling the colliding existing rows — operator decides via the exclude checkbox.

## Files

- edited: `src/components/admin/OvernightBackfillPanel.tsx`

## Verification

- With dry-run on, select a phase that already has a `queued` row today → expect `hard` badge + summary `1 hard`.
- Select a phase with no recent runs → `clean`.
- With dry-run off and one `hard` selected → confirm dialog appears.
- Existing dry-run JSON output still present under the toggle.
