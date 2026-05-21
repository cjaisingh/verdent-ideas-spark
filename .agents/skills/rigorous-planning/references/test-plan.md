# Test plan derivation

Every new behaviour gets one named test. Pick the level by the decision tree below; pure logic does not need an e2e, and an edge fn does not skip its unit test.

## Decision tree

- Pure TS function (no I/O) → **vitest** under `src/**/*.test.ts` (mirrors source path).
- DB schema / trigger / policy → **read_query assertion** in `e2e/*.test.ts` using `supabase--read_query` to verify the row shape, then a positive + negative fixture.
- Edge function → **Deno test** colocated as `<fn>/handler_test.ts` for pure logic, **`supabase--curl_edge_functions`** for the deployed path (idempotency key, 400 on bad body, 401 without auth, 200 happy path).
- UI flow → **playwright** under `e2e-playwright/*.spec.ts`.
- ADR-touching change → **bench script** under `scripts/adr-bench/<adr-id>-<name>.ts` that writes a row into `adr_bench_results`; flip ADR `proposed → accepted` with the numbers in Consequences.
- Cron/agent loop → fixture-driven Deno test + dry-run with `?dry=1` query string before live deploy.

## Required test cases per behaviour

For every endpoint or mutation, name explicit tests for:

1. Happy path.
2. Auth missing / wrong → 401.
3. Bad body → 400 with field errors.
4. Same `Idempotency-Key` + same body → identical response.
5. Same `Idempotency-Key` + different body → 409.
6. Cross-tenant access → empty/deny (use `e2e/rls-matrix.test.ts` pattern).

For every new table:

1. RLS denies a fixture in the wrong role.
2. RLS allows a fixture in the right role.
3. Trigger emits the `*_events` row on INSERT/UPDATE/DELETE.

## Compose with `tdd`

Write the failing test first, watch it fail, then implement. Skip only when adding a contract/type declaration that has no runtime behaviour.

## Output

Into the plan's "Test plan" section, list each test as `path::name — what it proves`. Example:

```
e2e/resolver.test.ts::cross_tenant_alias_collision — alias in tenant A is invisible to tenant B
supabase/functions/entity-resolve/handler_test.ts::idempotency_409 — same key + different body returns 409
scripts/adr-bench/adr-0003-ancestry.ts — p95 ancestor lookup at depth 14, 100k nodes
```
