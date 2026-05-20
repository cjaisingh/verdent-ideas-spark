## Goal

Make manual governance linking a real workflow, not a hunt-and-peck. The `/governance` page already has anchor selection + `AddLinkDialog` + a coverage rollup, but the operator has no view of *which* shipped tasks are uncovered, so coverage sits at 0%. This change surfaces the gap and turns it into a clickable queue.

Scope: UI + one read-only RPC. No changes to `governance_links` schema, RLS, or `governance_coverage`.

## What gets built

### 1. New RPC: `governance_uncovered_tasks(_days int, _missing text)`

Mirrors `governance_coverage` but returns *rows* instead of counts. Operator/admin only (`has_role`), `security definer`, `stable`.

- `_days` (default 30) — same shipped-in-window filter as `governance_coverage`.
- `_missing` — one of `'entity' | 'notebook' | 'authority_rule' | 'any'`. Returns shipped tasks that lack at least one link of that kind. `'any'` = missing entity OR notebook OR rule.

Returns `setof` rows: `{ id uuid, key text, title text, status text, updated_at timestamptz, has_entity bool, has_notebook bool, has_authority_rule bool }` ordered by `updated_at desc`, limit 200.

This is the only schema change — a single function, no new table.

### 2. New component: `UncoveredTasksPanel`

`src/components/governance/UncoveredTasksPanel.tsx`. Rendered on `/governance` between the Anchor card and the existing Chain card.

- Filter chip row: **Any gap** (default) · **Missing entity** · **Missing notebook** · **Missing rule** · window selector (7d / 30d / 90d).
- Table: `key — title`, three coverage pills (✓/✗ for entity, notebook, rule), `updated_at` relative.
- Row click: sets the page anchor to `kind=task, ref=<id>` (reuses existing state), scrolls to the Chain card, and **auto-opens the existing `AddLinkDialog`** with the first missing target kind pre-selected.
- "Link →" inline button: same behaviour as row click, kept explicit for clarity.
- Realtime: subscribe to `public.governance_links` (unique per-mount channel) — when a link is added, refetch so the row drops out of the worklist within ~1s.
- Empty state: "All shipped tasks in the last {N}d are linked. Coverage is healthy."

### 3. Wire `AddLinkDialog` to accept an initial target kind

Currently `AddLinkDialog` hard-codes `toKind = "entity"`. Add an optional `initialToKind?: Kind` prop, default `"entity"`. The worklist passes whichever leg is missing first, so one click lands you on the right dropdown.

Also expose a controlled "open" trigger that hides the built-in `+ Link` button when invoked from the worklist (parent owns the open state — already the case).

### 4. Coverage rollup gets a "Refresh" affordance + delta hint

Same coverage card as today, but:
- Add a small **Refresh** button that re-runs `governance_coverage`.
- Show a one-line subtext: `"{n} task(s) missing an entity link · {m} missing a rule"`, sourced from `governance_uncovered_tasks` counts. This makes the gap legible at a glance even before scrolling to the worklist.

### 5. Lock the workflow into the page header

Replace the current intro paragraph with two short lines:

1. "Pick an uncovered task below, then **+ Link** it to the entity it touches and the authority rule that governs it."
2. Existing "Gaps are the holes W7.2 will close." sentence stays.

No new docs page; the existing `docs/governance-joins.md` keeps the conceptual reference.

## Technical notes

- New RPC keeps the same `has_role` gate as `governance_coverage` so nothing leaks to non-operators.
- Worklist query is one RPC call; no joins on the client.
- All new tables — none. Only the new function. So this is a schema migration containing exactly one `create or replace function`.
- Realtime channel name: `gov-uncovered-${useId()}` per the realtime naming rule.
- Reuse `KIND_LABEL`, `RELATIONS`, `AnchorOption`, `AddLinkDialog`, `shortRef` from `Governance.tsx` — extract them to `src/components/governance/types.ts` (cheap shared module) so the worklist can import without circular deps.

## Definition of done

- New RPC deployed; calling it as operator returns rows, as anon raises `not authorized`.
- `/governance` shows the worklist with live count; clicking a row opens `AddLinkDialog` pre-targeted to the missing leg.
- Linking a task moves the coverage numbers up and removes the row from the worklist (realtime).
- `mem://features/governance-joins` updated with one line about the worklist surface.
- `CHANGELOG.md` and `docs/governance-joins.md` get a short note.
- No TypeScript or lint regressions; no changes to RLS, claims, sentinel, or resolver.

## Out of scope

- Bulk linking (multi-select → one entity). Worth doing later if the queue is consistently long.
- Auto-suggesting an entity from task title/keywords. Manual-only is the W7.1.5 design.
- Backfilling links for historical tasks — explicit non-goal per the memory rule "no backfill, no enforcement".
- Anything touching W7.2 enforcement.
