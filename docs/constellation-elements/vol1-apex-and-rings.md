# Constellation Element Book — Volume 1: Apex & Core Rings

**Version:** 1.0 — 4 July 2026 — Status: Proposed. Each element: PRD (why/who/success) → Spec (current + remaining) → Plan (sequenced work, gates), in build-dependency order. Cross-refs: H2 roadmap (R1–R6), W10 (S1–S6), T-track, A-track, D-track, readiness companion (§C-n).

## E0 — The Apex: Client Goals / OKRs
**PRD.** The strategic-intent layer: every goal a versioned OKR node; every measurement declares needed capabilities; intent literally drives the demand board. Users: operator, Discovery AI, every module, the client. Success: 100% of module work traceable to a KR; every active KR carries projected_value_usd; each apex objective has ≥1 measured child KR by end 2027 (Sustainability & ESG is the orphan — FM12 fixes it).
**Spec.** Shipped: okr_nodes (spawn/supersede), okr_measurements with required_capabilities, events, value columns, seven apex objectives seeded. Remaining: E0.1 PATCH /okr/measurements/:id (R3); E0.2 soft gate requiring projected_value_usd before module-linked KR activation (R3); E0.3 ESG child-KR when FM12 lands.
**Plan.** E0.1–E0.2 ride R3. The apex is the one finished promise — protect it with the R1 drift check.

## E1 — Infrastructure
**PRD.** Everything runs somewhere, fails loudly, recovers provably. Success: zero silent multi-day outages; quarterly drills recorded; sidecar cost in the ledger.
**Spec.** Shipped: Lovable Cloud (eu-west-1, honestly claimed), GHA workers, the observability stack (sentinel, watchdog, registry, freshness, jobs board). Remaining: E1.1 sidecar host decision (ADR-0011 §hosting, R1); E1.2 DR — RPO ≤24h/RTO ≤8h, second-location bucket copy, quarterly drill incl. held file, verified platform posture (§C5, gates W10 S1); E1.3 sidecar cost as a recurring ledger line (§C7); E1.4 rotation unified (R4/S4.5).
**Plan.** E1.1+E1.3 in R1; E1.2 before S1 sign-off; E1.4 in R4. This ring closes by finishing named items.

## E2 — AWIP Core (the substrate)
**PRD.** Records what we said we'd do (OKR tree) and what we can do (manifest), emits events, holds zero routing. Success: the five invariants never break; the contract survives Control Plane extraction and first module with zero consumer-forced schema changes.
**Spec.** Shipped and audit-hardened: dual-auth contract API, idempotency with body-hash 409s, merged events, scoped tokens, granular capability events, promotion gates, heartbeats. Remaining: E2.1 the R3 measurement endpoint (the only net-new route until R6); E2.2 /v1 + endpoint deprecation events + OpenAPI drift-checked (R6); E2.3 typed request contracts clearing the body:any sites (lint ratchet).
**Plan.** Deliberately quiet — the substrate is wide enough. Everything else is refusal: any consumer demanding more Core is a Rule-4 smell to argue down.

## E3 — Security & Trust
**PRD.** Tenant safety provable, claims honest. Success: audit #2 zero isolation criticals; one-command rotation; client-role e2e green before any client logs in.
**Spec.** Shipped: RLS via has_role(), is_in_tenant_subtree, secrets-at-rest, constant-time compares, HMAC callbacks, watchdog, security CI, June audit triaged in 48h. Remaining: E3.1 RLS adoption audit + rls-exempt convention (S4.1, invariant 7); E3.2 two-tenant fixtures every CI (S4.2); E3.3 quotas (S4.3); E3.4 tenant admin v0 + isolation self-test (S4.4); E3.5 rotation unification (S4.5); E3.6 external audit #2 (S4.6); E3.7 client identity — client_user role, tenant-bound claims, client_ policy family, client_surfaces registry (R4b, §C4, gates FM7); E3.8 CAD parser hardening — unprivileged containers + fuzz corpus (W10 S5).
**Plan.** R4 is this ring's release; R4b its client-facing epilogue. Sequenced ahead of marketplace because of June's findings — the one deliberate re-ordering in the packet, and this ring is why.

## E4 — Data Foundation
**PRD.** Any client artefact → typed, governed, provenance-complete evidence; jointly with E5, this ring IS the client estate twin (L1). Success: W10 PRD §9 criteria + fidelity metrics that never lie.
**Spec.** Shipped: W9.0/9.1 (files→chunks→hybrid RRF; canonical spine append-only + supersede; CSV/XLSX adapter; conflict UI; lineage). Remaining = W10: E4.1 records layer (S1); E4.2 approval trust boundary (S2); E4.3 second adapter + ADR-0005 + replay (R2); E4.4 CAD tiers + parse quality (S5); E4.5 FM bridge (S6); E4.6 twin fidelity view + panel + sentinel (T1); E4.7 DSAR + offboarding (S2.6 + §C5).
**Plan.** The W10 roadmap is this ring's plan, with the companion's gates (DPA before S2, pilot before S3, drill before S1 close).

## E5 — Memory
**PRD.** Three kinds honestly delivered: vector (semantic search over evidence), episodic (events, sessions, lessons), semantic (extracted, approved, reusable knowledge). Success: ≥30% memory-grounded answers within 60 days of S3; anchor failures <10%; zero un-anchored memories (structurally impossible).
**Spec.** Shipped: vector = chunks (1536-dim HNSW, embed_model-stamped, hybrid); episodic = event streams + mem/ + lessons + sessions. Remaining: E5.1 doc_memories (S3); E5.2 high-consequence rules — key_date/obligation never auto-apply; 95% harness (§C6); E5.3 memory RRF leg + hit_kind (S3); E5.4 fact bridge (S3); E5.5 the knowledge graph as semantic memory's connective tissue (S4, ADR-0010); E5.6 the extractor lives in the shadow ladder from birth (T2).
**Plan.** S3 then S4, T2 wrapping the extractor. Standing risk: extraction quality masquerading as quantity — the harness and the 20% scanner kill-rule are the countermeasures; watch them, not the memory count.

## E6 — Integration Layer
**PRD.** Everything talks by contract; nothing reaches into another project's database. Success: R5's test (Control Plane extracted verbatim, zero Core changes); R6's (connector lifecycle clean in sandbox); S6's (one CAFM round-trip).
**Spec.** Shipped: contract API + merged events, W8.1 scheduler (queue, hybrid dispatch, retries, DLQ sentinels), per-module tokens, module_endpoints, design-tokens endpoint. Remaining: E6.1 dispatch loop v0 in the extracted Control Plane (R5); E6.2 connector manifest + install/uninstall + sandbox (R6); E6.3 /v1 + OpenAPI + SDK spike (R6); E6.4 FM adapters + FM_PUSH_CONTRACT (S6); E6.5 experience-trace capture as surfaces registering outcomes (T2).
**Plan.** R5 → R6, S6 threading between. Discipline: connectors on demand (a live tenant per tool), never speculation.

## E7 — Governance
**PRD.** Truth arbitration and human oversight as substrate: who wins a conflict, what needs approval, what did the AI decide. Success: W7's frozen KPIs when un-frozen (coverage ≥60%, real-claim ≥70%, conflict MTTR p50 ≤7d); every AI surface oversight-classified; every component promotion has an approval trail.
**Spec.** Shipped, deliberately frozen at W7.2: 12-entity ontology, decision_authorities, claims + resolve_truth(), governance links + coverage, approval_queue + phase gates, risk-gated night shift, oversight doc. Remaining: E7.1 three new approval kinds land with their features (ingest.document_approval S2, fm.mapping_approval S6, ai.component_promotion T3); E7.2 W7.3 decay / W7.4 reliability built only if R3 triggers fire, else re-deferred with evidence; E7.3 ISO 42001 testing evidence satisfied by shadow reports (T2, free); E7.4 FM10 points the substrate at client risk registers (2028).
**Plan.** Watchful waiting by design. The un-freeze decision at R3 gate is the ring's 2026 event; record it either way. Health metric: approval queues flowing under the §C3 budget.

## E8 — AI & Intelligence
**PRD.** Reasoning, automation, insight exist; prediction and adaptive are the unearned words — this ring's job is earning them with evidence. Success: T2's gate (one component through the full ladder); T3's (one model change canaried, zero incidents); T4's (first predictive KR beats its baseline); spend attribution ≥90% by component.
**Spec.** Shipped: pickModel() with night coercion, ai_usage_log + credits/runway/projections + alerts, morning review + night agent + overnight runner, lessons loop, tool policy. Remaining — the shadow twin in full: E8.1 ai_component_versions + resolve-at-call (T2); E8.2 experience_traces (T2); E8.3 replay drivers + golden runner + shadow reports (T2); E8.4 canary split + regression auto-halt + promotion approval + rollback runbook (T3); E8.5 predictors born in the twin (T4/FM4); E8.6 the standing rule to mem://; E8.7 ADR-0014 accepted at T2.
**Plan.** T2 (rides R3/S3) → T3 (rides R5) → T4 (rides FM4). The night window, the budget alerts and the shadow ladder end 2027 as the three permanent constraints on AWIP's own intelligence — what "adaptive · intelligent · secure · scalable" costs to say truthfully.
