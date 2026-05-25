# ADR-0003: Tenant-node ancestry storage strategy

- **Status:** accepted
- **Date:** 2026-05-21 (decided), 2026-05-25 (status flip — option 4 shipped, `tenant_nodes.ancestry_ids uuid[]` live, 1100-row seeded corpus, `tg_tenant_nodes_set_ancestry` trigger maintaining the array on every insert/move)


## Context

Phase 5's resolver and Phase 6's canonical-fact RLS both need to answer "is node X in the subtree of node Y?" cheaply. Expected tree depth is 6+ (group → region → site → building → floor → asset → sub-asset). Expected node count at the 12-month horizon is 10k–100k per tenant, several million across all tenants.

Four storage options:

1. **Materialised path** (`text` column like `/grp1/reg-eu/site-42/...`). Cheap reads via `LIKE`/`text_pattern_ops` index; expensive moves (subtree rewrite).
2. **`ltree` extension**. Native ancestry operators (`<@`, `@>`), GiST index. Adds an extension dependency; column type changes are awkward to migrate.
3. **Recursive CTE** over a `parent_id` column. No schema scaffolding; slow at scale; every RLS check pays the recursion cost.
4. **Denormalised `ancestry_ids uuid[]`** on every node + every fact. GIN index over the array. Fastest read; biggest write amplification on subtree moves; doubles fact-table row size.

## Decision

**Option 4 — denormalised `ancestry_ids uuid[]`** on every `tenant_nodes` row, maintained by `tg_tenant_nodes_set_ancestry` (`BEFORE INSERT OR UPDATE OF parent_id`). GIN index over the array. Reads (RLS predicate and resolver) are a single array-containment check; writes pay an array-rebuild only on subtree moves (rare).

This locks in: ADR-0005 (resolver scoring) and ADR-0006 (embedding store) can both assume O(1) ancestry lookup.


> Benchmark + dataset requirements: see [`docs/adr/benchmarks.md § ADR-0003`](./benchmarks.md#adr-0003--tenant-node-ancestry-storage).

## Consequences

To be filled in once the decision lands. Reversal cost varies by option — note explicitly which other ADRs (resolver scoring 0005, embedding store 0006) lock in once this one does.
