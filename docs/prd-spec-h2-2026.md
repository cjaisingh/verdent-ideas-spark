# AWIP Core — PRD & Technical Specification (H2 2026)

**Version:** 2.0 — 4 July 2026. Supersedes the implicit v1 spec spread across master-plan, .lovable/plan.md and architecture.md. Companions: `docs/reviews/awip-review-2026-07.md`, `docs/roadmap-2026-h2.md`.

# Part I — PRD

## 1. Problem statement
FM AI initiatives fail for four recurring reasons AWIP exists to defuse: (1) nobody understands the problem — answered by OKR nodes with measurements and manifest capabilities with explicit I/O; (2) the conditions have changed — answered by versioned OKRs (spawn/supersede, never edit) and replayable event history; (3) the cost outweighs the value — answered by the demand board, credit ledger with runway/drift projections, and value fields on KRs; (4) the team has lost belief — answered by the operator experience as a first-class surface. **The H2 2026 problem specifically:** the substrate is built but unconsumed. No acting module exists, so failure modes 1–3 cannot be demonstrated defused with real outcomes, and #4 is at risk internally. H2's product goal: close the loop — real client data in (ingest), a real module acting (FM1), value measured against OKRs — on a tenant-safe foundation.

## 2. Users and personas
**The Operator** (primary): single control surface, trust that automation fails loudly, cost visibility; system proposes, operator decides. **The FM client stakeholder** (indirect via tenants): OKRs reflected accurately, data isolated, provable. **The module developer**: stable contract, scoped token, scaffold, clear promotion gates. **Procurement/security reviewer**: /trust page, sub-processor list, sovereignty posture, ISO 27001/42001 mapping, audit evidence.

## 3. Goals and success metrics (by 31 Dec 2026)
| Goal | Metric | Target |
|---|---|---|
| Close substrate→module loop | Weeks of continuous FM1 event traffic | ≥ 12 consecutive |
| Prove value loop | KRs with projected AND realized value | ≥ 3 KRs, ≥ 1 tenant |
| Production-grade ingest | Adapters; conflict auto-group rate | 2 adapters; ≥ 50% auto-grouped |
| Tenant safety | External audit criticals on isolation | 0 |
| Operational resilience | Multi-day silent outages from token drift | 0 (one-command rotation, all four stores) |
| Cost discipline | Months within budget; unattributed spend | 6/6; < 10% unmapped |
| Operator efficiency | Morning Review items auto-resolved/grouped | ≥ 40% |

## 4. What we build (by release — see roadmap for sequencing)
**R1 Truth-up:** plan, DB and ADR ledger made to agree, CI-enforced. **R2 Ingest depth:** onboard a source (file-push + one scheduled-pull), raw→staged→canonical with auto-grouped conflict triage, replay against corrected mappings, per-source health dashboards, hybrid retrieval with true BM25. **R3 FM1 live:** first acting module registers, heartbeats, writes weekly measurements against a pilot tenant's KRs; demand board stops being hypothetical; promotion gates exercised; projected value on every FM1 KR, realized value by release end. **R4 Tenant hardening:** tenant admin v0, per-tenant quotas, two-tenant isolation tests in every CI, clean external audit, one-command rotation. **R5 Control Plane extraction:** own project; KR event → dispatch → module action, fully audited. **R6 Marketplace v0:** connector install/uninstall in a sandbox tenant; /v1 versioning + generated OpenAPI.

## 5. Non-goals (H2 2026)
Public SDK GA / developer docs (H1 2027). Second acting module before FM1 acceptance. W7.3/W7.4 unless triggers fire. Tier-2 residency artefacts. CAD/BIM ingestion (W10). Voice/companion expansion not tied to a valued KR. Auto-acting without operator approval, anywhere.

## 6. Principles (non-negotiable)
Operator sovereignty. Honest claims only (/trust ethic). Events over state. UK English user-facing. Night window forces cheap models. Failures surface within one day.

# Part II — Technical Specification

## 7. System overview (target end-state Dec 2026)
Core remains a substrate, not a brain: goals (OKR tree), abilities (manifest), facts (canonical ingest), events for every mutation, zero routing. Discovery AI ingests OKRs and reads capabilities; FM1 registers/heartbeats/measures and receives scheduler callbacks; the Control Plane (own project) reads events/demand/detail over HTTP-only contract and dispatches — signed, idempotent.

## 8. Invariants
The five CONTEXT.md rules stand: (1) OKR mutations emit okr_node_events; (2) manifest changes emit capability_events; (3) all writes idempotent with body-hash conflict; (4) no routing in Core; (5) generated types never hand-edited. Secondary invariants stand (withLogger, roles via has_role(), service auth, night coercion, unique realtime channels). **New invariant 6 (R2):** every canonical-fact mutation emits ingest_events; canonical_facts append-only with supersede-only updates. **New invariant 7 (R4):** every tenant-scoped table's RLS uses is_in_tenant_subtree() or documents why not (rls-exempt comment), CI-enforced.

## 9. Requirements by release
**R1:** S1.1 master-plan rewritten with machine-readable phase frontmatter; S1.2 doc-drift CI compares frontmatter to roadmap_phases; S1.3 ADR-0004 bench --write-decision; S1.4 Phases 2+5 sign-off via gates; S1.5 codemod on top-10 any files, baseline ≤400.
**R2:** S2.1 scheduled-pull adapter (per-source secret via get_app_secret, cadence via scheduler kind ingest.pull, idempotent on (source_id, remote_cursor)); S2.2 ADR-0005 heuristic grouping by (mapping, fact_type, value_pair_hash) + numeric delta bands, bulk resolve fanning individual events, LLM assist operator-toggled and capped; S2.3 POST /ingest/replay (dry-run diff; commit supersedes, never deletes; emits replayed); S2.4 dashboards over v_ingest_pipeline_health + new v_ingest_source_daily; sentinels ingest_conflict_backlog_growth (med ≥50, high ≥200) and ingest_source_silent; S2.5 BM25 via pg_search behind stable RRF contract, ts_rank_cd fallback, bench to adr_bench_results; S2.6 pii-coverage report per source + subject-delete via supersede-with-tombstone for one fact_type.
**R3:** S3.1 FM1 token, scope rejection e2e; S3.2 PATCH /okr/measurements/:id (idempotent, emits measured) — the one net-new endpoint; S3.3 promotion through the 8 gates observed; S3.4 projected_value_usd soft-required on FM1 KRs; S3.5 W7.3/7.4 trigger review with recorded evidence.
**R4:** S4.1 RLS adoption audit in generate-rls-map with rls-exempt convention, CI-enforced; S4.2 two-tenant fixture pair, matrix on every CI; S4.3 tenant_quotas (rows/day, calls/day), 429 + Retry-After, sentinels at 80%/exceeded; S4.4 /admin/tenants v0 (list, branding, token issue/revoke, isolation self-test); S4.5 rotate-awip-token optionally updates the GHA secret via GitHub API in the same flow (207 on partial), runbook to one step; S4.6 external audit #2, 48h critical SLA.
**R5:** S5.1 remix /control-plane to own project, stub after 2 weeks; S5.2 dispatch v0 in Control Plane using only public contract + scheduler (dedupe (kr_id, window), tenant stamped); S5.3 Core-side limited to sentinels dispatch_dlq_growth + dispatcher_silent — any Core schema change demanded by dispatch is a Rule-4 smell.
**R6:** S6.1 connector manifest (zod), install/uninstall issuing scoped tokens, events; S6.2 sandbox tenant; S6.3 /v1 prefix, 6-month deprecation window, endpoint-level deprecation events; S6.4 OpenAPI generated in CI from typed contracts, drift-checked; TS SDK spike.

## 10. NFRs
Security: ISO 27001/42001 maps current per release; secrets only via accessors; constant-time compares; plaintext-secret sentinel stands. Reliability: two-layer silent-cron guarantee ≤45 min to Telegram; every new cron registers with watcher in the same PR; DLQ growth = high. Performance: resolver p95 ≤40ms at corpus (ADR-0004 governs); hybrid retrieval p95 ≤800ms at 50-candidate pool; promote path p95 ≤5s per 1k rows; dashboards <1.5s above fold. Cost: all AI via pickModel(); night cheap; budget alerts authoritative. Compliance: Tier-1 posture only; no new claims without artefacts. Quality: lint ratchet 400/300/200; e2e redaction contract; four-gate sign-offs.

## 11. Data model deltas (whole plan)
R2: v_ingest_source_daily; conflict group columns (group_key, group_resolved_by); replay event kind. R3: PATCH measurements + measured kind; no new tables. R4: tenant_quotas; tenant-scoped token rows; rls-exempt convention. R5: none in Core (by design). R6: connectors, connector_installs (+events); /v1 routing. Everything else builds on existing tables — the substrate is wide enough.

## 12. Risks & mitigations
FM1 slippage → R2/R4 independent so the critical path forks. pg_search unavailable → fallback behind same contract. GH-API rotation leg fails → 207 semantics + watchdog catches 401 bursts. Dispatch tempts Core changes → Rule-4 review on any R5 Core PR.

## 13. Acceptance & verification
Each S-requirement lands with contract file, tests, e2e where auth/RLS touched, CHANGELOG, mem:// update, observability-registry row; R-level closure via four-gate sign-off. These requirement IDs become roadmap_tasks rows in R1 so the roadmap page remains the live execution truth.
