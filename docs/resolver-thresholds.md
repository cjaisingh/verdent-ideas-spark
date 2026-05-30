# Resolver thresholds (s5.2/t2)

Operator-editable cut-offs that decide whether an entity-resolver score
becomes an **auto-bind**, a **conflict** awaiting human review, or a **no match**.

## Tables

| Table | Purpose |
|---|---|
| `resolver_thresholds` | Live band cut-offs (one row per band). Seeded `auto_bind=0.95`, `conflict=0.60`, `no_match=0.00`. |
| `resolver_thresholds_audit` | Append-only change log. Reason ≥ 8 chars enforced. |
| `resolver_decisions.band_thresholds_snapshot` | jsonb snapshot of the thresholds in force at the moment of each decision — makes every band assignment replayable. |
| `resolver_decisions.matched_kinds` | text[] of descriptor kinds that contributed to the composite score. |

## Composite scorer (s5.2/t1)

`public.resolve_entity(_tenant_id, _descriptors)`:

1. **Authoritative short-circuit.** Any descriptor with `resolver_descriptor_weights.weight >= 0.95` that exact-matches an alias wins immediately at `confidence=1.0`.
2. **Composite pass.** Collect all `(node_id, kind, weight)` matches across descriptors. Per candidate node, `score = LEAST(1.0, SUM(weight))`. Highest score wins. Tie-break on `node_id ASC` for determinism.

`public.resolve_entity_logged(...)` wraps the scorer, reads `resolver_thresholds` once per call, bands the confidence, writes the decision row, and emits a `tenant_node_events('resolve')` row on a winner.

## Editing thresholds

```bash
curl -X PUT $SUPABASE_URL/functions/v1/awip-api/resolver/thresholds \
  -H "Authorization: Bearer $OPERATOR_JWT" \
  -H "Idempotency-Key: thr-$(date +%s)" \
  -H "Content-Type: application/json" \
  -d '{"thresholds":[{"band":"auto_bind","min_score":0.92},{"band":"conflict","min_score":0.55},{"band":"no_match","min_score":0.0}],"reason":"lowering bar after Q2 review"}'
```

UI: `/admin/resolver`.

Validation:
- `auto_bind > conflict > no_match >= 0`, each in `[0, 1]`.
- `reason` ≥ 8 chars (audit requirement).
- Idempotency-Key mandatory; same key + different body → `409`.

## RLS helper (s5.2/t4)

`public.is_in_tenant_subtree(_node_id uuid) → boolean` — universal predicate.

```sql
-- Example RLS policy for any future tenanted table:
CREATE POLICY "tenant scoped"
  ON public.fm1_stakeholder_profiles FOR SELECT TO authenticated
  USING (public.is_in_tenant_subtree(tenant_node_id));
```

Operator/admin see everything. Service-token / module callers see only nodes
whose `tenant_id` matches their JWT `tenant_id` claim or sits in the node's
`ancestry_ids`. Backed by ADR-0003 (denormalised `ancestry_ids[]`).

## CI guard (s5.2/t5)

`scripts/check-resolver-log-coverage.ts` greps `supabase/functions/**/*.ts`
for direct `resolve_entity(...)` calls — they MUST go through
`resolve_entity_logged(...)` so every resolution lands in `resolver_decisions`.
Build fails non-zero on any offender.

Run locally:

```bash
deno run --allow-read scripts/check-resolver-log-coverage.ts
```

## Sentinel watcher

`sentinel-tick → resolver_no_log_in_window` (severity `high`) compares
`entity-resolve` invocations in `edge_logs` against `resolver_decisions`
inserts over the last 15 minutes. A gap > 5 fires a finding.
