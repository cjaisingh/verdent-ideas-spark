# AWIP — Commercial & Operational Readiness Companion

**Version:** 1.0 — 4 July 2026 — Status: Proposed. The platform and W10 packets are engineering-complete but assume away five commercial/operational preconditions. This document owns them; each section ends with a hard gate wired into the W10 spec/plan.

## 1. Pilot tenant acquisition
Every W10 gate and the FM rollout measure against "the pilot engagement" — it must be chosen, not assumed. **Profile:** document estate ≥500 files incl. ≥20 IFC/DWG; a live CAFM/IWMS (decides the S6 connector); an FM stakeholder willing to be FM1's subject; a lease portfolio if FM8 is to queue-jump. **Plan:** by end R1, shortlist 3 candidates (discussion action, owner+date); by W10 S1 close, one confirmed with a signed pilot agreement; terms = free/discounted use for data access, gate participation, referenceable case study, explicit exit clause. **Fallback (first-class):** tenant-zero = the consultancy's own estate and corpus; gates run at full strength minus external-stakeholder items; removes the external dependency from the critical path. **Hard gate:** W10 S3 does not start without a confirmed tenant (external or tenant-zero).

## 2. Legal readiness
Before real corporate documents flow: (a) DPA reviewed and executed by an actual solicitor — processor entity, retention/deletion commitments, SCC annex resolved; (b) retention commitments must match S1's retention_policies seeds (legal reads the spec, not a generic template); (c) sub-processor list referenced; any new W10 sub-processor (sidecar host, APS) added before first client file; (d) pilot agreement wrapping the DPA. **Hard gate:** W10 S2 sign-off requires an executed DPA (or documented tenant-zero exception).

## 3. Operator throughput & bus factor
Every W10 stage adds a human review queue to one person. Untreated, the trust boundary becomes a bottleneck, then a rubber stamp. **Throughput budget:** ~45 min/day of review; unit costs ≈ doc approval 30s, memory 20s, edge 5s (bulk), conflict group 60s → ~40 docs + 60 memories + 200 edges + 10 groups/day. **Every stage gate gains a queue condition:** 7-day median wait >72h = not adopted, drowning — fix auto-rules first. **Levers in order:** widen auto-approval per class on evidence (<2% overturn over 200 decisions graduates a class to auto); raise suggestion precision (kill patterns <20% confirm); bulk ops; only then a second human. **Second-operator trigger (named):** sustained median >72h after tuning, OR pilot converts to paying, OR FM5 GA approaches — then four_eyes gets its first class (contracts). Until then: docs/runbooks/operator-absence.md (pause auto-promote, extend SLAs, watchdog contact) is the mitigation — write it in S2.

## 4. Client identity model (R4b)
Clients enter at FM7 (read) and act at FM5 (write). Two-week slice between R4 and FM7: client_user role in user_roles with tenant binding; JWT claims carry tenant_id; a client_ RLS policy family (default deny, explicit allow, always via is_in_tenant_subtree); email/password auth, SSO deferred; every client-visible surface declared in a client_surfaces registry. FM7 read-only; FM5 adds first client writes behind their own approval kinds. **Hard gate:** FM7 build does not start until R4b's two-tenant client-role e2e is green.

## 5. Backup, DR & offboarding
**DR:** DB RPO ≤24h / RTO ≤8h; bucket second-location copy ≤24h; quarterly restore drill (scratch project, e2e smoke, one held-file round-trip) recorded as qa_checks; platform backup posture verified, never assumed, in docs/runbooks/disaster-recovery.md. Legal hold is only credible with proven restore. **Offboarding:** engagement.offboard flow — export pack (approved documents' metadata + memories + edges + facts, signed archive via the export machinery), staged deletion (bucket → chunks → memories/edges tombstoned, never row-deleted), honouring legal hold, evented, ending with a deletion certificate (HTML report pattern). The pilot agreement's exit clause points at this flow — and the pilot dry-runs it at programme exit.

## 6. AI accountability for high-consequence extractions
Anchor verification proves the quote exists, not that extraction is right; a wrong lease break-date becomes a financial event via FM8. **Rules:** (a) key_date and obligation memories are never auto-applied regardless of class policy — the tray enforces it structurally (no bulk-apply on those kinds); (b) accuracy eval harness — ≥50 hand-labelled fixtures per high-consequence kind; extractor changes must not regress precision below 95% (pre-deploy mandatory, adr-bench pattern); sub-threshold confidence renders a warning chip. **Downstream rule (FM8):** any scheduler reminder from an extracted date cites its memory + anchor so the human can verify in one click.

## 7. Cost & revenue lines
Sidecar cost gets an owner: ADR-0011 §hosting must include a monthly estimate entered as a recurring credit_entries row (three containers by S5, currently invisible to budget machinery). **Revenue instrumentation (R3):** tenants.commercial_status (internal/pilot/paying) + a manual tenant_revenue_entries ledger — not billing, just enough that quarterly reviews show cost AND revenue per tenant, fully instrumenting failure mode #3.

## 8. Honesty amendments
W10 PRD non-goals state corporate ingestion is file-shaped until W9.4 (done). W10 spec S5 adds parse_quality scoring — low-quality parses excluded from memory extraction, flagged for re-scan (done).

## Gate summary
| Gate | Blocks | Owner |
|---|---|---|
| Pilot tenant confirmed (or tenant-zero) | W10 S3 start | §1 |
| Executed DPA (or tenant-zero exception) | W10 S2 sign-off | §2 |
| Queue median ≤72h | Every W10 stage sign-off | §3 |
| Operator-absence runbook | W10 S2 sign-off | §3 |
| R4b client-role e2e green | FM7 build start | §4 |
| First restore drill recorded (incl. held file) | W10 S1 sign-off | §5 |
| Dry-run offboard executed | W10 programme exit | §5 |
| Eval harness ≥95% on key_date/obligation | S3 sign-off + every extractor change | §6 |
| Sidecar cost line in credit ledger | ADR-0011 acceptance | §7 |
