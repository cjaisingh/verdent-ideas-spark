# ADR-0003: Tenant-node ancestry storage strategy

- **Status:** proposed
- **Date:** 2026-05-21

## Context

Phase 5's resolver and Phase 6's canonical-fact RLS both need to answer "is node X in the subtree of node Y?" cheaply. Expected tree depth is 6+ (group → region → site → building → floor → asset → sub-asset). Expected node count at the 12-month horizon is 10k–100k per tenant, several million across all tenants.

Four storage options:

1. **Materialised path** (`text` column like `/grp1/reg-eu/site-42/...`). Cheap reads via `LIKE`/`text_pattern_ops` index; expensive moves (subtree rewrite).
2. **`ltree` extension**. Native ancestry operators (`<@`, `@>`), GiST index. Adds an extension dependency; column type changes are awkward to migrate.
3. **Recursive CTE** over a `parent_id` column. No schema scaffolding; slow at scale; every RLS check pays the recursion cost.
4. **Denormalised `ancestry_ids uuid[]`** on every node + every fact. GIN index over the array. Fastest read; biggest write amplification on subtree moves; doubles fact-table row size.

## Decision

**TBD** — decide when sprint `s5.2` opens. Trigger: first real tenant tree imported and we have row-count + depth measurements rather than estimates.

Current lean: option 4 (denormalised `ancestry_ids[]` on facts) because RLS is on every read path and moves are rare. Validate against import sample first.

> Benchmark + dataset requirements: see [`docs/adr/benchmarks.md § ADR-0003`](./benchmarks.md#adr-0003--tenant-node-ancestry-storage).

## Consequences

To be filled in once the decision lands. Reversal cost varies by option — note explicitly which other ADRs (resolver scoring 0005, embedding store 0006) lock in once this one does.
