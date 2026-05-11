# Decision Authority (W7.1)

When two sources disagree about a fact (e.g. BIM says one asset owner, finance
says another, AI suggests a third), AWIP needs a deterministic answer.
The Decision Authority layer provides that — as data, not code.

## Tables

### `decision_authorities`
The rule set. Per `(entity, field)` tuple, a precedence-ordered list of sources.

| column | meaning |
|---|---|
| `entity` | One of the 11 ontology entities (`docs/ontology.md`) |
| `field` | Field name (`owner`, `status`, …) or `*` for the whole entity |
| `source` | `operator`, `ai`, `bim`, `finance`, `ci`, `system`, `external_review`, … |
| `precedence` | Lower wins. Field-specific rules beat `*` rules at the same precedence |
| `weight` | 0..1, used to compute confidence in W7.3 |
| `override_policy` | `hard` (immutable) · `operator_only` (only operator may override) · `soft` |
| `notes` | Free text |

### `decision_authority_events`
Append-only log of every rule mutation. Same shape as `okr_node_events`.

## Function

```sql
select public.resolve_truth(
  _entity     => 'Asset',
  _entity_id  => '00000000-0000-0000-0000-000000000000'::uuid,
  _field      => 'owner'
);
```

Returns:

```json
{
  "entity": "Asset",
  "entity_id": "...",
  "field": "owner",
  "winner": null,
  "status": "no-claims-yet",
  "rules": [
    { "source": "operator", "precedence": 1, "weight": 1.0, "override_policy": "operator_only", "notes": "..." },
    { "source": "ai",       "precedence": 9, "weight": 0.4, "override_policy": "soft",          "notes": "..." }
  ]
}
```

In v0 only the *rules* are returned — the claims pipeline that fills in
`winner` lands in W7.2 (`truth_claims` table + ingestion).

## Changing a rule

Rules live in the database but are **operator-curated**, not user-edited
through the UI. To change a rule:

1. Write a migration that `INSERT … ON CONFLICT (entity, field, source) DO UPDATE`
   on `public.decision_authorities`.
2. Add a `CHANGELOG.md` entry under W7 explaining *why*.
3. The trigger automatically appends a row to `decision_authority_events`.

This keeps the arbitration model versioned in git, the same way `docs/ontology.md`
is the source of truth for entity definitions.

## Seeded defaults

Every ontology entity ships with two rules:

- `operator` at precedence 1, `override_policy = operator_only`
- `ai` at precedence 9, `weight = 0.4`, `override_policy = soft`

Two exceptions:

- `TestRun` — `ci` is the sole authority (`hard`); operator can annotate but not override.
- `CapabilityEvent` — `system` is the sole authority (`hard`); these are emitted by triggers and immutable.

## Surface

`/ontology` shows a read-only "Decision authority" card listing every rule per
entity. No edit affordance — that's intentional.

## Out of scope (later slices)

| Slice | Adds |
|---|---|
| W7.2 | `truth_claims` table + ingestion; `resolve_truth` returns the actual winner |
| W7.3 | Confidence decay over time + source reliability weighting |
| W7.4 | Operator reliability history (track when operator overrides are later reverted) |
