## Goal
Surface the latest overnight-run status for every **approved** roadmap phase as a compact badge (`queued` / `running` / `done` / `failed`) directly on the phase row — both in the tree view and the timeline view of `/roadmap`.

## What "approved" means here
A phase is treated as approved when its gate has `approvals_ok === true` (no pending sign-offs), matching the same flag used elsewhere in `PhaseGateChip` and `PhaseSignoffAudit`.

## Scope
Frontend only. No schema or RLS changes.
- New component: `src/components/roadmap/OvernightRunBadge.tsx` — read-only, latest-run badge with a hover tooltip showing scheduled date, finish time, and (for failed) the error.
- Edit: `src/pages/Roadmap.tsx` to render the badge in both the tree (line ~391) and timeline (line ~458) phase headers, gated on `gates.get(phase.id)?.approvals_ok`.
- Existing `OvernightRunControl` (queue / cancel / result popover) stays only in `PhaseSignoffAudit` — we don't add the queue button here, just status visibility.

## Visual
- Compact pill, `text-[10px]`, height ~h-5.
- States and styling (reusing existing tokens, no new colors):
  - `queued` — outline + Moon icon
  - `running` — secondary + spinning Loader2
  - `done` — default + check, with `· $0.00012 · 1,234 tok` in tooltip if `result.cost_usd` present
  - `failed` — destructive + AlertTriangle, error message in tooltip
  - `cancelled` — outline muted + X
  - No row in DB → render nothing (don't clutter approved phases that have never been queued).

## Implementation notes
- `OvernightRunBadge` props: `{ phaseId: string }`. Fetches latest row from `roadmap_phase_overnight_runs` filtered by `phase_id`, ordered by `requested_at desc limit 1`, plus a realtime subscription on the same filter (mirrors `OvernightRunControl`'s loader).
- Returns `null` if no row exists or while loading (no skeleton flicker — phase row layout shouldn't jump).
- Tooltip uses the existing shadcn `Tooltip` primitive.
- In `Roadmap.tsx`, render `{gates.get(phase.id)?.approvals_ok && <OvernightRunBadge phaseId={phase.id} />}` immediately after `<PhaseGateBadge … />` in both phase header rows.

## Out of scope
- No queue / cancel actions here (keep that consolidated in the Sign-offs tab).
- No history list — just the latest run.
- No changes to job tables, edge functions, or the night runner itself.

## Validation
1. Approve a phase (so `approvals_ok` flips true) and queue an overnight run from the Sign-offs tab → both the tree and timeline phase headers show a `queued` badge within the realtime debounce window.
2. Toggle status manually in DB to `running`/`done`/`failed`/`cancelled` → badge updates live; tooltip reflects times and (for `done`) cost/tokens, (for `failed`) error message.
3. Phase that has never been queued → no badge appears.
4. Phase that is not yet approved (`approvals_ok === false`) → no badge appears, even if a stale run row exists.