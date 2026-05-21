## Phase 5 — Sprint s5.2 (resolver scoring + ancestry)

Built with the `rigorous-planning` skill — sections below mirror its required output format.

### Goal

Promote `entity-resolve` from "deterministic match only" to "weighted match + ancestry-aware + last-resort embedding hint", and flip ADR-0003 from `proposed` → `accepted` with real bench numbers — unblocking s5.3 (alias lifecycle) and then Phase 6 ingest.

### Non-goals

- Alias revoke / merge / split flows (those are s5.3).
- Conflict approve/reject UI + `resolve_truth()` wiring (s5.3).
- Any Phase 6 work (ingest, canonicalisation, `fact_conflicts`).
- Replacing pgvector with another store — embedding-hint reuses `awip_doc_chunks` patterns + `gemini-embedding-001` per ADR-0006.

### Blast radius & Core rule / ADR / FM-AI cited

- **Tables touched:** `public.tenant_nodes` (add `ancestry_ids uuid[]`), new `public.descriptor_weights`, new view `public.v_resolver_health`.
- **Edge fn:** `supabase/functions/entity-resolve/index.ts` (scoring loop, embedding-hint).
- **Contract:** `supabase/functions/_shared/contracts/retrieval-resolver.ts` already binds `embedding_hint` source — no schema change, only implementation.
- **Bench:** new `scripts/adr-bench/adr-0003-ancestry.ts`.
- **Core rule defused:** "Resolver never crosses `tenant_id`" (CONTEXT.md §3, mem://features/entity-resolver invariants). Tested by existing `e2e/resolver.test.ts` cross-tenant gate + new scoring tests.
- **ADR cited:** ADR-0003 (decision lands here); ADR-0006 (embedding model — reused, not re-opened).
- **FM-AI failure mode defused:** "agent improvises retrieval" (mem://preferences/contract-first) — embedding-hint is gated by confidence band, not free-form vector search; `RESOLVER_RETRIEVAL_CONTRACT.fallback` is the source of truth.

### Alternatives considered

| Option | Cost | Risk | Reversibility | Verdict |
| --- | --- | --- | --- | --- |
| **A. Denormalised `ancestry_ids[]` + GIN (chosen)** | one trigger to maintain on parent_id move | write amplification on subtree moves (rare per ADR-0003) | high — drop column + restore parent_id walk | Chosen — RLS hot path is read-heavy, moves are rare, matches ADR-0003 current lean |
| B. `ltree` extension | extension install + column type migration | extension load order vs pgvector | medium — column rewrite | Discarded — ADR-0003 explicitly flags as fallback only if `ancestry_ids` fails the bench |
| C. Recursive CTE only (current s5.1 behaviour) | none | every RLS check pays recursion at 6+ depth | trivial | Discarded — already shown slow at depth >4 in dev; doesn't scale to 100k nodes |
| D. Defer ancestry to Phase 6 | none now | Phase 6 ingest blocks on RLS performance; bench data won't exist when ADR-0003 needs to flip | trivial | Discarded — same blocker reappears worse |

For scoring weights: chose **table-driven (`descriptor_weights`)** over hardcoded constants so per-tenant overrides land in s5.3 without a code change. Discarded "JSONB column on tenants table" because it skips RLS and audit.

### Contract (cron / edge-fn / agent)

`RESOLVER_RETRIEVAL_CONTRACT` already declared in `_shared/contracts/retrieval-resolver.ts` — no new contract. This sprint:
- Implements `matchSource: "embedding_hint"` (declared in `RESOLVER_MATCH_ORDER` but absent from s5.1).
- Adds `confidence_band` to `entity_resolution_events.payload` for the new bands.
- Honours `RESOLVER_RETRIEVAL_CONTRACT.fallback` literally: zero candidates → empty (never invent a node).

Night window: embedding-hint calls `pickModel()` from `_shared/model-policy.ts` — 22:00–06:00 UTC forces `google/gemini-2.5-flash-lite`. Other hours use `google/gemini-embedding-001` per ADR-0006.

### Persona sign-off

- **event-engineer:** every `tenant_nodes` UPDATE that changes `parent_id` must re-emit the `entity_resolution_events` row and recompute `ancestry_ids` → handled by trigger `tg_tenant_nodes_ancestry_recompute` (step 1 of migration).
- **tenant-manager:** `descriptor_weights` is tenant-scoped (`tenant_id uuid not null`) with admin-only RLS — no cross-tenant weight leak. Default seed row uses `tenant_id = '00000000-...'` sentinel resolved by `coalesce(per_tenant, default)` in the scorer.
- **compliance-auditor:** ADR-0003 flip requires bench numbers in Consequences + CHANGELOG `### Decided` bullet — both in step 6.
- **sentinel:** new `v_resolver_health` view backs a `resolver_low_confidence_rate` sentinel check (>20% of resolves in the `<0.55 no_match` band over 24h → medium). Added to `sentinel-tick` in step 5.
- **product-historian:** ADR-0003 status change + ADR-0006 cross-reference in Consequences; CHANGELOG + `mem/features/entity-resolver.md` appended in step 7.

### Gap checklist

- [x] Idempotency-Key — already enforced on `/bind`, `/alias/create`; `/resolve` is read-only, no key needed.
- [x] `*_events` emission — `entity_resolution_events` row on every `propose` (already wired) + new `ancestry_recompute` kind on trigger.
- [x] RLS + `has_role()` — new `descriptor_weights` table admin-only; view `v_resolver_health` operator-readable.
- [x] Realtime — `descriptor_weights` added to `supabase_realtime` publication (admin UI lands in s5.3).
- [x] `observability_registry` — entry for `view:v_resolver_health` and bumped entry for `edge_fn:entity-resolve` (capability description update).
- [x] `withLogger` — entity-resolve already wrapped; no new fn.
- [x] No new `any` — scoring loop typed against `ResolverRetrievalOutput`.
- [x] mem update — append "s5.2" section to `mem/features/entity-resolver.md`; new index line is **not** needed (rule already in index via existing entry).
- [x] CHANGELOG — `### Decided` bullet for ADR-0003 + `### Added` bullets for scoring + embedding-hint.
- [x] Doc updates — `docs/adr/0003-tenant-node-ancestry-storage.md` Consequences filled; `docs/adr/benchmarks.md` ADR-0003 row marked done.

### Test plan

| Path | Proves |
| --- | --- |
| `e2e/resolver.test.ts::weighted_score_authoritative_beats_fts` | authoritative descriptor outranks an FTS match even at higher textual overlap |
| `e2e/resolver.test.ts::confidence_band_auto_bind` | descriptor giving ≥0.85 score returns `authoritativeHit=true` OR a single high-confidence candidate flagged for auto-bind |
| `e2e/resolver.test.ts::confidence_band_conflict` | two competing alias_fts hits each in 0.55–0.85 band emit a `conflict_open` event row |
| `e2e/resolver.test.ts::confidence_band_no_match` | all candidates <0.55 returns empty `candidates[]` (never invents a node) |
| `e2e/resolver.test.ts::ancestry_materialised_matches_walk` | candidate `ancestry[]` from new `ancestry_ids[]` equals the old parent_id walk for the same fixture |
| `e2e/resolver.test.ts::embedding_hint_last_resort_only` | embedding-hint never fires when authoritative or alias_exact already hit |
| `scripts/adr-bench/adr-0003-ancestry.ts` | populates `subtree_query_p95_ms`, `rls_check_p95_ms`, `subtree_move_p95_ms`, `index_bytes` rows in `adr_bench_results` at 10k / 50k / 100k nodes |

Compose with `tdd` skill: failing tests committed in step 2 before scoring logic in step 3.

### Implementation steps

1. **Migration** — add `ancestry_ids uuid[]` to `tenant_nodes` + GIN index; trigger `tg_tenant_nodes_ancestry_recompute` on INSERT/UPDATE of `parent_id` (uses a CTE to walk up; iteration cap 32); backfill all existing rows. Create `descriptor_weights (id, tenant_id, kind, weight numeric, created_by, created_at)` with default seed row (postcode 0.9, authoritative 1.0, name 0.7, asset_code 0.7, address 0.7, other 0.5). Create view `v_resolver_health` aggregating last-24h `entity_resolution_events` by confidence band.
2. **Failing tests** — extend `e2e/resolver.test.ts` with the seven new cases above.
3. **Scoring rewrite** — replace constants in `entity-resolve/index.ts` with a `loadWeights(tenantId)` helper; introduce `bandFor(score) → "auto_bind" | "conflict" | "no_match"`; emit `conflict_open` event when band is `conflict`; switch ancestry walk to read `ancestry_ids[]` directly.
4. **Embedding-hint** — only when `byNode.size < topK` AND no `alias_exact` hit. Call Lovable AI Gateway `/v1/embeddings` via `pickModel('embed')`; query `awip_doc_chunks` (tenant-scoped) with cosine sim; cap score at 0.6 (never auto-bind from embedding alone).
5. **Sentinel check** — add `resolver_low_confidence_rate` to `sentinel-tick`; register in `observability_registry`.
6. **Bench + ADR flip** — write `scripts/adr-bench/adr-0003-ancestry.ts`; run at 10k/50k/100k; if thresholds met, edit ADR-0003 Consequences + flip status; otherwise stop and re-plan per the discarded-options table.
7. **Docs + mem + CHANGELOG** — fill ADR-0003 Consequences with the table; append `mem/features/entity-resolver.md`; CHANGELOG `### Decided` + `### Added`; mark roadmap sprint `s5.2` as `done` once gates green.

### Validation gates

| Gate | Command | Pass criteria |
| --- | --- | --- |
| Lint ratchet | `bun run lint:ratchet` | exit 0; no new `any` |
| Logger coverage | `bun run scripts/check-logger-coverage.ts` | exit 0 |
| Doc drift | `bun run scripts/check-doc-drift.ts` | exit 0 |
| Vitest | `bunx vitest run` | all green |
| E2E resolver | `bunx vitest run -c vitest.e2e.config.ts e2e/resolver.test.ts` | all 7 new + 5 existing cases green |
| Migration applied | `supabase--read_query select column_name from information_schema.columns where table_name='tenant_nodes' and column_name='ancestry_ids';` | one row |
| Edge fn live (happy) | `supabase--curl_edge_functions POST /entity-resolve/resolve` | 200 with `confidenceBand` in payload |
| Edge fn auth | same without `x-service-token` and no Bearer | 401 |
| Bench row landed | `supabase--read_query select max(ran_at) from adr_bench_results where adr='ADR-0003';` | within last hour |
| ADR status flipped | `code--view docs/adr/0003-tenant-node-ancestry-storage.md` | `Status: accepted` + filled Consequences table |
| Observability registry | `supabase--read_query select * from v_observability_registry_status where surface_id in ('view:v_resolver_health','edge_fn:entity-resolve');` | both present, not stale |

Fix loop: any gate failure → fix in place → re-run. Don't move failures to Out-of-scope unless they prove the plan itself is wrong. Per `mem://preferences/verify-completion`: never claim done without running each gate.

### On approval

Implement steps 1 → 7 in order. Pause for review after step 6 (ADR flip) before step 7 (memory + CHANGELOG). Don't start s5.3 in the same loop.

### Out of scope

- Per-tenant weight editing UI (s5.3 Admin panel work).
- Alias revoke / merge / split (s5.3).
- `resolve_truth()` wiring for resolver conflicts — conflicts open the event row only; arbitration lands in s5.3.
- Replacing `awip_doc_chunks` as the embedding-hint store with a Phase-6-owned vector table (Phase 6).
- Telegram alert for `resolver_low_confidence_rate` — sentinel finding only this sprint; routing decision is a chat-first conversation per `mem://preferences/chat-first-policy-requests`.
- Operational debts: stalled crons reactivation, `telegram_send_log` writer, no-explicit-any ratchet cleanup (tracked elsewhere).

Footer feeds `plan-footer-ingest` per the `awip-session-lifecycle` skill.