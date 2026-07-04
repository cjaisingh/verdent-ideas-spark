# AWIP Constellation Roadmap — 2027 Module Rollout

**Version:** 1.0 — 4 July 2026 — Status: Proposed
**Extends:** `docs/roadmap-2026-h2.md` (R1–R6) and the W10 programme. Sequences the outer ring from one live module (end 2026) toward the full constellation.
**Honesty note:** the constellation graphic is a 2028 end-state. This roadmap gets **six modules live by end 2027**, with the remainder in 2028. Twelve-in-a-year would break the promotion-gate discipline that makes the constellation trustworthy.

## 1. The module template (what "live" means)

A module is live when it: (1) runs as its own Lovable project with a scoped module_service_tokens row; (2) registers capabilities via POST /capabilities/register and heartbeats; (3) writes KR measurements against real tenant OKRs on a stated cadence; (4) has ≥1 capability promoted planned→experimental→available through the 8 gates; (5) carries projected_value_usd on every linked KR before activation, realized_value_usd within one quarter; (6) receives dispatch from the Control Plane (post-R5) where its work is KR-triggered.

**Cadence rules:** at most two modules in flight; a new module may not start until the previous passes gate 4; the demand board can re-order the queue at any quarterly review — the sequence is a default, not a decree.

## 2. Rollout sequence & rationale

```
2026            2027 Q1        Q2             Q3             Q4            2028
R3: FM1 ──────► FM7 ─────────► FM3 ──► FM5 ─► FM12 ────────► FM4 ──────►  FM8 · FM2 · FM10 · FM9 · FM6 · FM11
T-track: T1 twin fidelity ─► T2 shadow foundation ─► T3 canary governance ─► T4 predictive twin loop
A-track: A1 agent registry ─► A2 lessons + learning ─► A3 knowledge exchange
```

**FM1 — Stakeholder Intelligence (live end R3 2026 — the template).** Everything below inherits its integration pattern, e2e harness, and lessons.

**FM7 — Knowledge Management (2027-Q1).** The client-facing surface of W10: tenant knowledge portal (approved-corpus search, memory cards with anchors, document graph, digests). New Core asks: one retrieval contract row, one token — plus the R4b client-identity slice (client_user role, tenant-bound JWT claims, client_ RLS policy family, client_surfaces registry; two weeks between R4 and FM7 build; FM7 does not start until two-tenant client-role e2e green). Gate to start: W10 S2+S3 signed off + R4b green.

**FM3 — Performance Management (2027-Q1→Q2, thin).** Consumes the measurement path; variance, trends, period packs (HTML-report renderer), breach → discussion_actions. Gate: FM1 producing ≥8 weeks of measurements.

**FM5 — Workflow Automation (2027-Q2→Q3).** Productises R5 dispatch for client-visible workflows: templates (trigger → steps → human gates → evidence), tenant task lists, SLA timers. First client writes — pre-GA client-write security review required. Gate: R5 signed off; one internal KR-triggered dispatch ≥4 weeks.

**FM12 — Monitoring & Operations (2027-Q3→Q4).** BMS export ingestion (scheduled-pull adapters), Haystack-subset point tagging mapped to the twin via the resolver, threshold/anomaly findings (client-scoped check family), ops dashboards; first real ESG data source. Gates: W10 S5/S6 signed off; ADR-0013 (TSDB decision) decided on measured volume; a tenant with BMS export access.

**FM4 — Insight & Analytics (2027-Q4→2028-Q1).** Cross-module tenant analytics, benchmarks, and the constellation's first predictive KR. All predictive components are born inside the twin framework (T4): trained on estate-twin history, shadow-evaluated on held-out outcomes, canaried on tenant-zero, promoted only with baseline-beating evidence through the ai.component_promotion approval — no prediction without a measured baseline, structurally enforced.

## 3. 2028 horizon (sequenced, not scheduled)

**FM8 Portfolio — property, space & lease management** (strongest queue-jump candidate): lease abstraction = doc_memories obligation/key_date/party kinds; spaces = IFC spatial tree; IWMS sync = S6 bridge. Scope: property register, space inventory, lease register with critical-date tracking (breaks, expiries, rent reviews → scheduler reminders citing memory + anchor), occupancy-cost views feeding FM9. **Queue-jump trigger:** a tenant with a live break/expiry portfolio problem, or ≥200 applied lease-derived doc-memories. Then: **FM2 Strategy Design** (Discovery AI graduation), **FM10 Risk & Compliance** (W7 substrate pointed at client risk registers; likely W7.3 trigger), **FM9 Financial Management** (credits pattern outward), **FM6 Engagement & Communications** (operator-channel stack generalised), **FM11 Partner & Vendor Management** (mostly joins by then).

## 4. Ring-completion trajectory

| Ring | Completes when | Carried by |
|---|---|---|
| Memory (semantic) | W10 S3+S4 signed off | W10, then FM7 consumes |
| Data Foundation | W10 S1/S2 + R2 second adapter + replay | R2 + W10 |
| Security & Trust | R4 audit green + client_user role review | R4 + R4b + FM5 pre-GA audit |
| Integration Layer | R5 dispatch + R6 marketplace + W10 S6 bridge | R5/R6/W10 |
| Governance | W7.3/7.4 built or re-deferred with FM data | R3 triggers, else FM10 |
| AI & Intelligence (prediction) | First predictive KR beats its baseline | FM4/T4 |
| Infrastructure | Sidecar host decided | R1 |

## 5. Capacity & cost reality check

Single-operator + AI-agent build model, with the readiness companion's throughput budget as a standing constraint: any module whose review queues push 7-day median wait past 72h halts the rollout until auto-rules or a second operator fix it. Per-module build effort falls after FM1 (template dividend); FM7/FM3 deliberately thin. Any module whose projected monthly AI spend exceeds 15% of budget needs an explicit operator decision before build (rule → mem://preferences/). Revenue side: tenants.commercial_status + a manual revenue ledger land in R3, so every quarterly checkpoint reads cost AND revenue per tenant — failure mode #3 fully instrumented.

## 6. Quarterly checkpoint ritual

Each quarter (riding the quarterly-review cron): re-read the demand board, re-order the queue if evidence disagrees, verify docs/constellation.md statuses against the database, record the decision in the review's discussion action. The sequence serves demand — never the other way round.
