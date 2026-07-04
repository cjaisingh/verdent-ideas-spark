# AWIP Core — Full Project Review

**Date:** 4 July 2026
**Source:** Lovable project `AWIP Core`, 681 edits, last change 1 July 2026
**Reviewed:** master plan, architecture doc, CONTEXT.md, full changelog, ADRs 0001–0009, .lovable plan history, recent edit history, module register, memory system

## 1. Executive summary

AWIP Core has matured from an OKR/capability substrate (Phase 1, May 2026) into a genuinely sophisticated operator platform in under two months: a governed event-sourced data model, a hardened contract API, a full observability stack (sentinel + watchdog + observability registry + freshness views), secrets-at-rest with rotation runbooks, a global scheduler, an entity/tenant resolver with confidence bands, and — as of the 1 July commits — a working ingestion pipeline (W9.0/W9.1) with hybrid dense+lexical retrieval, a structured CSV/XLSX adapter, and a conflict/quarantine triage UI.

The engineering discipline is well above typical for a project of this age: contract-first edge functions, idempotency enforced everywhere, append-only event streams, ADRs with benchmark gates, a shrink-only lint ratchet, e2e RLS matrices, and a memory/lessons system that keeps agent sessions coherent.

The central strategic finding of this review is that **the substrate has outrun its consumers**. Core exists to serve a constellation — Discovery AI, a Control Plane, and acting FM modules — but no acting module has shipped. FM1 Stakeholder Intelligence exists only as three `planned` manifest rows. The demand board, the MoE router pattern (ADR-0007), the expert-feedback verifier (ADR-0008), the OKR value layer, and W7.3/W7.4 governance extensions are all explicitly gated on "≥1 module producing real capability traffic" — a trigger that has never fired. AWIP is, in its own words from the module register, still at risk of "talking to itself."

The second material finding is that **documentation and the database have drifted apart**. `docs/master-plan.md` still lists Phase 2 as active and Phases 5/6 as planned, while the changelog and edit history show Phase 5 substantially complete (resolver, aliases, thresholds, composite scoring, RLS predicate) and Phase 6 mid-flight with real code shipped. This drift was called out internally as early as 23 May and has recurred.

The third finding is that the **June external audit was a warning shot on tenant isolation**. Four criticals (#9–#12) included cross-tenant capability-event leakage and unscoped approval access. All were fixed within days, which is to the project's credit — but Phase 9 (multi-tenant hardening) is currently sequenced *after* the connector marketplace, which is the wrong order for a platform that just demonstrated tenant-isolation bugs in production paths.

The recommended posture for H2 2026: **stop widening the substrate, truth-up the plan, and ship one real module end-to-end** — then let module traffic pull forward the deferred work (MoE routing, verifiers, decay, Control Plane extraction) exactly as the ADR triggers were designed to do.

## 2. What is genuinely strong

**The invariant discipline.** The five rules in CONTEXT.md are load-bearing and enforced — by the Logger Validation workflow, the resolver-log-coverage CI guard, the idempotency body-hash checks, and the doc-drift workflow. Most projects state invariants; this one polices them.

**Operational self-awareness.** The sentinel → watchdog → observability-registry chain is a real defence-in-depth design. The 2026-06-01 sentinel-tick outage was instructive: a stale service token silenced the watcher, and the response was a structurally independent watcher-of-the-watcher with no shared secret. Failures are being converted into architecture.

**The audit response.** The external audit (June 10–11) triaged 19 findings across three tiers in roughly 48 hours, with per-finding fixes, a rollback runbook, and constant-time token comparison thrown in.

**Contract-first module boundary.** Per-module hashed scoped tokens, granular capability events, module heartbeats with silence detection, and the module scaffold mean the on-ramp for the first real module is genuinely ready.

**Cost governance.** The credits/usage layer (manual ledger + token proxy, runway views, drift-adjusted projections, budget alerts, night-window cheap-model coercion via a single `pickModel()` chokepoint) directly serves AWIP's founding failure-mode #3.

## 3. Findings and gaps

### 3.1 Strategic
**F1 — No acting module (critical, strategic).** Every deferred workstream is gated on real module traffic. Until FM1 ships as a separate project registering through the live contract, the platform cannot validate its own core hypothesis.
**F2 — Master plan drift (high).** Phase statuses no longer reflect reality; phase numbering is confusing (phase-4 consumed by Voice, phase-okr at order 9, reserved 8/10).
**F3 — Phase sequencing vs. risk (high).** Phase 9 (multi-tenant hardening) sits after Phase 7 (connector marketplace); the June audit demonstrated live tenant-isolation defects. Hardening should precede the marketplace.

### 3.2 Technical
**F4 — Ingest pipeline is one adapter deep (medium).** `SOURCE_ADAPTER_CONTRACT` has one implementation; ADR-0005's hybrid has no algorithm yet; BM25 is `ts_rank_cd` pending the W9.2 swap.
**F5 — Service-token lifecycle keeps biting (medium, recurring).** The token has caused the 2026-06-01 sentinel outage, ≥5 days of silent nightly failures, and 401 bursts. The three-store mirror plus GHA is a four-store problem with a three-store solution.
**F6 — Lint/type debt plateau (low-medium).** `no-explicit-any` baseline ~482; burn-down stalled; `codemod_replace_any` underused.
**F7 — Voice/companion surface sprawl (low).** The surviving surface has no OKR or KR linking it to value.
**F8 — ADR backlog in `proposed` (low).** ADR-0004 is actionable today: corpus gate satisfied at 1,100 aliases — run the bench with `--write-decision`.

### 3.3 Process
**F9 — Roadmap/DB reconciliation is manual (medium).** Extend the doc-drift workflow to check phase-status parity.
**F10 — Review cadence stale.** Last full review 10 May; this document feeds the quarterly review opened 1 July.

## 4. Risk register (top 6)

| # | Risk | Likelihood | Impact | Mitigation direction |
|---|------|-----------|--------|---------------------|
| R1 | Constellation never leaves "talking to itself" | Medium | Critical | Ship FM1 thin slice in R3; hard date |
| R2 | Tenant-isolation defect reaches a real customer tenant | Medium | Critical | Pull hardening ahead of marketplace; recurring audit cadence |
| R3 | Token rotation drift causes another silent outage | High | Medium | Automate GHA secret sync or OIDC |
| R4 | Ingest conflict volume outpaces manual triage | Medium | High | ADR-0005 bench + bulk pattern detection before more adapters |
| R5 | Doc/DB drift misleads agents | High | Medium | Extend doc-drift CI to master-plan parity |
| R6 | AI spend grows without value attribution | Low-Med | Medium | Require projected_value_usd on new KRs before module work |

## 5. Recommendations

1. **Truth-up sprint (1 week).** Rewrite master-plan.md to match the database, flip ADR-0004 via the bench, close Phases 2 and 5 through the sign-off gate flow, renumber the phase map.
2. **Finish Phase 6 to "second adapter" depth, not "marketplace" breadth.** One more real adapter, ADR-0005 decided with real conflict data, replay tooling, 6b dashboards.
3. **Ship FM1 as a separate Lovable project against the live contract** — thin slice: register capabilities, heartbeat, one KR measurement per week per tenant, consume demand.
4. **Pull multi-tenant hardening forward**: per-tenant JWT claims end-to-end, subtree-predicate adoption audit, quotas, isolation-focused external audit, tenant-admin surface v0.
5. **Kill the four-store token problem.** One rotation action, all stores.
6. **Only then** extract the Control Plane and open the connector marketplace, in that order.
