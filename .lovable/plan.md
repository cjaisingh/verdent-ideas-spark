## Goal

Surface unresolved rows from `public.truth_conflicts` directly on `/governance` so the operator can see every tie at a glance, jump straight into the existing `ClaimsPanel` with the row pre-filled, and file a tie-breaking claim without copy-pasting UUIDs.

Scope: UI only. No schema changes, no new edge functions, no change to the sentinel check or resolver.

## What gets built

### 1. `TruthConflictsPanel` (new component)

`src/components/governance/TruthConflictsPanel.tsx`

- Reads `public.truth_conflicts` via supabase client (RLS already gates by `has_role`).
- Renders a card titled **"Unresolved truth conflicts"** with:
  - Count badge (severity-tinted: ≥5 destructive, ≥2 amber, else muted — mirrors sentinel bands).
  - Refresh button + realtime subscription on `public.claims` (unique per-mount channel name, per the realtime naming rule) so the list updates when a claim is filed/voided.
  - Empty state: "No competing claims within 10%. Truth is unambiguous."
- Table/list of rows, each showing:
  - `entity.field` (mono)
  - `entity_id` (short, with copy button)
  - top vs next: two pills (`source` + `score`), separated by `vs`
  - Score-gap percentage (small muted text)
  - **Resolve →** action button

### 2. Wire the action into `ClaimsPanel`

`ClaimsPanel` already drives state from local `entity` / `entityId` / `field`. Lift those to URL params so the triage panel can deep-link.

- `ClaimsPanel` reads/writes `?claim_entity=&claim_id=&claim_field=` on mount and on change.
- Auto-runs `resolve()` when all three are present in the URL and `entity_id` is a valid UUID.
- Pre-selects `source = operator` and pre-fills the **Note** with `"Tie-breaker for {top_source} vs {next_source}"` when arriving from the triage row.
- Scrolls the claims card into view after navigation.

### 3. Place the panel on `/governance`

In `src/pages/Governance.tsx`, render `<TruthConflictsPanel />` directly above `<ClaimsPanel />`. Keep `W7SignoffChecklist` where it is.

## Technical notes

- Read shape from the existing view:
  ```ts
  type Row = {
    entity: string;
    entity_id: string;
    field: string;
    top_source: string | null;
    top_score: number | null;
    next_source: string | null;
    next_score: number | null;
  };
  ```
- Sort client-side by `(top_score - next_score)/top_score` ascending (tightest tie first), then by entity.
- Realtime: `supabase.channel(\`gov-conflicts-${useId()}\`)` listening to `postgres_changes` on `public.claims`, refetch on any event. Conflicts only change when claims do.
- No new migration — `truth_conflicts` view + `claims` RLS are already in place.
- No change to `sentinel-tick/checks.ts` or `resolve_truth`.

## Definition of done

- New panel renders on `/governance`, shows live count, empty state works.
- Clicking **Resolve →** scrolls to `ClaimsPanel` with entity/id/field pre-filled and the resolver auto-run.
- Filing an operator claim that breaks the tie causes the conflict row to disappear from the panel within ~1s (via realtime).
- No TypeScript or lint regressions.
- `mem://features/claims-pipeline` gets a one-line update noting the new triage surface.

## Out of scope

- Bulk resolve, inline-claim form on the triage row, sentinel UI changes, paging — single-list view is enough at the expected volumes (sentinel goes `high` at ≥5).
- Any change to the 10% threshold or scoring rules.
