# W7.1 — Decision Authority (truth arbitration v0)

The smallest possible step that converts AWIP from "we record things" to "we decide things." One table, one resolver function, one read-only surface in the existing Ontology page. No new cron, no new edge function, no UI for editing rules — rules ship as seed rows and change via migration + CHANGELOG (same pattern as `docs/ontology.md`).

## What ships

### 1. `decision_authorities` table
Per (entity, field) tuple, a precedence-ordered list of sources with a confidence weight and an override policy.

```text
entity        text     -- one of the 11 ontology entities (FK-by-convention to docs/ontology.md)
field         text     -- field name on that entity ('name', 'owner', 'status', '*' = all)
source        text     -- 'bim' | 'finance' | 'operator' | 'ai' | 'sensor' | 'external_review' | ...
precedence    int      -- lower = wins (1 is highest authority)
weight        numeric  -- 0..1, multiplied into confidence
override_policy text   -- 'hard' (never overridable) | 'operator_only' | 'soft' (anything higher precedence wins)
notes         text
```

RLS: operator-only read+write. Realtime on.

### 2. `resolve_truth(entity, entity_id, field) → jsonb`
SECURITY DEFINER function that returns the winning value, source, precedence, weight, and the full ranked list of contenders. v0 reads from a new `truth_claims` view that the next slice will fill — for now it just returns the **rules** that *would* arbitrate, plus a `status: 'no-claims-yet'` marker. This proves the contract without forcing us to also build the claims pipeline today.

```json
{
  "entity": "Asset",
  "field": "owner",
  "winner": null,
  "status": "no-claims-yet",
  "rules": [
    { "source": "operator", "precedence": 1, "override_policy": "operator_only", "weight": 1.0 },
    { "source": "bim",      "precedence": 2, "override_policy": "soft",          "weight": 0.8 },
    { "source": "ai",       "precedence": 3, "override_policy": "soft",          "weight": 0.4 }
  ]
}
```

### 3. `decision_authority_events`
Append-only log of every rule mutation. Same shape as `okr_node_events` / `capability_events` — fits the existing "every governance change emits an event" core rule.

### 4. Seed rows
One default rule per entity from `docs/ontology.md`, derived from each entity's stated `ownership` field. Operator can override later via migration.

### 5. Read-only surface on `/ontology`
Add a "Decision authority" section per entity card showing the ranked rules. No editor. Link to `docs/decision-authority.md` (new doc) for "how to change a rule."

### 6. Docs + memory
- `docs/decision-authority.md` — concept, table shape, resolver contract, how to add a rule via migration
- `mem/features/decision-authority.md` — terse rule, points back to doc
- Update `mem/index.md` Core: add a one-liner that arbitration goes through `resolve_truth(...)`
- `CHANGELOG.md` entry under W7

## What does NOT ship in this slice
- `truth_claims` table and the ingestion pipeline that fills it (W7.2)
- Confidence decay / temporal weighting (W7.3)
- Operator reliability history (W7.4)
- Editing UI for rules (deliberate — keep rules in git like ontology)
- Touching any existing job, edge function, or page beyond the Ontology read-only addition

## Verification (what I'll check before saying done)
1. Migration applies; linter clean; RLS forces operator-only.
2. `select resolve_truth('Asset', gen_random_uuid(), 'owner')` returns the seeded ranked rules with `status: 'no-claims-yet'`.
3. `/ontology` renders the new section without breaking existing cards.
4. `docs/decision-authority.md` and `mem/features/decision-authority.md` exist; `mem/index.md` Core line added.
5. No new cron, no new edge function, no model routing changes.

## Why this is the right next move
Maps 1:1 to the critique's #1 gap ("no decision hierarchy") with the smallest possible surface area. Every later slice (claims, decay, reliability) extends this table — without it, none of them have a place to land. Stops AWIP from accidentally building three more subsystems in parallel.
