# AWIP Core — Roadmap H2 2026 (v2)

**Status:** Proposed — replaces the phase list in `docs/master-plan.md` once approved
**Date:** 4 July 2026
**Companions:** `docs/reviews/awip-review-2026-07.md`, `docs/prd-spec-h2-2026.md`

## Guiding principle for H2

> **Depth before breadth. One real module before any marketplace.**
> Every release either (a) closes an open loop the substrate already promised, or (b) puts real external traffic through the contract. Nothing widens the surface until R5. Phase-gate discipline stays: a release closes only via the Proceed → phase sign-off flow with all four gates green.

## Where we actually are (reconciled state, July 2026)

| Legacy phase | Doc said | Reality | Disposition in v2 |
|---|---|---|---|
| Phase 1 Foundations | done | done | Closed |
| Phase 2 Operator Channel & Roadmap | active | functionally done; gate green 23 May | Sign off in R1 |
| Phase 3 Module Scaffold | planned | scaffold, per-module tokens, heartbeats, granular events shipped | Fold into R1 close-out |
| Phase 4 / phase-okr | reserved | value columns shipped; no measurements flowing | Becomes R3 acceptance criteria |
| Phase 5 Entity & Tenant Resolution | planned | resolver, composite scorer, thresholds, alias lifecycle, RLS predicate shipped | Sign off in R1 (flip ADR-0004 first) |
| Phase 6 Ingest & Canonicalisation | planned | W9.0 substrate + W9.1 adapter, hybrid retrieval, conflict/quarantine UI live | Active — completes in R2 |
| Phase 6b Ingest Observability | planned | partial | Completes in R2 |
| W7 Governance | closing | frozen at W7.2 per closeout | Stays frozen; W7.3/7.4 triggers live in R3 |
| W8.1 Scheduler | — | shipped | Closed |
| Phase 7 Marketplace / 9 Hardening / 11 API | planned | not started | Re-sequenced: hardening (R4) now precedes marketplace (R6) |

## Release plan

### R1 — Truth-up & close-out (w/c 6 Jul → w/c 13 Jul, ~1.5 weeks)
Rewrite `docs/master-plan.md` to this roadmap; renumber/annotate phases. Extend the doc-drift CI workflow to fail on phase-status mismatch between master-plan and `roadmap_phases`. Run ADR-0004 revocation bench with `--write-decision` (corpus gate satisfied at 1,100 aliases); flip or amend. Phase 2 and Phase 5 formal sign-off. Lint ratchet: `codemod_replace_any` on top-10 any-density files; baseline ≤ 400. Feed the July review into the quarterly-review action.
**Success:** Master plan and DB agree (CI-enforced); Phases 2 & 5 signed off; ADR-0004 decided; baseline ≤ 400.

### R2 — Ingest to production depth (mid-Jul → end Aug)
Second source adapter implementing `SOURCE_ADAPTER_CONTRACT` (scheduled-pull). ADR-0005 decided with real data: heuristic bulk-conflict grouping by value_pair_hash, LLM assist operator-toggled. Replay tooling: re-run a raw_records envelope through mapping vN, diff, supersede-only commit. 6b dashboards: per-source ingest health, conflict throughput, weekly Morning Review digest; sentinels ingest_conflict_backlog_growth and ingest_source_silent. W9.2 retrieval swap: true BM25 behind the stable RRF contract, ts_rank_cd fallback. PII/DSAR minimum: lawful-basis coverage report; subject-delete via supersede for one fact_type.
**Success:** Two adapters production-shaped; conflict auto-grouping cuts manual triage ≥50% on fixtures; replay works; ADR-0005 decided. Phases 6+6b signed off.

### R3 — First acting module: FM1 Stakeholder Intelligence (Aug → end Sep)
Core side: FM1 token issued, scope checks exercised; measurement-update path (PATCH /okr/measurements/:id — idempotent, emits measured event — the one net-new Core endpoint); demand board shows FM1 capabilities moving planned→experimental→available; W7.3/W7.4 trigger review with recorded evidence; ADR-0007 Part 1 review with real traffic; value layer live — every FM1 KR carries projected_value_usd, first realized_value_usd by release end.
**Success:** ≥4 consecutive weeks of FM1-originated events; ≥1 capability available through all 8 gates; ≥1 KR with projected and realized value; W7.3/7.4 decisions recorded.

### R4 — Multi-tenant hardening (Sep → end Oct) — pulled forward from legacy Phase 9
is_in_tenant_subtree adoption audit + CI check + rls-exempt comment convention. Two-tenant e2e fixture pair on every suite run. Per-tenant quotas (rate + rows) with 80% sentinels. Tenant admin surface v0 (list, branding, token issue/revoke, isolation self-test). Second external security audit scoped to isolation + ingest, 48h critical SLA. Token lifecycle fix: rotate-awip-token also updates the GitHub Actions secret via the GitHub API (or OIDC) — one action, all four stores.
**Success:** audit returns zero isolation criticals; two-tenant matrix on every CI; one-command rotation verified in prod; quota alerts fire in test.

### R5 — Control Plane extraction & dispatch (Oct → end Nov)
Control Plane moves to its own Lovable project, verbatim against the three contract endpoints. Dispatch loop v0: subscribes to okr_node_events, consults manifest + scheduler, enqueues to FM1's callback with signed token + idempotency key; unified audit view. Routing policy lives in Control Plane (never Core). Sentinel coverage: dispatch DLQ growth, dispatcher_silent.
**Success:** Control Plane runs separately 4 weeks with zero Core schema changes; ≥1 KR-triggered dispatch executed end-to-end with full audit trail.

### R6 — Connector marketplace v0 + public contract groundwork (Nov → mid-Dec)
Connector manifest validation, install/uninstall, per-connector tokens, sandbox tenant. /v1 prefix formalised, endpoint-level deprecation events, OpenAPI generated from typed contracts in CI, TS SDK spike (GA is H1 2027).
**Success:** one third-party-shaped connector installed/uninstalled cleanly in sandbox with full event trail; OpenAPI drift-checked in CI.

## Cross-cutting tracks
Cost governance: monthly budget review; new AI loops must route through pickModel() and declare a retrieval contract before first deploy (release-gate check). Lint ratchet: ≤400 end R1, ≤300 end R3, ≤200 end R6. Doc hygiene: drift CI guards master-plan parity. Companion/voice: frozen unless linked to a valued KR.

## Explicitly out of scope for H2 2026
Public SDK GA and docs site (H1 2027); W7.3/W7.4 build unless R3 triggers fire; Tier 2 sovereignty artefacts; CAD/BIM geometry adapters (see W10); any second acting module before FM1 completes R3.

## Milestone summary
| Release | Window | Sign-off gate |
|---|---|---|
| R1 Truth-up | 6–17 Jul | Plan/DB parity CI green; Phases 2+5 signed off |
| R2 Ingest depth | Jul–Aug | Phases 6+6b signed off |
| R3 FM1 live | Aug–Sep | 4 weeks external traffic; 1 capability available |
| R4 Tenant hardening | Sep–Oct | External audit: zero isolation criticals |
| R5 Control Plane out | Oct–Nov | 1 dispatched KR end-to-end |
| R6 Marketplace v0 | Nov–Dec | Sandbox connector lifecycle + OpenAPI in CI |
