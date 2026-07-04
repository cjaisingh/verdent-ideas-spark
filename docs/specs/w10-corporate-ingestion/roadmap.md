# W10 — Corporate Knowledge Ingestion: Roadmap

**Version:** 1.0 — 4 July 2026 — Status: Proposed. Slots into the H2 2026 roadmap (R2–R6); stages populate the R-releases and extend into H1 2027. Sequencing logic: trust before firehoses (approval precedes OAuth and connectors), open formats before licensed (IFC before RVT/APS), interchange before native (COBie first), AI ships proposal-only.

## Stage map
S1 Records (w/c 13 Jul → w/c 27 Jul, ~2.5 wks, rides R2) → S2 Approval & trust (w/c 20 Jul → w/c 10 Aug, ~3 wks, R2→R3 seam) → S3 Doc memory (Aug → mid-Sep, ~5 wks, rides R3) → S4 Knowledge graph (Sep → mid-Oct, ~5 wks, W9.3 slot) → S5 CAD/BIM (late Sep → mid-Nov, ~7 wks, W9.2 slot, overlaps R4/R5) → S6 FM bridge (Oct → mid-Dec, ~9 wks, COBie first, overlaps R5/R6). Overlaps deliberate.

## Stage gates
**S1:** ≥95% of new ingests auto-classified; sweeper dry-run reviewed then enabled; legal-hold audit e2e; held-file deletion structurally impossible (test-proven); **first recorded restore drill (incl. held-file round-trip)**.
**S2 (the programme keystone — nothing downstream opens until green):** 100% of registered agent surfaces approved-only (CI-enforced); backlog <25 after backfill; fourth promotion condition proven by red-path e2e; **executed DPA (or tenant-zero exception); operator-absence runbook; queue median ≤72h**.
**S3:** ≥200 applied memories on pilot corpus; anchor-failure <10%; memory-grounded share baselined; extraction within caps 4 consecutive weeks; **eval harness ≥95% precision on key_date/obligation**. Entry: **pilot tenant confirmed or tenant-zero declared**.
**S4:** backlinks on every document; ≥200 suggested-edge decisions; orphans <30% and falling; 2-hop local graph p95 <500ms; zero cross-engagement edges possible (e2e).
**S5:** ≥70% of IFC yield canonical facts; ≥300 tenant_nodes via resolver with ≥60% GUID auto-bind; ≥50% of DWG yield candidates/metadata; sidecar limits hold under fuzz; honest-tier notices verified.
**S6 (programme exit):** full round-trip on the pilot (≥500 assets imported, reconciled, exported) with idempotent evented pushes, zero DLQ residue; two-tenant FM isolation e2e green; stage-gate audit zero cross-tenant findings; **dry-run offboard executed**.

## Deferred / follow-on
W9.4 per-user OAuth pulls (Drive/SharePoint/Dropbox/Gmail) — starts only after S2's gate, H1 2027. BMS/IoT tagging (Haystack/Brick) + TSDB scale — H1 2027 with FM12. Geometry computation — not on the roadmap. Public graph/ingest API — after R6. W9.5 rerank — cost-gated, on demand.

## Dependencies & risks
| Dependency | Needed by | Mitigation |
|---|---|---|
| Sidecar host decision | S1 end | decide in R1 truth-up |
| R4 quota + two-tenant harness | S1 quotas, S5/S6 gates | run isolation cases standalone |
| Pilot tenant | S5/S6 gates | gates on fixture corpus, marked provisional; tenant-zero fallback |
| APS credentials (tenant's) | Tier C only | Tier C stays metadata-only by design |
| FM1 timeline (R3) | S3 value evidence | S3 gates on operator adoption alone |

## Reporting
Each stage closes via four-gate sign-off (roadmap_phases w10-s1…s6); weekly digest into Morning Review; monthly spend check with memory-extraction broken out; gates become qa_checks probes in the truth-up so the roadmap page is the live truth.
