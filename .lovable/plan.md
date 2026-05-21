## Goal

Land Phase 5 Sprint **s5.3**: alias lifecycle (revoke / merge / split) + last-resort embedding-hint resolution + per-tenant `descriptor_weights` admin view, and flip **ADR-0004** from `proposed` → `accepted` (hybrid soft+hard cascade) once bench + first-revocation data exist. Closes Phase 5; unblocks Phase 6 ingest.

## Non-goals

- No Phase 6 fact-side cascade (no `canonical_facts.binding_status`, no `staged_records` re-quarantine path) — `canonical_facts` doesn't exist yet. ADR-0004 Consequences will say "fact-side mechanics land with Phase 6 §6.x"; the alias-side semantics are decided now.
- No `resolve_truth()` wiring for resolver `conflict_open` events — separate W7.2 work.
- No editing UI for the ontology, decision authorities, or claims (covered elsewhere).
- No Telegram routing for `alias_revoke_burst` — chat-first conversation per `mem://preferences/chat-first-policy-requests`.

## Blast radius & Core rule / ADR / FM-AI cited

- **Tables touched:** `tenant_node_aliases` (+ `supersedes_alias_id`, `merge_group_id`, `hard_revoked` bool); new `tenant_node_alias_embeddings` (vector store); `entity_resolution_events.kind` enum (+ `alias_merge`, `alias_split`, `alias_hard_revoke`); seed rows in `descriptor_weights` unchanged.
- **Edge fn:** `supabase/functions/entity-resolve/index.ts` — new endpoints `/alias/revoke`, `/alias/merge`, `/alias/split`; `/resolve` extended with embedding-hint last-resort branch.
- **Contract:** tighten `supabase/functions/_shared/contracts/retrieval-resolver.ts` — `embedding_hint` output literal pinned (`store: "tenant_node_alias_embeddings"`, `scoreCap: 0.6`).
- **UI:** new `/entities/aliases` admin (table of aliases with revoke / merge / split actions, hard-revoke modal); read-only `/entities/weights` card on the same page.
- **Sentinel:** new `alias_revoke_burst` (>10 revokes/hour same tenant → medium); existing `resolver_low_confidence_rate` stays.
- **Bench:** runnable `scripts/adr-bench/adr-0004-revocation.ts` (already a stub) → fills the 4 `METRIC_KEYS` from `tenant_node_aliases` + `entity_resolution_events`.
- **Core rule defused:** "Aliases are explicit + operator-approved + revocable" + "Resolver never crosses `tenant_id`" (both in `mem://features/entity-resolver`).
- **ADRs cited:** ADR-0004 (flips here), ADR-0006 (embedding model reused, not re-opened), ADR-0003 (still `proposed` — separate sprint blocker).
- **FM-AI failure mode:** "agent improvises retrieval" — embedding-hint stays bounded by contract (cap 0.6, store name pinned, never auto-bind from embedding alone).

## Alternatives considered

**For revocation cascade (ADR-0004):**

| Option | Verdict |
| --- | --- |
| **A. Hybrid soft+hard (chosen, current lean)** | Soft default keeps OKR rollups live; `hard_revoke` admin-only for GDPR / wrong-tenant. Matches benchmarks.md decision rule when `compliance_revocation_count_30d ≥ 1`. |
| B. Pure soft | Discarded if any compliance revocation lands in trailing 30d (per benchmarks.md threshold). |
| C. Pure hard re-quarantine | Discarded — `stale_badge_dwell_p95_days` not yet measurable; pre-emptively blocking dashboards is too aggressive. |
| D. Defer cascade design to Phase 6 | Discarded — alias revoke endpoint is a Phase 5 deliverable; we must define *something* even if fact-side mechanics defer. |

**For embedding-hint store:**

| Option | Verdict |
| --- | --- |
| Reuse `awip_doc_chunks` | Mixes operator RAG corpus with tenant alias corpus → RLS becomes mixed-mode. Rejected. |
| Column on `tenant_node_aliases` (`embedding vector(1536)`) | Bloats hot resolver table; vector index on a freq-updated row is wasteful. Rejected. |
| **Dedicated `tenant_node_alias_embeddings` table (chosen)** | Clean tenant scoping, dedicated HNSW (`vector_cosine_ops`, m=16, ef=64 per ADR-0006), no churn to RAG. |

**For merge/split semantics:**

| Option | Verdict |
| --- | --- |
| **A. `supersedes_alias_id` self-FK + `merge_group_id` uuid (chosen)** | One column per relation; merge writes new alias with N supersedes rows; split writes N aliases pointing back to one. Resolver follows chain to canonical via `coalesce(superseded_into, id)`. |
| B. Separate `alias_lineage` join table | Two tables, two RLS surfaces, no benefit at expected scale. |
| C. JSONB lineage blob | Unindexable, audit-hostile. |

## Contract (cron / edge-fn / agent)

Existing `RESOLVER_RETRIEVAL_CONTRACT` extends — no new file. Tighten the output Zod schema so embedding-hint candidates **must** carry `matchSource: "embedding_hint"`, `score ≤ 0.6`, and `store: "tenant_node_alias_embeddings"`. Three new write endpoints all require `Idempotency-Key`:

- `POST /alias/revoke` — `{ tenantId, aliasId, reason, hardRevoke?: boolean }`
- `POST /alias/merge` — `{ tenantId, intoNodeId, fromAliasIds: uuid[], reason }`
- `POST /alias/split` — `{ tenantId, sourceAliasId, intoNodeIds: uuid[], descriptors: [...] }`

Each emits the matching `entity_resolution_events` row with `payload` carrying old + new alias_ids and the `reason`. Night window forces embedding calls to `pickModel('embed')` (already lite-only via `model-policy.ts`).

## Persona sign-off

- **event-engineer:** every revoke/merge/split emits `entity_resolution_events` with both `alias_id` and the lineage payload. `okr_node_event` mirror for revokes goes through the existing `discussion_action` path (or explicit `okr_event_mirror` trigger if any KR rolls up on a revoked alias — but no `canonical_facts` yet, so this is wiring-only).
- **tenant-manager:** new alias-embeddings table is tenant-scoped + admin-only RLS. Merge across tenants rejected by `check (tenant_id_from = tenant_id_to)` trigger on `entity_resolve.merge` handler.
- **compliance-auditor:** `hard_revoke` requires `reason` text ≥ 8 chars; landing one such event in trailing 30d is the trigger to flip ADR-0004 per benchmarks.md.
- **sentinel:** add `alias_revoke_burst` check; register `view:v_alias_lineage_health` in `observability_registry`.
- **product-historian:** ADR-0004 status flip + CHANGELOG `### Decided` bullet + `mem/features/entity-resolver.md` s5.3 section.
- **capability-architect:** no new capability registration — `entity-resolve` capability description bumps to include the lifecycle endpoints.

## Gap checklist

- [ ] Migration: lineage columns on `tenant_node_aliases`, new enum values, new `tenant_node_alias_embeddings` table with HNSW index, new `v_alias_lineage_health` view.
- [ ] Idempotency-Key required on `/alias/revoke`, `/alias/merge`, `/alias/split` (same gate as `/bind`).
- [ ] `*_events` emission on every lifecycle write (trigger or handler).
- [ ] RLS + `has_role('admin')` on alias-embeddings table; operator-read on the lineage view.
- [ ] Realtime publication for `tenant_node_alias_embeddings`.
- [ ] `observability_registry` rows for the embedding table, lineage view, ADR-0004 bench surface; bump `entity-resolve` notes.
- [ ] `withLogger` already wraps `entity-resolve`; no new fn.
- [ ] No new `any` (typed against extended `ResolverRetrievalOutput`).
- [ ] Mem update: append s5.3 section to `mem/features/entity-resolver.md`.
- [ ] CHANGELOG: `### Added` (lifecycle + embedding-hint + admin UI) + `### Decided` (ADR-0004 flip).
- [ ] Doc updates: ADR-0004 Consequences table + `mem/features/phase-5-6-prep.md` ADR-0004 line moved from "proposed" to "ACCEPTED".

## Test plan

Write failing tests first (`tdd` skill).

| Path | Proves |
| --- | --- |
| `e2e/resolver.test.ts::alias_revoke_invisible_after` | revoked alias no longer matches in `/resolve`. |
| `e2e/resolver.test.ts::alias_revoke_requires_idempotency_key` | 400 without key, 200 with key, replay returns same body. |
| `e2e/resolver.test.ts::alias_hard_revoke_requires_admin_role` | operator role → 403; admin role → 200 + event row with `hard_revoke=true`. |
| `e2e/resolver.test.ts::alias_merge_redirects_old_ids` | both old `alias_id`s resolve to the new canonical node; one event per old. |
| `e2e/resolver.test.ts::alias_merge_rejects_cross_tenant` | merge across `tenant_id` returns 422 + no row written. |
| `e2e/resolver.test.ts::alias_split_emits_pair` | one alias → two; old superseded, two new visible, two events emitted. |
| `e2e/resolver.test.ts::embedding_hint_caps_at_0_6` | candidate from embedding-only path never exceeds 0.6 score. |
| `e2e/resolver.test.ts::embedding_hint_skipped_when_authoritative_hits` | no embed call when authoritative or alias_exact already hit (assertion via spy on fetch). |
| `e2e/resolver.test.ts::embedding_hint_skipped_when_topk_full` | no embed call when `byNode.size >= topK`. |
| `scripts/adr-bench/adr-0004-revocation.ts` | fills `affected_facts_p95`, `stale_badge_dwell_p95_days`, `compliance_revocation_count_30d`, `kr_rollups_grey_seconds_p95` (last is 0 pre-Phase-6). Upload to `adr_bench_results`. |

## Validation gates

| Gate | Command | Pass |
| --- | --- | --- |
| Migration applied | `select column_name from information_schema.columns where table_name='tenant_node_aliases' and column_name='supersedes_alias_id';` | one row |
| Embedding table live | `select count(*) from public.tenant_node_alias_embeddings;` | no error |
| Enum extended | `select unnest(enum_range(null::public.entity_resolution_event_kind))::text;` | includes `alias_merge`, `alias_split`, `alias_hard_revoke` |
| Edge fn happy | `curl_edge_functions POST /entity-resolve/alias/revoke` with key | 200 + event row visible in `entity_resolution_events` |
| Edge fn auth | same without `x-service-token` and no Bearer | 401 |
| Edge fn idempotency | same call twice with same key | identical body, single event row |
| Bench landed | `select max(ran_at) from adr_bench_results where adr='adr-0004';` | within last hour |
| ADR flipped | `code--view docs/adr/0004-alias-revocation-cascade.md` | `Status: accepted` + filled Consequences table |
| Sentinel registered | `select * from observability_registry where surface_id in ('tenant_node_alias_embeddings','v_alias_lineage_health','adr_bench_results:adr-0004');` | three rows |
| E2E resolver | `bunx vitest run -c vitest.e2e.config.ts e2e/resolver.test.ts` | all old + 9 new cases green |
| Lint ratchet | `bun run lint:ratchet` | exit 0 |
| Logger coverage | `bun run scripts/check-logger-coverage.ts` | exit 0 |
| Doc drift | `bun run scripts/check-doc-drift.ts` | exit 0 |

Any gate failure → fix in place → re-run. Don't claim done without each gate green per `mem://preferences/verify-completion`.

## ADR-0004 acceptance checklist (must all tick before status flip)

1. [ ] `tenant_node_aliases` lineage columns landed + trigger emits events.
2. [ ] At least one `entity_resolution_events` row with `kind='alias_revoke'` exists in production (synthetic test row in dev does **not** count for the trigger; flagged by `notes` field).
3. [ ] Bench row in `adr_bench_results` for `adr-0004` with real numbers (not zero-filled).
4. [ ] Hybrid decision matches benchmarks.md thresholds:
   - `compliance_revocation_count_30d ≥ 1` **OR** explicit operator override note in ADR Consequences → keep **hybrid**.
   - `compliance_revocation_count_30d == 0` over 90d → re-plan to **pure soft**.
   - `stale_badge_dwell_p95_days > 14` → re-plan to **pure hard**.
   - `affected_facts_p95 > 1000` → **stop**, design partial-revoke API first.
5. [ ] ADR-0004 Consequences table filled with the 4 bench metrics + decision rationale + reversal cost.
6. [ ] CHANGELOG `### Decided` bullet citing the metric that tipped the call.
7. [ ] `mem/features/phase-5-6-prep.md` ADR-0004 line moves from "proposed" to "**ACCEPTED** (date)" with the decision summary.
8. [ ] Fact-side TBD called out explicitly in Consequences (defers to Phase 6 §6.x).

## Milestones (one loop each, in order)

| # | Milestone | Outputs |
| --- | --- | --- |
| 1 | **Migration + failing tests** | lineage columns + enum extensions + alias-embeddings table + lineage view; 9 new failing test cases in `e2e/resolver.test.ts`; bench script unstubbed (still zero-filled metrics OK). |
| 2 | **Alias lifecycle handlers** | `/alias/revoke`, `/alias/merge`, `/alias/split` endpoints + idempotency + admin gating for `hard_revoke`; cross-tenant merge rejection; event emission. Tests for the four lifecycle cases go green. |
| 3 | **Embedding-hint branch** | `/resolve` extends with embedding-hint last-resort; contract output tightened; embedding-hint tests go green; sentinel check `alias_revoke_burst` added. |
| 4 | **Admin UI** | `/entities/aliases` table + revoke / merge / split actions + read-only weights card. No new edge fn. |
| 5 | **Bench + ADR-0004 flip** | `adr-0004-revocation.ts` runs against real data, row uploaded; acceptance checklist walked; status flipped or re-plan triggered. |
| 6 | **Docs + mem + CHANGELOG + roadmap done** | ADR Consequences, mem s5.3 section, CHANGELOG decided/added, sprint `s5.3` marked `done`. Pause for review before Phase 6 kickoff. |

## Out of scope

- Fact-side cascade mechanics (`binding_status`, `staged_records` re-quarantine, KR grey-out) — lives with Phase 6 facts.
- `resolve_truth()` wiring for `conflict_open` events.
- Per-tenant descriptor-weight *editing* (read-only this sprint; write UI in Phase 6 onboarding flow).
- Telegram routing for `alias_revoke_burst`.
- ADR-0003 flip — still gated on a real ≥5k-node tenant tree (separate trigger).
- Operational debts (stalled crons reactivation, `no-explicit-any` ratchet cleanup, `telegram_send_log` writer is already done).

Footer feeds `plan-footer-ingest` per the `awip-session-lifecycle` skill.
