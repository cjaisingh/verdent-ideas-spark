## Step 5 — UI surfaces for out-of-scope auto-log

Make plan-footer / session-summary provenance visible where operators triage actions. No new pages, no new tables.

### Scope

The `discussion_actions` rows now carry `source` (`plan_footer` | `session_summary` | `manual` | …) and `source_ref` (`plan:<id>` / `session:<id>`). Today the Morning Review panel renders the raw `source` string as an outline badge — visually identical to "manual", so operators cannot distinguish auto-logged gaps. Session-summary detail UI doesn't exist yet, so it's out of scope for this step.

### Changes

1. **`src/components/discussions/DiscussionActionsPanel.tsx`**
   - Pull `source_ref` in the `select` list and add to the row type.
   - Replace the plain `<Badge>{a.source}</Badge>` with a small helper that maps:
     - `plan_footer` → amber outline, label "from plan", tooltip = `source_ref`
     - `session_summary` → indigo outline, label "from session", tooltip = `source_ref`
     - `manual` (or null) → hide the badge (current default is noise)
     - anything else → existing neutral outline with raw value
   - Helper colocated in the same file (no new shared component).

2. **`src/components/panes/bodies/DiscussionActionsBody.tsx`**
   - Same select-list addition + same badge helper applied to the pane variant so the Morning Review tabbed pane matches the standalone panel.

3. **Filter affordance (panel header only)**
   - Add a single "Auto-logged only" toggle (checkbox + count) above the list that filters to `source in ('plan_footer','session_summary')`. Client-side filter on the already-fetched list — no new query.

### Out of scope

- No session_summaries detail page (doesn't exist; would be its own step).
- No deep-link from `source_ref` to a plan viewer (no plan viewer route exists yet).
- No new colour tokens — reuse existing `border-amber-500/40 text-amber-600` and `border-indigo-500/40 text-indigo-600` Tailwind classes already used elsewhere in the panel family.

### Verification

- Manual: load `/morning-review`, confirm seeded auto-log rows show "from plan" / "from session" badges with tooltips; toggle filter; confirm `manual` rows show no source badge.
- `read_query` on `discussion_actions` to confirm at least one row of each `source` exists; if not, insert a synthetic via the existing `plan-footer-ingest` fixture before manual check.

### Definition of done

- Two components updated, no schema changes, no new files.
- Build green, no new lint warnings.
- Memory `mem://features/out-of-scope-autolog` stays accurate (it already mentions the badge contract).
