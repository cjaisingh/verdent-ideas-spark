## Add dry-run to Overnight Backfill panel

Augment `src/components/admin/OvernightBackfillPanel.tsx` so an operator can preview a backfill without side effects: no inserts into `roadmap_phase_overnight_runs`, no calls to `overnight-phase-runner`.

### UX

- Add a **"Dry run"** checkbox in the action row, next to the existing buttons. Default: **on** (safe by default — explicit opt-in to mutate).
- The primary action button label switches based on mode:
  - Dry run on → `Preview re-queue (N)`
  - Dry run off → `Re-queue & run N` (existing behavior)
- When dry-run is on, the button is styled as `variant="outline"` to visually distinguish from the destructive/mutating action.
- Add a small inline hint under the heading: "Dry run is on — nothing will be written" / "Dry run is off — selected phases will be re-queued and the runner will be invoked".

### Behavior

- Split the current `backfillAndRun` into two paths driven by a `dryRun` state flag:
  - **Dry run path** (no DB writes, no fetch):
    - Build the same `inserts` payload the real path would build (`phase_id`, `phase_key`, `requested_by`, `scheduled_for = today`, `status: "queued"`).
    - Build the same per-row "runner invocation plan" (target URL, run_id placeholder `<would-be-generated>`, body shape).
    - Set `lastResult` to `{ dry_run: true, would_requeue: inserts.length, planned_inserts: [...], planned_runner_calls: [...] }`.
    - Toast: `Dry run: would re-queue N phase(s)` (default variant, not destructive).
    - Do **not** call `refresh()` (nothing changed).
  - **Real path**: unchanged — keep current insert + runner invocation logic.

### Technical notes

- New state: `const [dryRun, setDryRun] = useState(true);`
- Reuse `selectableByPhase.filter(r => selected.has(r.id))` for both paths so the preview is byte-for-byte what would be inserted.
- Keep the existing `lastResult` `<pre>` block — it already pretty-prints arbitrary JSON, so the dry-run output renders for free.
- No backend, edge function, or schema changes. Pure frontend.
- No new dependencies; `Checkbox` from `@/components/ui/checkbox` is already imported.

### Files touched

- `src/components/admin/OvernightBackfillPanel.tsx` (only file changed)
