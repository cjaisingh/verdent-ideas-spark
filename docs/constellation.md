# AWIP Constellation — Live Status Map

**Purpose:** the constellation diagram (client goals → FM modules → Core rings) as a *truth-tracked artefact*, not a poster. Every ring and module carries a status grounded in a database table, doc, or roadmap phase. If reality changes, this file changes in the same PR — the doc-drift workflow should gain a parity check against `capabilities.owning_module` and `roadmap_phases` (follow-up task, see Maintenance).

**Source graphic:** `docs/assets/constellation-2026.png` (add on merge)
**Last verified:** 4 July 2026

## 1. The apex — Client Goals / OKRs

**Status: ✅ live in the database.** The seven apex objectives were seeded 26 May 2026 as top-level `okr_nodes` on the AWIP Platform tenant, deterministic UUIDs, event-emitted.

| Apex objective | DB anchor | Consuming loop |
|---|---|---|
| Operational Excellence | `okr_nodes` (apex seed) | demand board → module KRs |
| Cost Efficiency | ″ | credits/usage layer, budget alerts |
| Risk Reduction | ″ | sentinel, risk-gated night shift |
| Workplace Experience | ″ | FM1/FM6 territory (planned) |
| Sustainability & ESG | ″ | no consumer yet — first module KR wanted (FM12) |
| Compliance Confidence | ″ | ISO 27001/42001 maps, W7 governance |
| Growth & Value Creation | ″ | OKR value layer (projected/realized_value_usd) |

"Strategic intent drives awareness" = POST /okr/ingest → okr_node_events → demand board. Shipped.

## 2. Core rings (inside → out)

| Ring | Diagram promise | Reality | Status | Gaps to close |
|---|---|---|---|---|
| **AWIP Core** | The substrate | OKR tree + manifest + events + contract API; invariants CI-enforced | ✅ shipped | — |
| **AI & Intelligence** | Model layer | pickModel() chokepoint, night-cheap policy, morning review, night agent, overnight runner | 🟡 partial | Prediction absent — needs module data; first predictive KR 2027-H1 (FM4) |
| **Memory** | Memory layer | Vector = W9 chunks/embeddings ✅ · Episodic = event streams + mem/ + lessons ✅ · Semantic = W10 doc-memories + knowledge graph | 🟡 partial | W10 S3 (doc memory) + S4 (graph) deliver semantic |
| **Governance** | Governance layer | W7 frozen at W7.2: ontology, decision authorities, claims, links; ISO 42001 gap analysis | 🟡 frozen by design | W7.3/7.4 un-freeze on module-traffic triggers (R3 gate) |
| **Security & Trust** | Security layer | RLS everywhere, secrets-at-rest (ADR-0009), per-module tokens, watchdog, /trust, June audit triaged | 🟡 strong, hardening | R4: subtree adoption audit, quotas, external audit #2, one-command rotation |
| **Integration Layer** | Connective tissue | awip-api contract, merged event stream, W8.1 scheduler, module heartbeats | 🟡 partial | Connectors = R6 + W10 S6; orchestration = R5 dispatch |
| **Data Foundation** | Data layer | W9.0/9.1 shipped: files→chunks→hybrid retrieval; canonical spine; conflict triage; lineage | 🟡 strongest ring | W10 S1/S2 complete quality/storage; R2 second adapter + replay |
| **Infrastructure** | Platform | Lovable Cloud (eu-west-1), sidecar (host pending), GHA workers, sentinel/watchdog/registry | ✅ effectively done | Sidecar host = ADR-0011 §hosting (R1); edge/hybrid honestly not claimed |

**Twin framing (see `docs/twin-framework.md`):** the Data Foundation + Memory + resolver rings jointly constitute the **client estate twin** (a data twin, L1 descriptive at W10 exit, climbing to L4 prescriptive through the module rollout); the AI & Intelligence ring's "adaptive" claim is delivered by the **platform shadow twin** — no AI-shaped behaviour change reaches production except through the shadow→canary→promoted ladder (T-track). Twin fidelity per tenant is measured (`v_twin_fidelity`), not asserted.

## 3. The outer ring — FM Modules

**Legend:** ✅ live (registered via contract, heartbeating, producing events) · 🔵 manifest-only (`planned` rows) · ⚪ named only (no rows) · 🔒 reserved

| Module | Diagram role | Status | DB / roadmap anchor | Target |
|---|---|---|---|---|
| **FM1** Stakeholder Intelligence | Who matters, sentiment, engagement | 🔵 manifest-only — 3 planned capabilities, seeded 26 May | R3 (Aug–Sep 2026) | First live module, end R3 2026 |
| **FM2** Strategy Design | OKR drafting, options, scenarios | ⚪ | Discovery AI is the natural host | 2027-H2/2028 |
| **FM3** Performance Management | KR measurement, variance, review | ⚪ | Consumes measurement path built in R3 | 2027-Q1/Q2 |
| **FM4** Insight & Analytics | Cross-module analytics, prediction | ⚪ | Needs ≥3 modules' data; first predictive KR | 2027-Q4/2028-Q1 |
| **FM5** Workflow Automation | Client-facing workflows | ⚪ | Productises R5 dispatch + W8.1 scheduler | 2027-Q2/Q3 |
| **FM6** Engagement & Communications | Client comms, digests | ⚪ | Generalises Telegram/companion surfaces | 2028 |
| **FM7** Knowledge Management | Client knowledge surface | ⚪ | = client-facing face of W10 (memories, graph, search) | Second module, 2027-Q1 |
| **FM8** Portfolio | Property, space & lease management | ⚪ (absent from source graphic — add on next revision) | Unusually well-fed by W10: leases → doc_memories (obligation/key_date kinds), spaces → IFC spatial tree tenant_nodes (S5), space/asset sync → S6 IWMS bridge | 2027-Q4 / 2028 — strongest queue-jump candidate |
| **FM9** Financial Management | Cost, value, budgets | ⚪ | Extends credits/value layer outward | 2028 |
| **FM10** Risk & Compliance | Client risk registers, compliance | ⚪ | Consumes W7 governance + claims substrate | 2028 |
| **FM11** Partner & Vendor Management | Supplier ecosystem | ⚪ | Builds on external_contacts + scheduler | 2028 |
| **FM12** Monitoring & Operations | Live building ops, BMS | ⚪ | Gated on time-series scale-up + Haystack/Brick | 2027-Q3/Q4 |

**Caption check:** "All FM modules leverage AWIP Core capabilities through secure, governed, intelligent connectivity aligned to client goals" — mechanically true today for any module that ships: per-module tokens (secure), approval gates + W7 (governed), pickModel() + retrieval contracts (intelligent), required_capabilities on KR measurements (aligned to client goals). The sentence is a contract, and the contract is built.

## 4. Maintenance rules

1. **Same-PR rule:** any capability registration, module heartbeat first-light, ring-completing feature, or roadmap re-sequencing updates this file in the same PR.
2. **Drift check (follow-up task, R1 backlog):** extend `check-doc-drift.ts` to parse §3's status column and compare against `select distinct owning_module, min(status) from capabilities group by 1` + module heartbeat recency — mismatch fails Doc Drift.
3. **Status vocabulary is closed:** ✅ / 🟡 / 🔵 / ⚪ / 🔒 as defined above; no free-text statuses.
4. **The graphic is decorative; this table is authoritative.** If they disagree, fix the graphic. (Known gap: FM8 Portfolio — property, space & lease management — is missing from the current render; add it between FM7 and FM9 on the next revision.)
