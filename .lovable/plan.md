## Goal

Finish Phase 5 Sprint **s5.2** (resolver scoring + ancestry — already 80% landed) and stage **s5.3** (alias lifecycle + embedding-hint, flips ADR-0004) so Phase 6 ingest is unblocked.

## Non-goals

- No Phase 6 work (ingest, canonicalisation, `fact_conflicts`).
- No per-tenant weight editing UI (that's an s5.3 admin slice, scoped separately).
- No operational debt cleanup (stalled crons, `telegram_send_log`, no-explicit-any ratchet) — tracked elsewhere.

## Blast radius & Core rule / ADR / FM-AI cited

- **s5.2 closeout:** `scripts/adr-bench/adr-0003-ancestry.ts`, `docs/adr/0003-tenant-node-ancestry-storage.md`, `observability_registry` rows for `view:v_resolver_health` + `edge_fn:entity-resolve`, `CHANGELOG.md`, `mem/features/entity-resolver.md`.
- **s5.3:** `tenant_node_aliases` (revoke/merge/split lifecycle + embedding column), new `alias_lifecycle_events` kind, `entity-resolve` (embedding-hint last-resort branch), new `awip_doc_chunks` tenant scoping OR a dedicated alias-embedding store.
- **Core rule defused:** "Aliases are explicit + operator-approved + revocable" (`mem://features/entity-resolver` invariants).
- **ADRs cited:** ADR-0003 (s5.2 flip), ADR-0004 (s5.3 flip), ADR-0006 (embedding model — reused, not re-opened).
- **FM-AI failure mode:** "agent improvises retrieval" — embedding-hint stays gated by contract + confidence band.

## Alternatives considered

**For sequencing:**

| Option | Verdict |
| --- | --- |
| **A. Close s5.2 fully, then s5.3 (chosen)** | Smallest blast per loop; ADR-0003 numbers land before s5.3 tests reuse the ancestry index. |
| B. Skip bench, flip ADR-0003 on inspection | Discarded — violates `mem://preferences/verify-completion` and the skill invariant "decision data > vibes". |
| C. Defer ADR-0003 flip until s5.3 | Discarded — ADR-0004 design depends on knowing ancestry write-amp cost. |
| D. Parallel s5.2 closeout + s5.3 kickoff | Discarded — same files (resolver scoring + embedding-hint) collide. |

**For s5.3 embedding-hint store:**

| Option | Verdict |
| --- | --- |
| Add `tenant_id` + `embedding` to `awip_doc_chunks` | Mixes operator RAG corpus with tenant alias corpus — RLS becomes mixed-mode. |
| **New `tenant_node_alias_embeddings` table (lean)** | Clean tenant scoping, dedicated HNSW index, no churn to existing RAG. |
| Reuse `tenant_node_aliases` with a vector column | Bloats hot resolver table; vector index on a freq-updated row is wasteful. |

## Contract (cron / edge-fn / agent)

No new contract for s5.2 closeout. For **s5.3**, extend the existing `RESOLVER_RETRIEVAL_CONTRACT` to formally include the `embedding_hint` branch's score cap (0.6) and store name as a literal — no new file, just tighten the existing Zod schema's output.

New event kind: `alias_revoke`, `alias_merge`, `alias_split` added to `entity_resolution_events.kind` enum (already partly there per s5.1 mem note).

## Persona sign-off

- **event-engineer:** every alias revoke/merge/split emits an `entity_resolution_events` row with the old + new alias_ids in payload.
- **tenant-manager:** new alias-embeddings table is tenant-scoped + admin-only RLS; merge across tenants is rejected by trigger.
- **compliance-auditor:** ADR-0003 flip Consequences table filled with bench numbers; ADR-0004 flip in s5.3 step 6.
- **sentinel:** existing `resolver_low_confidence_rate` check stays; add `alias_revoke_burst` (>10 revokes/hour same tenant → medium).
- **product-historian:** CHANGELOG `### Decided` bullet per ADR flip; mem entry updated per sprint.

## Gap checklist

s5.2 closeout:
- [ ] Bench script populates `adr_bench_results` at 10k/50k/100k.
- [ ] ADR-0003 status → `accepted`, Consequences table filled.
- [ ] `observability_registry` row for `view:v_resolver_health` + bumped row for `edge_fn:entity-resolve`.
- [ ] CHANGELOG `### Decided` + `### Added`.
- [ ] `mem/features/entity-resolver.md` "s5.2" section appended.
- [ ] Roadmap sprint `s5.2` marked `done`.

s5.3 kickoff (separate loop):
- [ ] Idempotency-Key on `/alias/revoke`, `/alias/merge`, `/alias/split`.
- [ ] RLS + `has_role('admin')` on new alias-embeddings table.
- [ ] Realtime publication for the new table.
- [ ] `withLogger` on any new endpoints (none planned — existing `entity-resolve` extends).
- [ ] No new `any`.
- [ ] CHANGELOG + mem + ADR-0004 flip.

## Test plan

**s5.2 closeout:**
- `scripts/adr-bench/adr-0003-ancestry.ts` — fills the 7 `METRIC_KEYS` rows.
- No new vitest/e2e (already added in the last loop).

**s5.3:**
- `e2e/resolver.test.ts::alias_revoke_invisible_after` — revoked alias no longer matches.
- `e2e/resolver.test.ts::alias_merge_redirects_old_id` — both old alias_ids resolve to the new canonical.
- `e2e/resolver.test.ts::alias_split_emits_pair` — one alias → two, both emit events.
- `e2e/resolver.test.ts::embedding_hint_caps_at_0_6` — embedding-only candidate never exceeds 0.6 score.
- `e2e/resolver.test.ts::embedding_hint_skipped_when_alias_exact_hits` — no embed call when deterministic path succeeds.
- `scripts/adr-bench/adr-0004-revocation.ts` — soft-vs-hard revoke read/write latency.

## Validation gates

s5.2 closeout commands:

| Gate | Command | Pass |
| --- | --- | --- |
| Bench ran | `bun run scripts/adr-bench/adr-0003-ancestry.ts` | exits 0, row in `adr_bench_results` |
| ADR flipped | `code--view docs/adr/0003-tenant-node-ancestry-storage.md` | `Status: accepted` + filled table |
| Registry seeded | `supabase--read_query select * from v_observability_registry_status where surface_id in ('view:v_resolver_health','edge_fn:entity-resolve');` | both present, not stale |
| Doc drift | `bun run scripts/check-doc-drift.ts` | exit 0 |
| Lint ratchet | `bun run lint:ratchet` | exit 0 |
| Logger coverage | `bun run scripts/check-logger-coverage.ts` | exit 0 |

s5.3 gates land with that sprint's plan.

## Out of scope

- Per-tenant weight editing UI (separate s5.3 sub-plan).
- `resolve_truth()` wiring for resolver conflicts (still s5.3).
- Telegram routing for `resolver_low_confidence_rate` / `alias_revoke_burst` — chat-first conversation per `mem://preferences/chat-first-policy-requests`.
- Replacing `awip_doc_chunks` with a Phase-6 vector table (Phase 6).
- Stalled cron reactivation, `telegram_send_log` writer, no-explicit-any cleanup.

Footer feeds `plan-footer-ingest` per the `awip-session-lifecycle` skill.
