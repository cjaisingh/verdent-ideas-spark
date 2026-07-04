# Constellation Element Book — Volume 3: FM Modules 2028 (sketch depth)

**Version:** 1.0 — 4 July 2026 — Status: Proposed. Deliberately one level less detailed than Volume 2 — detail written eighteen months ahead is drift waiting to happen; each module gets a full plan.md on entry. Pinned here: problem, substrate, queue-jump trigger, entry gate. The Volume 2 common frame applies unchanged.

## M7 — FM8: Portfolio — Property, Space & Lease Management (first in queue; strongest queue-jump candidate)
**PRD sketch.** The portfolio — sites, leases, space inventory, critical dates — is FM's commercial skeleton, scattered across a lease spreadsheet, an untrusted IWMS and a solicitor's inbox; a missed break clause is a six-figure event. Apex: Cost Efficiency, Growth & Value Creation, Risk Reduction. Success shape: lease register complete, zero unmonitored critical dates; every reminder citing memory + anchor (§C6 rule); occupancy-cost views feeding FM9.
**Spec sketch.** Capabilities: fm8_property_register, fm8_space_inventory, fm8_lease_register, fm8_critical_dates. Stands almost entirely on W10: lease abstraction IS doc_memories obligation/key_date/party kinds (with structured.date_kind vocabulary — break, expiry, rent_review, indexation — flagged for the S3 plan); spaces ARE the IFC spatial tree with area facts; IWMS sync rides S6 (Planon/Archibus/TRIRIGA are IWMS as much as CAFM). Net-new: portfolio rollups, critical-date → scheduler reminders (kind fm8.critical_date, memory-cited), occupancy-cost mart.
**Plan sketch.** Entry: W10 exit + ≥1 lease-heavy tenant. **Queue-jump trigger (live from any checkpoint):** a tenant with an imminent break/expiry portfolio problem OR ≥200 applied lease-derived doc-memories — either makes FM8 rational ahead of FM12/FM4. ~5 wks (thin, W10-fed). High-consequence rules in full: no auto-applied dates, harness-gated extraction, human sign-off on the register before reminders arm.

## M8 — FM2: Strategy Design
**PRD sketch.** Strategy work (OKR drafting, options, scenarios) evaporates in Discovery AI conversations; it deserves the same versioned, evidenced treatment as everything downstream. Apex: Growth & Value Creation + feeds all seven.
**Spec sketch.** Largely a Discovery AI graduation: registers its behaviour as capabilities (fm2_okr_drafting, fm2_option_analysis, fm2_scenario_design); option/scenario objects with supersede semantics; drafting grounded in the estate twin + doc-memories (an option that cites the lease it depends on). All generation through the ladder; drafts never auto-ingested — operator disposition always.
**Plan sketch.** Entry: FM7 live + Discovery AI contract usage stable a quarter. Queue-jump: a kickoff pipeline where strategy work is the bottleneck. ~6 wks.

## M9 — FM10: Risk & Compliance
**PRD sketch.** Client risk registers and compliance obligations live in spreadsheets with no lineage to the documents that create them — while AWIP holds those documents, their obligations as memories, and a truth-arbitration substrate built for exactly this. Apex: Compliance Confidence, Risk Reduction. Success shape: compliance register derived from (not parallel to) memories and certificates; expiring-certificate coverage 100%; W7.3/7.4 finally earning their build if R3's triggers never fired.
**Spec sketch.** Capabilities: fm10_risk_register, fm10_compliance_calendar, fm10_certificate_tracking. Stands on W7 claims + decision authorities (client risk items are claims with sources and precedence — the substrate pointed outward); certificate class (S1) + expiry key_dates (S3) + FM8's reminder machinery. Likeliest W7.3 trigger: stale risk claims need down-weighting.
**Plan sketch.** Entry: FM8's critical-date machinery proven (reused wholesale). Queue-jump: a regulated-sector tenant or audit-driven procurement. ~6 wks.

## M10 — FM9: Financial Management
**PRD sketch.** FM cost data (contracts, invoices-as-documents, occupancy costs, project spend) has no unified client view, and the credits discipline has never been pointed at client money. Apex: Cost Efficiency, Growth & Value Creation. Success shape: occupancy cost per space/asset against the twin; realized-value evidence for the engagement itself.
**Spec sketch.** Capabilities: fm9_cost_register, fm9_budget_tracking, fm9_value_evidence. Stands on FM8's occupancy mart, contract/invoice classes + quantity memories (fact bridge), the §C7 revenue instrumentation matured. Explicitly NOT an accounting system — registers and evidence reconciled against finance exports via the adapter pattern, never a ledger of record.
**Plan sketch.** Entry: FM8 live. Queue-jump: a tenant procuring on cost transparency. ~6 wks.

## M11 — FM6: Engagement & Communications
**PRD sketch.** Client comms (digests, alerts, review summaries, escalations) are ad hoc; the operator-channel stack is proven but single-audience. Apex: Workplace Experience, Compliance Confidence (communication trails). Success shape: per-stakeholder preferences honoured; every outbound communication evented and provenance-linked; FM1 signals close the loop (did it land?).
**Spec sketch.** Capabilities: fm6_client_digests, fm6_alert_routing, fm6_comms_audit. Generalises digest generation (multi-audience), alert dispatch (client-scoped per-stakeholder channels, email first), HeyGen recaps within quota. Every message a row. Tone/content through the ladder with FM1-signal traces.
**Plan sketch.** Entry: FM1 + FM7 live. Queue-jump: pilot feedback that the portal is visited too rarely — push beats pull. ~5 wks.

## M12 — FM11: Partner & Vendor Management
**PRD sketch.** The supplier ecosystem is the last unmodelled population — external_contacts carries no vendor semantics, while vendor contracts already flow through W10 and vendor SLAs have FM5 shapes. Apex: Operational Excellence, Cost Efficiency, Risk Reduction. Success shape: vendor register with contract lineage; SLA performance from FM5 execution data, not vendor self-reporting.
**Spec sketch.** Capabilities: fm11_vendor_register, fm11_contract_linkage, fm11_sla_performance. external_contacts extended with vendor semantics; contract class + obligation memories; FM5 completion data as performance evidence; FM10 claims for vendor risk. By build time, mostly joins.
**Plan sketch.** Entry: FM5 + FM10 live. Queue-jump: a tenant whose pain is vendor chaos specifically. ~5 wks.

## Queue governance (restated once)
FM8 → FM2 → FM10 → FM9 → FM6 → FM11 is the dependency-rational default. Each quarterly checkpoint re-reads the demand board against the queue-jump triggers and re-orders with a recorded decision. Two-in-flight cap holds through 2028. If the constellation graphic and shipped reality disagree, docs/constellation.md is what gets believed — and updated.
