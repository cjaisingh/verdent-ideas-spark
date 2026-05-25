# Plan: close s5.1 + open s6.1 — domain & data frameworks foundation

## Goal

Ship the three foundational pieces that unblock every downstream Phase 5/6 task:

1. **`resolve_entity()`** — deterministic, auditable entity resolution against `tenant_node_aliases`, returning a canonical `tenant_node_id` (or a `pending` conflict id).
2. **Cross-tenant isolation test suite** — proves both invariants from Q6 (universal RLS predicate + service-token tenant pin) under hostile fixtures.
3. **Retrieval-shape declaration (`s6.1/t0`)** — every existing and planned agent surface declares which of the 5 shapes (prose / hierarchical-doc / tabular / graph / relational / time-series) it consumes, so Phase 6 store choices are forced before vendor lock.

## Non-goals

- Composite scorer with descriptor weights (s5.2/t1) — deterministic-only for v1 per Q5; weights wait for measured fuzzy-band conflicts.
- Merge/split operator UX (s5.3/t4) — `discussion_action` queue only for now.
- Picking the actual retrieval stores (pgvector vs LanceDB vs DuckDB vs Neo4j). Declaration first, vendor later.
- Backfilling `ancestry_ids[]` on `tenant_node_aliases` rows beyond the 1100 seeded — bench corpus only.

## Blast radius & cited rules

- **Tables touched (RW):** `tenant_node_aliases` (read), `entity_resolution_conflicts` (insert), `entity_resolution_events` (insert), `retrieval_contracts` (new).
- **Tables touched (read-only):** `tenant_nodes`, `tenant_node_memberships`, `decision_authorities`.
- **No tenant data crossed.** All writes obey RLS + universal predicate.

- **Core rule:** "all write endpoints idempotent via `Idempotency-Key`" → `resolve_entity()` is read-mostly but the conflict-insert path uses `(tenant_id, candidate_fingerprint)` as a natural idempotency key.
- **Core rule:** "Every OKR mutation → `okr_node_events`" extended in spirit → every resolution writes `entity_resolution_events` (already exists per `tenant_node_events` family).
- **ADR-0003:** denormalised `ancestry_ids[]` already chosen and live — resolver reads it directly, no recursive CTE.
- **ADR-0004:** soft-revoke is the default — `resolve_entity()` filters `revoked_at IS NULL` unless `include_revoked=true` (operator-only).
- **FM-AI failure mode:** "silent privilege creep" — every resolver call writes an `entity_resolution_event` with `actor`, `principal_kind`, `decided_by_rule_id` so retroactive audit is trivial.
- **Q9 lock-in:** `tenant_node.merge/split/identity` are operator-exclusive (rules already seeded, verified).

## Alternatives considered

| Option | Why discarded |
|---|---|
| **A. Ship the composite scorer (s5.2/t1) first** | Premature — Q5 locked deterministic-only for v1. Building weights before measuring fuzzy-band collisions is exactly the over-engineering Phase 5 was scoped to avoid. |
| **B. Ship s6.1/t1-t6 (raw/staged/canonical/source/ingest tables) before t0** | Locks the schema before declaring what each consumer needs. Three stores ago we learned this lesson — `mem://preferences/retrieval-shapes` exists precisely to stop this. |
| **C. Skip cross-tenant isolation tests until s5.3** | Every Phase 6 ingest path will write through the resolver. Without isolation tests we cannot trust any of those writes. Cost now: 1 day. Cost later: a CRITICAL sentinel + tenant-data incident. |
| **D. Chosen — t3 + t5 + s6.1/t0 in one lane** | Smallest set that (a) makes the resolver real, (b) proves isolation, (c) forces the retrieval-shape conversation before any Phase 6 ingest table exists. |

## Contract

Two new typed contracts under `supabase/functions/_shared/contracts/`:

### `resolve-entity.ts`

```ts
export type ResolveEntityInput = {
  tenant_id: string;            // operator JWT tenant or service-token pinned
  candidate: {
    kind: "email_domain" | "display_name" | "lei" | "companies_house_number" | "free_text";
    value: string;
    confidence?: number;        // 0..1, default 1.0
  };
  parent_hint?: string | null;  // tenant_node_id to scope the search
  include_revoked?: boolean;    // operator-only; default false
  idempotency_key?: string;     // optional; if present, replay returns same conflict id
};

export type ResolveEntityOutput =
  | { status: "matched"; tenant_node_id: string; alias_id: string; rule_id: string; score: number }
  | { status: "pending"; conflict_id: string; candidates: Array<{ tenant_node_id: string; score: number }> }
  | { status: "no-match" };
```

### `retrieval-shape-declaration.ts`

Extends `retrieval-contract.ts` with a registry row per consumer:

```ts
export type RetrievalShapeDeclaration = RetrievalContractMeta & {
  consumer: string;             // e.g. "morning-review", "companion-cloud-chat", "awip-reviews"
  consumer_kind: "edge_fn" | "cron" | "ui_route" | "agent_loop";
  status: "declared" | "implemented" | "deprecated";
};
```

Declarations live in `public.retrieval_contracts` (new table, see Test plan), one row per consumer, asserted at boot.

## Persona sign-off

| Persona | Objection it would raise | How plan answers |
|---|---|---|
| `tenant-manager` | "Cross-tenant leak via resolver bypass." | s5.1/t5 hostile-fixture suite asserts every read path returns 0 rows for the wrong tenant; CI gate. |
| `event-engineer` | "Mutation without event." | Every conflict-insert and every successful match writes `entity_resolution_events` row in same transaction (trigger, not handler). |
| `compliance-auditor` | "Silent rule changes." | Resolver writes `decided_by_rule_id` referencing `decision_authorities.id` — git-versioned per the W7.1 contract. |
| `okr-strategist` | "Resolver doesn't touch OKRs, why now?" | Phase 6 ingest will create staged_records that map to KRs by tenant_node — without a real resolver, KR rollups land on `tenant_id=NULL`. |
| `product-historian` | "ADR-0003 was 'TBD' last I checked." | Already resolved to option 4 — but the ADR file still says `TBD`. Updating ADR-0003 status to `accepted` is part of this plan. |
| `sentinel` | "What detects resolver regressions?" | New sentinel check `resolver_no_match_burst` (p95 no-match rate > 20% in 1h → medium). |
| `capability-architect` | "Is `resolve_entity` a capability?" | Yes — registered as `entity_resolution.deterministic_v1` in `capability_events`. |
| `control-plane-operator` | "No routing in Core." | Resolver is a pure function. No dispatch, no "who calls next." |
| `demand-analyst` | "Who's asking for this?" | Every Phase 6 ingest task (s6.1–s6.3, 18 tasks) blocks on it. Demand is structural. |

## Gap checklist

- [x] Idempotency — `(tenant_id, candidate_fingerprint)` natural key on conflict insert
- [x] Events emission — `entity_resolution_events` row per call (trigger, not handler)
- [x] RLS + `has_role` — every new RPC `SECURITY DEFINER` + `has_role(auth.uid(), 'operator')` gate
- [x] Realtime — `retrieval_contracts` added to `supabase_realtime` publication
- [x] `observability_registry` — new entry for `resolver_no_match_burst`
- [x] `withLogger` — `resolve-entity` edge fn wrapped
- [x] No new `any` — both contracts strictly typed
- [x] Mem rule — update `mem://features/entity-resolver.md` (exists, needs t3 status flip) + new `mem://features/retrieval-contracts-registry.md`
- [x] CHANGELOG — single entry per task (t3, t5, s6.1/t0)
- [x] Doc updates — `docs/architecture.md` resolver section, new `docs/retrieval-contracts.md`, ADR-0003 `proposed → accepted`

## Test plan

| Layer | File | Asserts |
|---|---|---|
| Unit (vitest) | `src/lib/resolve-entity.test.ts` | Domain normalisation (`Foo@Acme.COM` → `acme.com`), Levenshtein bands, revoked-alias filter |
| RPC (deno) | `supabase/functions/resolve-entity/test.ts` | Matched / pending / no-match round-trip; idempotency replay returns same conflict_id |
| Edge fn (curl) | `e2e/resolver.test.ts` (exists, extend) | Service-token + operator JWT both work; wrong tenant returns 403 |
| Isolation (vitest) | `e2e/tenant-resolve-isolation.test.ts` (exists, extend) | 5 hostile fixtures: cross-tenant parent_hint, service-token tenant override, revoked-alias bypass, conflict-insert leak, RLS bypass via SECURITY DEFINER |
| RLS matrix | `e2e/rls-matrix.test.ts` (regen via `scripts/generate-rls-map.ts`) | `retrieval_contracts` policies present for operator/admin/service_role |
| Bench | `scripts/adr-bench/adr-0005-bulk-conflicts.ts` (exists) | p95 resolve ≤ 50ms at 1100-alias corpus; record to `adr_bench_results` |
| Contract assertion | `supabase/functions/_shared/contracts/retrieval_contracts_test.ts` (exists, extend) | Every `consumer` in registry has `shape`, `store`, `fallback`, `declaredBy` set |

All failing tests written before any handler code (tdd skill).

## Validation gates

Run after build, in this order. Every failure → fix in place → re-run.

```bash
# 1. Typecheck
bun run lint:ratchet            # no new `any` in resolver or contract files

# 2. Unit + integration
bunx vitest run src/lib/resolve-entity.test.ts
bunx vitest run e2e/tenant-resolve-isolation.test.ts
bunx vitest run e2e/resolver.test.ts
bunx vitest run e2e/rls-matrix.test.ts

# 3. Edge fn smoke
curl -X POST $SUPABASE_URL/functions/v1/resolve-entity \
  -H "x-awip-service-token: $AWIP_SERVICE_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"tenant_id":"<seed>","candidate":{"kind":"email_domain","value":"acme.com"}}'
# expect: {"status":"matched", ...}

# 4. RLS regen + verify
bun run scripts/generate-rls-map.ts
bun run rls:verify

# 5. Bench (record to adr_bench_results)
deno run -A scripts/adr-bench/adr-0005-bulk-conflicts.ts

# 6. Contract registry assertion
bunx vitest run supabase/functions/_shared/contracts/retrieval_contracts_test.ts

# 7. Logger coverage + delta lint (CI-equivalent)
bun run scripts/check-logger-coverage.ts
# expect: 0 unwrapped functions
```

Pass criteria: all green, bench p95 ≤ 50ms, sentinel `resolver_no_match_burst` check returns 0 findings on seeded corpus.

## Out of scope

- Composite scorer / descriptor weights (s5.2/t1, s5.2/t2) — wait for measured fuzzy-band collisions.
- Universal RLS predicate helper (s5.2/t4) — separate lane; this plan reuses existing per-table policies.
- Resolver decision log UI surface (s5.2/t5) — table writes only; UI follow-up.
- Alias approval flow (s5.3/t1) — separate lane; this plan auto-approves operator-confidence-1.0 only.
- Bulk re-resolve UX (s5.3/t3) — operator-triggered job; deferred to s5.3.
- Picking pgvector vs LanceDB vs DuckDB vs Neo4j for any shape — declaration only.
- Backfilling retrieval-shape declarations onto every consumer in one shot — declare the 6 highest-traffic surfaces (morning-review, companion-cloud-chat, awip-reviews, sentinel-tick, night-agent, claims-ingest); the rest follow.
- Hardening: revoked-alias hard-revoke path (admin-only) — ADR-0004 already specifies it, ship in s5.3/t2 follow-up.
- Phase 6 ingest tables (s6.1/t1–t6) — depend on this plan landing first.
