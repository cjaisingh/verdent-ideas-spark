# Phases 5, 6, 6b — Research Summary

Source: `notebook_entries` tagged phase-5/phase-6/phase-6b plus contract-level decisions
already captured in roadmap tasks. This file consolidates the **locked-in decisions** and
the **open questions** that still need an operator call before each sprint can close.

---

## Phase 5 — Entity & Tenant Resolution

### Locked-in decisions
- Resolver matches descriptors (asset code, name, address, postcode, BIM GUID) against
  `tenant_nodes` + `tenant_node_aliases`. Confident → auto-bind + record alias; ambiguous
  → `entity_resolution_conflicts`; no match → propose new node, operator approves with
  parent placement.
- **Hard invariants**:
  - Facts never promote with a guessed `tenant_node_id`.
  - Aliases are explicit + operator-approved; fuzzy match proposes, never commits.
  - One decision binds the whole batch (one approval per source file).
  - Aliases revocable; revocation flags previously-bound facts for re-review.
  - tenant_node merge/split are first-class approval kinds.
  - Authoritative IDs (BIM IFC GUID, RICS, OS UPRN, SAP FLOC) short-circuit fuzzy match.
- Every resolver query carries `tenant_id` and never crosses it (CI test with synthetic
  cross-tenant collisions).

### Open questions
1. **Score thresholds + descriptor weights** — defaults per descriptor type (postcode 0.9,
   free-text name 0.5)? Composite weighted-sum vs rule-based? Per-source overrides?
   Strategy: start conservative, loosen as alias table grows.
2. **Authoritative ID namespaces** — registry of trusted namespaces, per-namespace match
   rules (case, whitespace), conflict handling when two sources claim the same external ID
   for different nodes, tenant-scoped vs globally trusted.
3. **Ancestry storage (ADR-0003)** — materialised path vs `ltree` vs recursive CTE for
   depth-6+ ancestry; whether to denormalise `ancestry_ids[]` onto every fact for fast RLS.
4. **Alias revocation cascade (ADR-0004)** — hard re-quarantine vs soft flag; OKR-owner
   notifications; bulk re-resolve UX at 10k+ rows; revocation as admin-only approval.

---

## Phase 6 — Ingest & Canonicalisation

### Locked-in decisions
- Pipeline: `raw_records → staged_records → validation → canonical_facts`. Nothing lands
  in canonical without passing the gate.
- Every canonical row carries `raw_record_id`, `source_mapping_id`, `tenant_node_id`,
  `promoted_at`, `promoted_by` (or `auto_promoted=true`).
- Mutations append; corrections supersede via `superseded_by` (mirrors `okr_nodes`).
- Hard-delete forbidden; physical removal only via DSAR path.
- Auto-promote only when `source_mapping` is approved AND all validations pass AND no PII
  fields touched without lawful basis.
- Every promotion emits an `ingest_events` row.
- Value conflicts → `fact_conflicts` + approval (never silent overwrite). Per-fact-type
  tolerance declared with the canonical schema, overridable per `tenant_node`. Resolution
  rules can be promoted to `conflict_rules` (declarative precedence, versioned, revocable).

### Open questions
1. **Source taxonomy** — connector-per-source vs one generic file connector + per-format
   parser skill. Day-1 set: CSV/XLSX, JSON/XML, BMS/IoT batch, lease PDF, email,
   Telegram voice. Day-90 set: BIM (IFC, COBie), CAFM exports, ERP (SAP IDoc, Oracle).
2. **Schema inference threshold** — Gemini 2.5 Flash proposes mappings; auto-promote
   threshold (proposal: ≥0.9 if no PII), sample size vs whole file, column-drift handling
   via `source_mappings` versioning, whether the LLM may invent canonical fields.
3. **Tolerance defaults** — who authors them (central vs schema author), per-tenant
   override path, symmetric vs asymmetric, location (`conflict_rules` vs canonical schema).
4. **Bulk conflict UX** — 400 conflicts from a re-ingest as 400 cards (unworkable), one
   card with line items, group-by-source-mapping bulk accept, or pre-computed conflict
   patterns with one-click. Needs real messy import to lock.
5. **Conflict SLA + rollup blocking** — does a pending conflict on a KR's underlying fact
   block the rollup or compute stale + flag? Per-OKR cadence; Telegram ping at N hours;
   "restate closed period" as a separate flow.
6. **Retroactive corrections to closed periods** — hard-block vs separate restatement
   approval vs snapshot-on-close immutable views (corrections create v+1). IFRS/CSRD
   restatement rules to encode.
7. **Conflict precedence rule learning (deferred)** — auto-propose a `conflict_rule` after
   N consistent manual decisions; mitigations: provenance, revocability, event-on-fire.
8. **PII / lawful basis / DSAR** — tag PII at `raw_records` (broad) or `canonical_facts`
   (precise); who declares lawful basis; DSAR tombstone strategy across raw → canonical →
   chunks → embeddings; rectification as mutation vs append+replay; raw retention
   30/90/365; column-level redaction vs `pgcrypto` at rest.
9. **RAG split (ADR-0006)** — embedding model (Gemini text-embedding-004 768d vs BGE
   1024d self-host); per-source chunk strategy (lease PDF semantic sections, SFG20 one
   chunk per task, email thread-aware, voice utterance); hybrid search (FTS+vector
   in-Postgres vs Typesense); index choice (hnsw vs ivfflat) at expected corpus size;
   re-embed cadence; whether to embed canonical facts directly or only synthetic text.
10. **Compliance hooks at ingest** — SFG20 task code normaliser (licence vs client-mapped
    codes); BIM ISO 19650 CDE references stored as URL+GUID vs pulled metadata; Cyber
    Essentials Plus connector audit (separate `connector_audit_log`?); ISO 27001 audit
    pack export on demand; SECR/CSRD/SBTi emission factors with provenance.
11. **Skills vs Agents in ingest** — `ingest_concierge` agent walking operator through
    new sources vs static wizard; `validation_agent` proposing fixes (unit conversion,
    date reformat) vs quarantine-only; auto-mapping replay on column rename; per-run
    token budget + degradation 2.5 Pro → 2.5 Flash.
12. **PDF + email + voice specifics** — layout-aware vision vs text-only for leases
    (tables, signatures, redlines); IMAP poll vs Postmark/SES webhook for email; voice
    transcripts in `raw_records` vs separate store; PII redaction before persistence.

---

## Phase 6b — Ingest Observability

### Locked-in decisions
- `/ingest` dashboard surfaces conflicts, bulk patterns, quarantine inbox, replay control.
- `/entities` page surfaces alias review queue, bulk re-resolve, resolver decision detail.
- Conflict and quarantine SLAs roll up to OKRs; breaches alert via existing webhook.
- Telegram digest is the daily ambient channel; the dashboard is the deep-dive.

### Open questions
1. **Quarantine UX** — per-source queue vs unified inbox; bulk-fix patterns ("all rows
   missing postcode → infer from site_id"); SLA before blocking parent OKR; notification
   threshold; replay semantics on `source_mapping` fix (auto-retry vs manual).
2. **Telegram as entity/conflict channel** — voice → intent classification (alias_create,
   conflict_resolve, rule_create) → approval_queue → execute. Confirmation echo required
   before commit because voice is lossy.
3. **Resolver health metrics** — which counters drive the dashboard (auto-bind rate,
   conflict-per-1k-rows, alias growth, cross-tenant near-misses) and at what cadence.
4. **Bulk re-resolve UI** — same surface as bulk conflict UX or a distinct flow; preview
   of impact before commit; undo window.

---

## ADRs to draft this round
- **ADR-0003** — Tenant-node ancestry storage strategy (path / ltree / CTE / denormalised).
- **ADR-0004** — Alias revocation cascade semantics (soft flag vs hard re-quarantine).
- **ADR-0005** — Bulk conflict pattern detection algorithm.
- **ADR-0006** — Embedding model + index choice for RAG.

These are stubs only this round; full decisions land when each sprint opens.
