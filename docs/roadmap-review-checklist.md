# Roadmap Review Checklist — Phases 5, 6, 6b, 7, 9, 11

Use this checklist to approve each task. One section per task: research sources, risk flags, what to verify before merge.

Tasks covered: **110**.


## Entity & Tenant Resolution (`phase-5`)


### s5.1 — Entity model + alias resolver

> Goal: Schema + resolve_entity() SDF, no UI yet.

#### s5.1.t1 — tenant_nodes schema

- **Module:** core
- **Depends on:** —
- **Description:** Table with parent_id, kind (group/region/opco/division/site/asset), authoritative_ids jsonb, tenant_id scoping.
- **Acceptance:** Ancestry walk to depth 6 returns in <50ms on 10k rows; RLS forbids cross-tenant select.
- **Research sources:**
  - Notebook entries tagged with the parent phase
  - docs/phases-5-6-6b-research.md (locked decisions + open questions)
- **Risk flags:**
  - **Security/isolation** — Cross-tenant leak or RLS bypass
  - **Schema migration** — Backwards-compat, RLS on new table, realtime publication
- **Verify before approve:**
  - [ ] Acceptance line met: _Ancestry walk to depth 6 returns in <50ms on 10k rows; RLS forbids cross-tenant select._
  - [ ] Migration (if any) leaves RLS enabled and realtime publication updated
  - [ ] No new secret printed in logs or stored in plaintext
  - [ ] New events flow through `*_events` table and are visible in /db-explorer
  - [ ] Idempotency-Key replay returns identical response (writes only)
  - [ ] Roadmap task moves to `done` only when CHANGELOG entry + docs reference exist

#### s5.1.t2 — tenant_node_aliases table

- **Module:** core
- **Depends on:** `s5.1.t1`
- **Description:** Alias text, descriptor_kind (name/postcode/asset_code/external_id), source, approved_by, revoked_at.
- **Acceptance:** Revocation flips revoked_at and emits a tenant_node_event row.
- **Research sources:**
  - Notebook entries tagged with the parent phase
  - docs/phases-5-6-6b-research.md (locked decisions + open questions)
- **Risk flags:**
  - **Security/isolation** — Cross-tenant leak or RLS bypass
  - **Approval contract** — New activity must be added to activity_policies + audited
  - **Schema migration** — Backwards-compat, RLS on new table, realtime publication
- **Verify before approve:**
  - [ ] Acceptance line met: _Revocation flips revoked_at and emits a tenant_node_event row._
  - [ ] Migration (if any) leaves RLS enabled and realtime publication updated
  - [ ] No new secret printed in logs or stored in plaintext
  - [ ] New events flow through `*_events` table and are visible in /db-explorer
  - [ ] Idempotency-Key replay returns identical response (writes only)
  - [ ] Roadmap task moves to `done` only when CHANGELOG entry + docs reference exist

#### s5.1.t3 — resolve_entity() function — deterministic core

- **Module:** core
- **Depends on:** `s5.1.t2`
- **Description:** Exact + normalised match against aliases and authoritative_ids. Returns single binding or candidate set with scores.
- **Acceptance:** Golden-set test passes; never returns cross-tenant candidates.
- **Research sources:**
  - Notebook entries tagged with the parent phase
  - docs/phases-5-6-6b-research.md (locked decisions + open questions)
- **Risk flags:**
  - **Security/isolation** — Cross-tenant leak or RLS bypass
- **Verify before approve:**
  - [ ] Acceptance line met: _Golden-set test passes; never returns cross-tenant candidates._
  - [ ] Migration (if any) leaves RLS enabled and realtime publication updated
  - [ ] No new secret printed in logs or stored in plaintext
  - [ ] New events flow through `*_events` table and are visible in /db-explorer
  - [ ] Idempotency-Key replay returns identical response (writes only)
  - [ ] Roadmap task moves to `done` only when CHANGELOG entry + docs reference exist

#### s5.1.t4 — Authoritative ID registry

- **Module:** core
- **Depends on:** `s5.1.t3`
- **Description:** Namespaces table for bim_ifc_guid, rics_asset_ref, os_uprn, sap_functional_loc with per-namespace match rules.
- **Acceptance:** BIM GUID match short-circuits and beats fuzzy name match in resolver test.
- **Research sources:**
  - Notebook entries tagged with the parent phase
  - docs/phases-5-6-6b-research.md (locked decisions + open questions)
  - buildingSMART IFC GUID spec
  - RICS asset reference standard
  - Ordnance Survey UPRN registry
  - SAP Functional Location structure
- **Risk flags:**
  - **Schema migration** — Backwards-compat, RLS on new table, realtime publication
  - **Operator UX** — Realtime subscription + empty/loading/error states
- **Verify before approve:**
  - [ ] Acceptance line met: _BIM GUID match short-circuits and beats fuzzy name match in resolver test._
  - [ ] Migration (if any) leaves RLS enabled and realtime publication updated
  - [ ] No new secret printed in logs or stored in plaintext
  - [ ] New events flow through `*_events` table and are visible in /db-explorer
  - [ ] Idempotency-Key replay returns identical response (writes only)
  - [ ] Roadmap task moves to `done` only when CHANGELOG entry + docs reference exist

#### s5.1.t5 — Cross-tenant isolation test suite

- **Module:** core
- **Depends on:** `s5.1.t3`
- **Description:** Synthetic dataset with intentional code collisions across two tenants; CI check.
- **Acceptance:** Zero cross-tenant proposals across full test corpus; failure breaks CI.
- **Research sources:**
  - Notebook entries tagged with the parent phase
  - docs/phases-5-6-6b-research.md (locked decisions + open questions)
- **Risk flags:**
  - **Security/isolation** — Cross-tenant leak or RLS bypass
  - **Operator UX** — Realtime subscription + empty/loading/error states
- **Verify before approve:**
  - [ ] Acceptance line met: _Zero cross-tenant proposals across full test corpus; failure breaks CI._
  - [ ] Migration (if any) leaves RLS enabled and realtime publication updated
  - [ ] No new secret printed in logs or stored in plaintext
  - [ ] New events flow through `*_events` table and are visible in /db-explorer
  - [ ] Idempotency-Key replay returns identical response (writes only)
  - [ ] Roadmap task moves to `done` only when CHANGELOG entry + docs reference exist

#### s5.1.t6 — entity_resolution_conflicts table + approval activity

- **Module:** core
- **Depends on:** `s5.1.t3`
- **Description:** One approval per batch (not per row). Adds entity_resolution, tenant_node_create, tenant_node_merge, tenant_node_split to activity_policies.
- **Acceptance:** Importing 14 conflicting rows from one file produces exactly one approval card.
- **Research sources:**
  - Notebook entries tagged with the parent phase
  - docs/phases-5-6-6b-research.md (locked decisions + open questions)
- **Risk flags:**
  - **Security/isolation** — Cross-tenant leak or RLS bypass
  - **Approval contract** — New activity must be added to activity_policies + audited
  - **Schema migration** — Backwards-compat, RLS on new table, realtime publication
  - **Data integrity** — Append-only; never silent overwrite; audit diff
- **Verify before approve:**
  - [ ] Acceptance line met: _Importing 14 conflicting rows from one file produces exactly one approval card._
  - [ ] Migration (if any) leaves RLS enabled and realtime publication updated
  - [ ] No new secret printed in logs or stored in plaintext
  - [ ] New events flow through `*_events` table and are visible in /db-explorer
  - [ ] Idempotency-Key replay returns identical response (writes only)
  - [ ] Roadmap task moves to `done` only when CHANGELOG entry + docs reference exist


### s5.2 — Resolver scoring + ancestry

> Goal: Composite scoring, thresholds, ancestry storage decision, universal RLS helper.

#### s5.2.t1 — Composite scorer with descriptor weights

- **Module:** core
- **Depends on:** `s5.1.t3`
- **Description:** Postcode 0.9 floor, free-text name 0.5, weighted sum + per-source overrides. Config in resolver_weights table.
- **Acceptance:** Unit test: changing a weight changes the winner deterministically.
- **Research sources:**
  - Notebook entries tagged with the parent phase
  - docs/phases-5-6-6b-research.md (locked decisions + open questions)
- **Risk flags:**
  - **Schema migration** — Backwards-compat, RLS on new table, realtime publication
- **Verify before approve:**
  - [ ] Acceptance line met: _Unit test: changing a weight changes the winner deterministically._
  - [ ] Migration (if any) leaves RLS enabled and realtime publication updated
  - [ ] No new secret printed in logs or stored in plaintext
  - [ ] New events flow through `*_events` table and are visible in /db-explorer
  - [ ] Idempotency-Key replay returns identical response (writes only)
  - [ ] Roadmap task moves to `done` only when CHANGELOG entry + docs reference exist

#### s5.2.t2 — Score threshold defaults

- **Module:** core
- **Depends on:** `s5.2.t1`
- **Description:** Auto-bind >=0.92, propose 0.7-0.92, reject <0.7. Per-source overridable.
- **Acceptance:** Thresholds editable from /admin and decision is logged in resolver_decision_log.
- **Research sources:**
  - Notebook entries tagged with the parent phase
  - docs/phases-5-6-6b-research.md (locked decisions + open questions)
- **Risk flags:**
  - **Schema migration** — Backwards-compat, RLS on new table, realtime publication
- **Verify before approve:**
  - [ ] Acceptance line met: _Thresholds editable from /admin and decision is logged in resolver_decision_log._
  - [ ] Migration (if any) leaves RLS enabled and realtime publication updated
  - [ ] No new secret printed in logs or stored in plaintext
  - [ ] New events flow through `*_events` table and are visible in /db-explorer
  - [ ] Idempotency-Key replay returns identical response (writes only)
  - [ ] Roadmap task moves to `done` only when CHANGELOG entry + docs reference exist

#### s5.2.t3 — Ancestry storage decision (ADR-0003)

- **Module:** core
- **Depends on:** —
- **Description:** Benchmark recursive CTE vs ltree vs denormalised ancestor_ids[]; choose based on 6-level depth + RLS predicate cost.
- **Acceptance:** ADR-0003 merged; benchmark numbers in docs/adr/0003-*.md.
- **Research sources:**
  - Notebook entries tagged with the parent phase
  - docs/phases-5-6-6b-research.md (locked decisions + open questions)
  - docs/adr/0003-tenant-ancestry.md (to draft)
- **Risk flags:**
  - **Security/isolation** — Cross-tenant leak or RLS bypass
  - **LLM cost/quality** — Token budget, fallback model, eval on golden set
- **Verify before approve:**
  - [ ] Acceptance line met: _ADR-0003 merged; benchmark numbers in docs/adr/0003-*.md._
  - [ ] Migration (if any) leaves RLS enabled and realtime publication updated
  - [ ] No new secret printed in logs or stored in plaintext
  - [ ] New events flow through `*_events` table and are visible in /db-explorer
  - [ ] Idempotency-Key replay returns identical response (writes only)
  - [ ] Roadmap task moves to `done` only when CHANGELOG entry + docs reference exist

#### s5.2.t4 — Universal RLS predicate helper

- **Module:** core
- **Depends on:** `s5.1.t1`
- **Description:** has_tenant_node_access(uuid) security-definer, used by every fact table.
- **Acceptance:** Smoke test across canonical_facts read/write passes for in-scope, fails for out-of-scope.
- **Research sources:**
  - Notebook entries tagged with the parent phase
  - docs/phases-5-6-6b-research.md (locked decisions + open questions)
- **Risk flags:**
  - **Security/isolation** — Cross-tenant leak or RLS bypass
  - **Schema migration** — Backwards-compat, RLS on new table, realtime publication
  - **Operator UX** — Realtime subscription + empty/loading/error states
- **Verify before approve:**
  - [ ] Acceptance line met: _Smoke test across canonical_facts read/write passes for in-scope, fails for out-of-scope._
  - [ ] Migration (if any) leaves RLS enabled and realtime publication updated
  - [ ] No new secret printed in logs or stored in plaintext
  - [ ] New events flow through `*_events` table and are visible in /db-explorer
  - [ ] Idempotency-Key replay returns identical response (writes only)
  - [ ] Roadmap task moves to `done` only when CHANGELOG entry + docs reference exist

#### s5.2.t5 — Resolver decision log

- **Module:** core
- **Depends on:** `s5.2.t1`
- **Description:** Every resolve call records candidate set, scores, choice, actor.
- **Acceptance:** Visible in /db-explorer; resolver call without log row breaks CI.
- **Research sources:**
  - Notebook entries tagged with the parent phase
  - docs/phases-5-6-6b-research.md (locked decisions + open questions)
- **Risk flags:**
  - **Scope creep** — Verify acceptance line is the only outcome shipped
- **Verify before approve:**
  - [ ] Acceptance line met: _Visible in /db-explorer; resolver call without log row breaks CI._
  - [ ] Migration (if any) leaves RLS enabled and realtime publication updated
  - [ ] No new secret printed in logs or stored in plaintext
  - [ ] New events flow through `*_events` table and are visible in /db-explorer
  - [ ] Idempotency-Key replay returns identical response (writes only)
  - [ ] Roadmap task moves to `done` only when CHANGELOG entry + docs reference exist


### s5.3 — Alias lifecycle

> Goal: Approval flow, revocation cascade, merge/split as first-class operations.

#### s5.3.t1 — Alias approval flow

- **Module:** core
- **Depends on:** `s5.1.t6`, `s5.2.t5`
- **Description:** Fuzzy match raises an approval with sample rows; one decision binds the batch.
- **Acceptance:** Approving once promotes all rows from the batch; no per-row clicks.
- **Research sources:**
  - Notebook entries tagged with the parent phase
  - docs/phases-5-6-6b-research.md (locked decisions + open questions)
- **Risk flags:**
  - **Approval contract** — New activity must be added to activity_policies + audited
- **Verify before approve:**
  - [ ] Acceptance line met: _Approving once promotes all rows from the batch; no per-row clicks._
  - [ ] Migration (if any) leaves RLS enabled and realtime publication updated
  - [ ] No new secret printed in logs or stored in plaintext
  - [ ] New events flow through `*_events` table and are visible in /db-explorer
  - [ ] Idempotency-Key replay returns identical response (writes only)
  - [ ] Roadmap task moves to `done` only when CHANGELOG entry + docs reference exist

#### s5.3.t2 — Alias revocation cascade — soft flag (ADR-0004)

- **Module:** core
- **Depends on:** `s5.3.t1`
- **Description:** Revocation flags every fact bound via that alias as re_review; fact stays live; banner on OKR detail.
- **Acceptance:** ADR-0004 records soft-vs-hard decision; flagged facts show banner; nothing is silently mutated.
- **Research sources:**
  - Notebook entries tagged with the parent phase
  - docs/phases-5-6-6b-research.md (locked decisions + open questions)
  - docs/adr/0004-alias-revocation.md (to draft)
- **Risk flags:**
  - **Operator UX** — Realtime subscription + empty/loading/error states
- **Verify before approve:**
  - [ ] Acceptance line met: _ADR-0004 records soft-vs-hard decision; flagged facts show banner; nothing is silently mutated._
  - [ ] Migration (if any) leaves RLS enabled and realtime publication updated
  - [ ] No new secret printed in logs or stored in plaintext
  - [ ] New events flow through `*_events` table and are visible in /db-explorer
  - [ ] Idempotency-Key replay returns identical response (writes only)
  - [ ] Roadmap task moves to `done` only when CHANGELOG entry + docs reference exist

#### s5.3.t3 — Bulk re-resolve UX spec

- **Module:** operator_console
- **Depends on:** `s5.2.t1`
- **Description:** Design doc only this sprint; UI lands in s6b.2.
- **Acceptance:** Spec PR merged with mocks for the >100-row case.
- **Research sources:**
  - Notebook entries tagged with the parent phase
  - docs/phases-5-6-6b-research.md (locked decisions + open questions)
- **Risk flags:**
  - **Operator UX** — Realtime subscription + empty/loading/error states
- **Verify before approve:**
  - [ ] Acceptance line met: _Spec PR merged with mocks for the >100-row case._
  - [ ] Migration (if any) leaves RLS enabled and realtime publication updated
  - [ ] No new secret printed in logs or stored in plaintext
  - [ ] New events flow through `*_events` table and are visible in /db-explorer
  - [ ] Idempotency-Key replay returns identical response (writes only)
  - [ ] Roadmap task moves to `done` only when CHANGELOG entry + docs reference exist

#### s5.3.t4 — tenant_node merge/split operations

- **Module:** core
- **Depends on:** `s5.1.t1`, `s5.3.t1`
- **Description:** First-class approvals; merge unions aliases, split requires reassignment plan.
- **Acceptance:** Merge then split round-trip preserves all aliases and emits two tenant_node_events.
- **Research sources:**
  - Notebook entries tagged with the parent phase
  - docs/phases-5-6-6b-research.md (locked decisions + open questions)
- **Risk flags:**
  - **Security/isolation** — Cross-tenant leak or RLS bypass
  - **Approval contract** — New activity must be added to activity_policies + audited
  - **Operator UX** — Realtime subscription + empty/loading/error states
- **Verify before approve:**
  - [ ] Acceptance line met: _Merge then split round-trip preserves all aliases and emits two tenant_node_events._
  - [ ] Migration (if any) leaves RLS enabled and realtime publication updated
  - [ ] No new secret printed in logs or stored in plaintext
  - [ ] New events flow through `*_events` table and are visible in /db-explorer
  - [ ] Idempotency-Key replay returns identical response (writes only)
  - [ ] Roadmap task moves to `done` only when CHANGELOG entry + docs reference exist


## Ingest & Canonicalisation (`phase-6`)


### s6.1 — Canonical ingest spine

> Goal: Source adapter contract, conflict table, supersede rules.

#### s6.1.t1 — raw_records table

- **Module:** ingest
- **Depends on:** —
- **Description:** Append-only, source_id, payload jsonb, ingested_at, retention_class. Per-source retention from retention_settings.
- **Acceptance:** Insert + nightly purge respect per-source retention; immutable audit row.
- **Research sources:**
  - Notebook entries tagged with the parent phase
  - docs/phases-5-6-6b-research.md (locked decisions + open questions)
- **Risk flags:**
  - **Privacy/GDPR** — PII handling, lawful basis, erasure traversal
  - **Schema migration** — Backwards-compat, RLS on new table, realtime publication
- **Verify before approve:**
  - [ ] Acceptance line met: _Insert + nightly purge respect per-source retention; immutable audit row._
  - [ ] Migration (if any) leaves RLS enabled and realtime publication updated
  - [ ] No new secret printed in logs or stored in plaintext
  - [ ] New events flow through `*_events` table and are visible in /db-explorer
  - [ ] Idempotency-Key replay returns identical response (writes only)
  - [ ] Roadmap task moves to `done` only when CHANGELOG entry + docs reference exist

#### s6.1.t2 — staged_records table

- **Module:** ingest
- **Depends on:** `s6.1.t1`
- **Description:** Typed, validated, awaiting promotion. References raw_record_id + source_mapping_id.
- **Acceptance:** Failed validation routes row to quarantine with reason; never to canonical.
- **Research sources:**
  - Notebook entries tagged with the parent phase
  - docs/phases-5-6-6b-research.md (locked decisions + open questions)
- **Risk flags:**
  - **Schema migration** — Backwards-compat, RLS on new table, realtime publication
- **Verify before approve:**
  - [ ] Acceptance line met: _Failed validation routes row to quarantine with reason; never to canonical._
  - [ ] Migration (if any) leaves RLS enabled and realtime publication updated
  - [ ] No new secret printed in logs or stored in plaintext
  - [ ] New events flow through `*_events` table and are visible in /db-explorer
  - [ ] Idempotency-Key replay returns identical response (writes only)
  - [ ] Roadmap task moves to `done` only when CHANGELOG entry + docs reference exist

#### s6.1.t3 — canonical_facts pattern (per fact-type)

- **Module:** ingest
- **Depends on:** `s6.1.t2`
- **Description:** Every row carries raw_record_id, source_mapping_id, tenant_node_id, promoted_at, promoted_by, superseded_by. Hard-delete forbidden.
- **Acceptance:** Trigger blocks DELETE except via DSAR path; supersede preserves history.
- **Research sources:**
  - Notebook entries tagged with the parent phase
  - docs/phases-5-6-6b-research.md (locked decisions + open questions)
- **Risk flags:**
  - **Security/isolation** — Cross-tenant leak or RLS bypass
  - **Privacy/GDPR** — PII handling, lawful basis, erasure traversal
  - **Data integrity** — Append-only; never silent overwrite; audit diff
- **Verify before approve:**
  - [ ] Acceptance line met: _Trigger blocks DELETE except via DSAR path; supersede preserves history._
  - [ ] Migration (if any) leaves RLS enabled and realtime publication updated
  - [ ] No new secret printed in logs or stored in plaintext
  - [ ] New events flow through `*_events` table and are visible in /db-explorer
  - [ ] Idempotency-Key replay returns identical response (writes only)
  - [ ] Roadmap task moves to `done` only when CHANGELOG entry + docs reference exist

#### s6.1.t4 — source_mappings table + versioning

- **Module:** ingest
- **Depends on:** `s6.1.t1`, `s6.1.t2`
- **Description:** Operator-approved column->canonical field map; column drift bumps version.
- **Acceptance:** Renamed column produces v+1 mapping awaiting approval, not silent failure.
- **Research sources:**
  - Notebook entries tagged with the parent phase
  - docs/phases-5-6-6b-research.md (locked decisions + open questions)
- **Risk flags:**
  - **Approval contract** — New activity must be added to activity_policies + audited
  - **Schema migration** — Backwards-compat, RLS on new table, realtime publication
- **Verify before approve:**
  - [ ] Acceptance line met: _Renamed column produces v+1 mapping awaiting approval, not silent failure._
  - [ ] Migration (if any) leaves RLS enabled and realtime publication updated
  - [ ] No new secret printed in logs or stored in plaintext
  - [ ] New events flow through `*_events` table and are visible in /db-explorer
  - [ ] Idempotency-Key replay returns identical response (writes only)
  - [ ] Roadmap task moves to `done` only when CHANGELOG entry + docs reference exist

#### s6.1.t5 — ingest_events table

- **Module:** ingest
- **Depends on:** `s6.1.t1`
- **Description:** One event per promotion / supersede / quarantine / release.
- **Acceptance:** Every state change observable on /events; no orphan canonical rows.
- **Research sources:**
  - Notebook entries tagged with the parent phase
  - docs/phases-5-6-6b-research.md (locked decisions + open questions)
- **Risk flags:**
  - **Schema migration** — Backwards-compat, RLS on new table, realtime publication
  - **Data integrity** — Append-only; never silent overwrite; audit diff
- **Verify before approve:**
  - [ ] Acceptance line met: _Every state change observable on /events; no orphan canonical rows._
  - [ ] Migration (if any) leaves RLS enabled and realtime publication updated
  - [ ] No new secret printed in logs or stored in plaintext
  - [ ] New events flow through `*_events` table and are visible in /db-explorer
  - [ ] Idempotency-Key replay returns identical response (writes only)
  - [ ] Roadmap task moves to `done` only when CHANGELOG entry + docs reference exist

#### s6.1.t6 — Auto-promote rule

- **Module:** ingest
- **Depends on:** `s6.1.t3`, `s6.1.t4`
- **Description:** Only when source_mapping approved AND validations pass AND no untagged PII. Otherwise queue.
- **Acceptance:** PII-tagged column without lawful basis blocks promotion in test.
- **Research sources:**
  - Notebook entries tagged with the parent phase
  - docs/phases-5-6-6b-research.md (locked decisions + open questions)
  - UK GDPR special-category guidance
- **Risk flags:**
  - **Privacy/GDPR** — PII handling, lawful basis, erasure traversal
  - **Approval contract** — New activity must be added to activity_policies + audited
- **Verify before approve:**
  - [ ] Acceptance line met: _PII-tagged column without lawful basis blocks promotion in test._
  - [ ] Migration (if any) leaves RLS enabled and realtime publication updated
  - [ ] No new secret printed in logs or stored in plaintext
  - [ ] New events flow through `*_events` table and are visible in /db-explorer
  - [ ] Idempotency-Key replay returns identical response (writes only)
  - [ ] Roadmap task moves to `done` only when CHANGELOG entry + docs reference exist


### s6.2 — Source adapters

> Goal: Connector contract + adapters for CSV/XLSX, JSON, BMS, lease PDFs, email, Telegram voice.

#### s6.2.t1 — Source connector contract

- **Module:** ingest
- **Depends on:** `s6.1.t1`, `s6.1.t2`
- **Description:** Manifest fields: id, kind, schema_inference_supported, pii_classes_emitted, lawful_basis_required.
- **Acceptance:** Manifest validated on register; missing field returns 400.
- **Research sources:**
  - Notebook entries tagged with the parent phase
  - docs/phases-5-6-6b-research.md (locked decisions + open questions)
  - UK GDPR special-category guidance
- **Risk flags:**
  - **Privacy/GDPR** — PII handling, lawful basis, erasure traversal
  - **Schema migration** — Backwards-compat, RLS on new table, realtime publication
  - **Vendor coupling** — Pin upstream version; document break-glass
  - **Operator UX** — Realtime subscription + empty/loading/error states
- **Verify before approve:**
  - [ ] Acceptance line met: _Manifest validated on register; missing field returns 400._
  - [ ] Migration (if any) leaves RLS enabled and realtime publication updated
  - [ ] No new secret printed in logs or stored in plaintext
  - [ ] New events flow through `*_events` table and are visible in /db-explorer
  - [ ] Idempotency-Key replay returns identical response (writes only)
  - [ ] Roadmap task moves to `done` only when CHANGELOG entry + docs reference exist

#### s6.2.t2 — CSV/XLSX adapter

- **Module:** ingest
- **Depends on:** `s6.2.t1`
- **Description:** Multi-sheet, header-row detection, merged cells, big-file streaming.
- **Acceptance:** 10MB XLSX with header in row 5 ingests without OOM.
- **Research sources:**
  - Notebook entries tagged with the parent phase
  - docs/phases-5-6-6b-research.md (locked decisions + open questions)
- **Risk flags:**
  - **Vendor coupling** — Pin upstream version; document break-glass
- **Verify before approve:**
  - [ ] Acceptance line met: _10MB XLSX with header in row 5 ingests without OOM._
  - [ ] Migration (if any) leaves RLS enabled and realtime publication updated
  - [ ] No new secret printed in logs or stored in plaintext
  - [ ] New events flow through `*_events` table and are visible in /db-explorer
  - [ ] Idempotency-Key replay returns identical response (writes only)
  - [ ] Roadmap task moves to `done` only when CHANGELOG entry + docs reference exist

#### s6.2.t3 — JSON/XML feed adapter

- **Module:** ingest
- **Depends on:** `s6.2.t1`
- **Description:** Schema sample + jsonpath mapping.
- **Acceptance:** Operator approves jsonpath map; subsequent feeds promote silently.
- **Research sources:**
  - Notebook entries tagged with the parent phase
  - docs/phases-5-6-6b-research.md (locked decisions + open questions)
- **Risk flags:**
  - **Approval contract** — New activity must be added to activity_policies + audited
  - **Schema migration** — Backwards-compat, RLS on new table, realtime publication
  - **Vendor coupling** — Pin upstream version; document break-glass
- **Verify before approve:**
  - [ ] Acceptance line met: _Operator approves jsonpath map; subsequent feeds promote silently._
  - [ ] Migration (if any) leaves RLS enabled and realtime publication updated
  - [ ] No new secret printed in logs or stored in plaintext
  - [ ] New events flow through `*_events` table and are visible in /db-explorer
  - [ ] Idempotency-Key replay returns identical response (writes only)
  - [ ] Roadmap task moves to `done` only when CHANGELOG entry + docs reference exist

#### s6.2.t4 — BMS/IoT batch adapter

- **Module:** ingest
- **Depends on:** `s6.2.t1`
- **Description:** BACnet/Modbus/MQTT capture stub; payload normalisation skill.
- **Acceptance:** Synthetic Modbus batch lands in raw_records with unit normalisation.
- **Research sources:**
  - Notebook entries tagged with the parent phase
  - docs/phases-5-6-6b-research.md (locked decisions + open questions)
- **Risk flags:**
  - **Vendor coupling** — Pin upstream version; document break-glass
- **Verify before approve:**
  - [ ] Acceptance line met: _Synthetic Modbus batch lands in raw_records with unit normalisation._
  - [ ] Migration (if any) leaves RLS enabled and realtime publication updated
  - [ ] No new secret printed in logs or stored in plaintext
  - [ ] New events flow through `*_events` table and are visible in /db-explorer
  - [ ] Idempotency-Key replay returns identical response (writes only)
  - [ ] Roadmap task moves to `done` only when CHANGELOG entry + docs reference exist

#### s6.2.t5 — Lease PDF adapter (Gemini 2.5 Pro vision)

- **Module:** ingest
- **Depends on:** `s6.2.t1`
- **Description:** Layout-aware extraction, table + signature capture, cost ceiling (degrade to 2.5 Flash above N pages).
- **Acceptance:** Sample lease produces structured staged_records; cost ceiling triggers downgrade in test.
- **Research sources:**
  - Notebook entries tagged with the parent phase
  - docs/phases-5-6-6b-research.md (locked decisions + open questions)
  - Lovable AI Gateway model catalogue
- **Risk flags:**
  - **LLM cost/quality** — Token budget, fallback model, eval on golden set
  - **Schema migration** — Backwards-compat, RLS on new table, realtime publication
  - **Vendor coupling** — Pin upstream version; document break-glass
- **Verify before approve:**
  - [ ] Acceptance line met: _Sample lease produces structured staged_records; cost ceiling triggers downgrade in test._
  - [ ] Migration (if any) leaves RLS enabled and realtime publication updated
  - [ ] No new secret printed in logs or stored in plaintext
  - [ ] New events flow through `*_events` table and are visible in /db-explorer
  - [ ] Idempotency-Key replay returns identical response (writes only)
  - [ ] Roadmap task moves to `done` only when CHANGELOG entry + docs reference exist

#### s6.2.t6 — Email adapter (inbound webhook)

- **Module:** ingest
- **Depends on:** `s6.2.t1`
- **Description:** Postmark/SES inbound, thread reconstruction, attachment fan-out into the same ingest_run.
- **Acceptance:** Threaded email with 2 attachments creates one ingest_run with 3 raw_records.
- **Research sources:**
  - Notebook entries tagged with the parent phase
  - docs/phases-5-6-6b-research.md (locked decisions + open questions)
  - docs/api.md webhook section (to author)
- **Risk flags:**
  - **Vendor coupling** — Pin upstream version; document break-glass
- **Verify before approve:**
  - [ ] Acceptance line met: _Threaded email with 2 attachments creates one ingest_run with 3 raw_records._
  - [ ] Migration (if any) leaves RLS enabled and realtime publication updated
  - [ ] No new secret printed in logs or stored in plaintext
  - [ ] New events flow through `*_events` table and are visible in /db-explorer
  - [ ] Idempotency-Key replay returns identical response (writes only)
  - [ ] Roadmap task moves to `done` only when CHANGELOG entry + docs reference exist

#### s6.2.t7 — Telegram voice -> ingest_run bridge

- **Module:** ingest
- **Depends on:** `s6.2.t1`
- **Description:** Reuse existing transcription, route to intent classifier instead of approval queue.
- **Acceptance:** Voice note about a new asset alias creates an alias_create approval.
- **Research sources:**
  - Notebook entries tagged with the parent phase
  - docs/phases-5-6-6b-research.md (locked decisions + open questions)
- **Risk flags:**
  - **Approval contract** — New activity must be added to activity_policies + audited
- **Verify before approve:**
  - [ ] Acceptance line met: _Voice note about a new asset alias creates an alias_create approval._
  - [ ] Migration (if any) leaves RLS enabled and realtime publication updated
  - [ ] No new secret printed in logs or stored in plaintext
  - [ ] New events flow through `*_events` table and are visible in /db-explorer
  - [ ] Idempotency-Key replay returns identical response (writes only)
  - [ ] Roadmap task moves to `done` only when CHANGELOG entry + docs reference exist


### s6.3 — Conflict layer

> Goal: fact_conflicts, per-type tolerances, declarative conflict_rules, bulk patterns, retroactive corrections.

#### s6.3.t1 — fact_conflicts table

- **Module:** ingest
- **Depends on:** `s6.1.t3`
- **Description:** Existing vs incoming, materiality, tolerance breach reason.
- **Acceptance:** Incoming row that breaches tolerance lands in fact_conflicts, not canonical.
- **Research sources:**
  - Notebook entries tagged with the parent phase
  - docs/phases-5-6-6b-research.md (locked decisions + open questions)
- **Risk flags:**
  - **Schema migration** — Backwards-compat, RLS on new table, realtime publication
  - **Data integrity** — Append-only; never silent overwrite; audit diff
- **Verify before approve:**
  - [ ] Acceptance line met: _Incoming row that breaches tolerance lands in fact_conflicts, not canonical._
  - [ ] Migration (if any) leaves RLS enabled and realtime publication updated
  - [ ] No new secret printed in logs or stored in plaintext
  - [ ] New events flow through `*_events` table and are visible in /db-explorer
  - [ ] Idempotency-Key replay returns identical response (writes only)
  - [ ] Roadmap task moves to `done` only when CHANGELOG entry + docs reference exist

#### s6.3.t2 — Per-fact-type tolerance config

- **Module:** ingest
- **Depends on:** `s6.3.t1`
- **Description:** Declared on canonical schema, overridable per tenant_node.
- **Acceptance:** Financial type tolerance 0.001; sensor type 0.05; override per tenant_node respected.
- **Research sources:**
  - Notebook entries tagged with the parent phase
  - docs/phases-5-6-6b-research.md (locked decisions + open questions)
- **Risk flags:**
  - **Security/isolation** — Cross-tenant leak or RLS bypass
  - **Schema migration** — Backwards-compat, RLS on new table, realtime publication
  - **Data integrity** — Append-only; never silent overwrite; audit diff
- **Verify before approve:**
  - [ ] Acceptance line met: _Financial type tolerance 0.001; sensor type 0.05; override per tenant_node respected._
  - [ ] Migration (if any) leaves RLS enabled and realtime publication updated
  - [ ] No new secret printed in logs or stored in plaintext
  - [ ] New events flow through `*_events` table and are visible in /db-explorer
  - [ ] Idempotency-Key replay returns identical response (writes only)
  - [ ] Roadmap task moves to `done` only when CHANGELOG entry + docs reference exist

#### s6.3.t3 — conflict_rules table (declarative precedence)

- **Module:** ingest
- **Depends on:** `s6.3.t1`
- **Description:** Versioned, revocable, emits event each fire. e.g. audit PDF wins over BMS for quarterly close.
- **Acceptance:** Rule fire creates ingest_event with old->new diff.
- **Research sources:**
  - Notebook entries tagged with the parent phase
  - docs/phases-5-6-6b-research.md (locked decisions + open questions)
- **Risk flags:**
  - **Schema migration** — Backwards-compat, RLS on new table, realtime publication
  - **Data integrity** — Append-only; never silent overwrite; audit diff
- **Verify before approve:**
  - [ ] Acceptance line met: _Rule fire creates ingest_event with old->new diff._
  - [ ] Migration (if any) leaves RLS enabled and realtime publication updated
  - [ ] No new secret printed in logs or stored in plaintext
  - [ ] New events flow through `*_events` table and are visible in /db-explorer
  - [ ] Idempotency-Key replay returns identical response (writes only)
  - [ ] Roadmap task moves to `done` only when CHANGELOG entry + docs reference exist

#### s6.3.t4 — Conflict resolution approval activity

- **Module:** ingest
- **Depends on:** `s6.3.t1`, `s6.3.t3`
- **Description:** fact_conflict_resolution added to activity_policies; supersede / reject / split / quarantine actions.
- **Acceptance:** Each action recorded as a distinct event; rejection requires reason.
- **Research sources:**
  - Notebook entries tagged with the parent phase
  - docs/phases-5-6-6b-research.md (locked decisions + open questions)
- **Risk flags:**
  - **Approval contract** — New activity must be added to activity_policies + audited
  - **Operator UX** — Realtime subscription + empty/loading/error states
  - **Data integrity** — Append-only; never silent overwrite; audit diff
- **Verify before approve:**
  - [ ] Acceptance line met: _Each action recorded as a distinct event; rejection requires reason._
  - [ ] Migration (if any) leaves RLS enabled and realtime publication updated
  - [ ] No new secret printed in logs or stored in plaintext
  - [ ] New events flow through `*_events` table and are visible in /db-explorer
  - [ ] Idempotency-Key replay returns identical response (writes only)
  - [ ] Roadmap task moves to `done` only when CHANGELOG entry + docs reference exist

#### s6.3.t5 — Bulk conflict pattern detection (ADR-0005)

- **Module:** ingest
- **Depends on:** `s6.3.t1`
- **Description:** Group by source_mapping + diff signature; one-click accept pattern with operator review of N samples.
- **Acceptance:** 400-row pattern resolves in one click after N=5 sample approval; ADR-0005 merged.
- **Research sources:**
  - Notebook entries tagged with the parent phase
  - docs/phases-5-6-6b-research.md (locked decisions + open questions)
- **Risk flags:**
  - **Approval contract** — New activity must be added to activity_policies + audited
  - **Data integrity** — Append-only; never silent overwrite; audit diff
- **Verify before approve:**
  - [ ] Acceptance line met: _400-row pattern resolves in one click after N=5 sample approval; ADR-0005 merged._
  - [ ] Migration (if any) leaves RLS enabled and realtime publication updated
  - [ ] No new secret printed in logs or stored in plaintext
  - [ ] New events flow through `*_events` table and are visible in /db-explorer
  - [ ] Idempotency-Key replay returns identical response (writes only)
  - [ ] Roadmap task moves to `done` only when CHANGELOG entry + docs reference exist

#### s6.3.t6 — Retroactive correction policy

- **Module:** ingest
- **Depends on:** `s6.3.t1`
- **Description:** Closed periods immutable; corrections create v+1 + restate approval kind. SECR/CSRD restatement notes captured.
- **Acceptance:** Correcting a closed Q3 number requires restate approval and fans out an event.
- **Research sources:**
  - Notebook entries tagged with the parent phase
  - docs/phases-5-6-6b-research.md (locked decisions + open questions)
  - CSRD disclosure requirements
  - SECR reporting framework
- **Risk flags:**
  - **Approval contract** — New activity must be added to activity_policies + audited
  - **Schema migration** — Backwards-compat, RLS on new table, realtime publication
  - **Operator UX** — Realtime subscription + empty/loading/error states
  - **Data integrity** — Append-only; never silent overwrite; audit diff
- **Verify before approve:**
  - [ ] Acceptance line met: _Correcting a closed Q3 number requires restate approval and fans out an event._
  - [ ] Migration (if any) leaves RLS enabled and realtime publication updated
  - [ ] No new secret printed in logs or stored in plaintext
  - [ ] New events flow through `*_events` table and are visible in /db-explorer
  - [ ] Idempotency-Key replay returns identical response (writes only)
  - [ ] Roadmap task moves to `done` only when CHANGELOG entry + docs reference exist

#### s6.3.t7 — Rule learning loop (deferred flag)

- **Module:** ingest
- **Depends on:** `s6.3.t3`
- **Description:** Log 5 consistent decisions candidates; do not auto-create rules yet, surface on admin.
- **Acceptance:** Admin page shows candidate rule with provenance; no auto-creation.
- **Research sources:**
  - Notebook entries tagged with the parent phase
  - docs/phases-5-6-6b-research.md (locked decisions + open questions)
- **Risk flags:**
  - **Scope creep** — Verify acceptance line is the only outcome shipped
- **Verify before approve:**
  - [ ] Acceptance line met: _Admin page shows candidate rule with provenance; no auto-creation._
  - [ ] Migration (if any) leaves RLS enabled and realtime publication updated
  - [ ] No new secret printed in logs or stored in plaintext
  - [ ] New events flow through `*_events` table and are visible in /db-explorer
  - [ ] Idempotency-Key replay returns identical response (writes only)
  - [ ] Roadmap task moves to `done` only when CHANGELOG entry + docs reference exist


### s6.4 — PII, lawful basis, DSAR

> Goal: Tag PII at raw, lawful basis registry, DSAR traversal, retention per source.

#### s6.4.t1 — PII tagging at raw_records

- **Module:** core
- **Depends on:** `s6.1.t1`
- **Description:** pii_classes text[] populated by source connector manifest; required before promotion of fields touching PII.
- **Acceptance:** Connector emitting pii_classes=[email] tags rows; promotion blocks without lawful basis.
- **Research sources:**
  - Notebook entries tagged with the parent phase
  - docs/phases-5-6-6b-research.md (locked decisions + open questions)
  - UK GDPR special-category guidance
- **Risk flags:**
  - **Privacy/GDPR** — PII handling, lawful basis, erasure traversal
  - **Vendor coupling** — Pin upstream version; document break-glass
  - **Operator UX** — Realtime subscription + empty/loading/error states
- **Verify before approve:**
  - [ ] Acceptance line met: _Connector emitting pii_classes=[email] tags rows; promotion blocks without lawful basis._
  - [ ] Migration (if any) leaves RLS enabled and realtime publication updated
  - [ ] No new secret printed in logs or stored in plaintext
  - [ ] New events flow through `*_events` table and are visible in /db-explorer
  - [ ] Idempotency-Key replay returns identical response (writes only)
  - [ ] Roadmap task moves to `done` only when CHANGELOG entry + docs reference exist

#### s6.4.t2 — Lawful basis registry

- **Module:** core
- **Depends on:** —
- **Description:** Declared at connector setup AND optionally per ingest_run; blocks promotion otherwise.
- **Acceptance:** Setup without lawful basis fails; per-run override recorded in ingest_event.
- **Research sources:**
  - Notebook entries tagged with the parent phase
  - docs/phases-5-6-6b-research.md (locked decisions + open questions)
- **Risk flags:**
  - **Privacy/GDPR** — PII handling, lawful basis, erasure traversal
  - **Vendor coupling** — Pin upstream version; document break-glass
- **Verify before approve:**
  - [ ] Acceptance line met: _Setup without lawful basis fails; per-run override recorded in ingest_event._
  - [ ] Migration (if any) leaves RLS enabled and realtime publication updated
  - [ ] No new secret printed in logs or stored in plaintext
  - [ ] New events flow through `*_events` table and are visible in /db-explorer
  - [ ] Idempotency-Key replay returns identical response (writes only)
  - [ ] Roadmap task moves to `done` only when CHANGELOG entry + docs reference exist

#### s6.4.t3 — DSAR erasure traversal

- **Module:** core
- **Depends on:** `s5.1.t3`, `s6.4.t1`, `s6.4.t2`
- **Description:** Function walks raw_records -> staged -> canonical_facts -> document_chunks -> embeddings; tombstones, never hard-deletes audit rows.
- **Acceptance:** DSAR for a synthetic subject removes all PII rows and leaves audit tombstones.
- **Research sources:**
  - Notebook entries tagged with the parent phase
  - docs/phases-5-6-6b-research.md (locked decisions + open questions)
  - UK GDPR DSAR (article 15)
  - Embedding model benchmarks
- **Risk flags:**
  - **Privacy/GDPR** — PII handling, lawful basis, erasure traversal
  - **LLM cost/quality** — Token budget, fallback model, eval on golden set
- **Verify before approve:**
  - [ ] Acceptance line met: _DSAR for a synthetic subject removes all PII rows and leaves audit tombstones._
  - [ ] Migration (if any) leaves RLS enabled and realtime publication updated
  - [ ] No new secret printed in logs or stored in plaintext
  - [ ] New events flow through `*_events` table and are visible in /db-explorer
  - [ ] Idempotency-Key replay returns identical response (writes only)
  - [ ] Roadmap task moves to `done` only when CHANGELOG entry + docs reference exist

#### s6.4.t4 — Right to rectification flow

- **Module:** core
- **Depends on:** `s6.4.t3`
- **Description:** Append correction event + replay; never mutate.
- **Acceptance:** Rectification creates supersede event, original row preserved.
- **Research sources:**
  - Notebook entries tagged with the parent phase
  - docs/phases-5-6-6b-research.md (locked decisions + open questions)
- **Risk flags:**
  - **Privacy/GDPR** — PII handling, lawful basis, erasure traversal
  - **Data integrity** — Append-only; never silent overwrite; audit diff
- **Verify before approve:**
  - [ ] Acceptance line met: _Rectification creates supersede event, original row preserved._
  - [ ] Migration (if any) leaves RLS enabled and realtime publication updated
  - [ ] No new secret printed in logs or stored in plaintext
  - [ ] New events flow through `*_events` table and are visible in /db-explorer
  - [ ] Idempotency-Key replay returns identical response (writes only)
  - [ ] Roadmap task moves to `done` only when CHANGELOG entry + docs reference exist

#### s6.4.t5 — Per-source raw_records retention

- **Module:** core
- **Depends on:** `s6.4.t1`
- **Description:** Extends retention_settings with source_id; nightly purge job logs to automation_runs.
- **Acceptance:** 30/90/365-day per-source overrides honoured by nightly purge.
- **Research sources:**
  - Notebook entries tagged with the parent phase
  - docs/phases-5-6-6b-research.md (locked decisions + open questions)
- **Risk flags:**
  - **Privacy/GDPR** — PII handling, lawful basis, erasure traversal
- **Verify before approve:**
  - [ ] Acceptance line met: _30/90/365-day per-source overrides honoured by nightly purge._
  - [ ] Migration (if any) leaves RLS enabled and realtime publication updated
  - [ ] No new secret printed in logs or stored in plaintext
  - [ ] New events flow through `*_events` table and are visible in /db-explorer
  - [ ] Idempotency-Key replay returns identical response (writes only)
  - [ ] Roadmap task moves to `done` only when CHANGELOG entry + docs reference exist

#### s6.4.t6 — Column-level redaction policy

- **Module:** core
- **Depends on:** `s6.4.t1`
- **Description:** RLS + redaction view; pgcrypto deferred unless residency demands it.
- **Acceptance:** Non-operator role reads redacted view; operator reads raw; visible in security audit.
- **Research sources:**
  - Notebook entries tagged with the parent phase
  - docs/phases-5-6-6b-research.md (locked decisions + open questions)
- **Risk flags:**
  - **Security/isolation** — Cross-tenant leak or RLS bypass
  - **Privacy/GDPR** — PII handling, lawful basis, erasure traversal
- **Verify before approve:**
  - [ ] Acceptance line met: _Non-operator role reads redacted view; operator reads raw; visible in security audit._
  - [ ] Migration (if any) leaves RLS enabled and realtime publication updated
  - [ ] No new secret printed in logs or stored in plaintext
  - [ ] New events flow through `*_events` table and are visible in /db-explorer
  - [ ] Idempotency-Key replay returns identical response (writes only)
  - [ ] Roadmap task moves to `done` only when CHANGELOG entry + docs reference exist


### s6.5 — RAG / unstructured

> Goal: document_chunks + pgvector, embedding model decision, chunk strategies, hybrid search.

#### s6.5.t1 — document_chunks + embeddings tables

- **Module:** ingest
- **Depends on:** `s6.1.t3`
- **Description:** pgvector, model_id, chunk_strategy, source_record_id.
- **Acceptance:** Inserting a chunk computes embedding via Lovable AI Gateway and indexes it.
- **Research sources:**
  - Notebook entries tagged with the parent phase
  - docs/phases-5-6-6b-research.md (locked decisions + open questions)
  - pgvector docs (hnsw vs ivfflat)
  - Embedding model benchmarks
- **Risk flags:**
  - **LLM cost/quality** — Token budget, fallback model, eval on golden set
  - **Schema migration** — Backwards-compat, RLS on new table, realtime publication
- **Verify before approve:**
  - [ ] Acceptance line met: _Inserting a chunk computes embedding via Lovable AI Gateway and indexes it._
  - [ ] Migration (if any) leaves RLS enabled and realtime publication updated
  - [ ] No new secret printed in logs or stored in plaintext
  - [ ] New events flow through `*_events` table and are visible in /db-explorer
  - [ ] Idempotency-Key replay returns identical response (writes only)
  - [ ] Roadmap task moves to `done` only when CHANGELOG entry + docs reference exist

#### s6.5.t2 — Embedding model decision (ADR-0006)

- **Module:** ingest
- **Depends on:** —
- **Description:** Gemini text-embedding-004 default; ADR covers cost vs residency vs re-embed pain.
- **Acceptance:** ADR-0006 merged; default model wired into chunker.
- **Research sources:**
  - Notebook entries tagged with the parent phase
  - docs/phases-5-6-6b-research.md (locked decisions + open questions)
  - Embedding model benchmarks
  - Lovable AI Gateway model catalogue
  - docs/adr/0006-embedding-model.md (to draft)
- **Risk flags:**
  - **Security/isolation** — Cross-tenant leak or RLS bypass
  - **LLM cost/quality** — Token budget, fallback model, eval on golden set
- **Verify before approve:**
  - [ ] Acceptance line met: _ADR-0006 merged; default model wired into chunker._
  - [ ] Migration (if any) leaves RLS enabled and realtime publication updated
  - [ ] No new secret printed in logs or stored in plaintext
  - [ ] New events flow through `*_events` table and are visible in /db-explorer
  - [ ] Idempotency-Key replay returns identical response (writes only)
  - [ ] Roadmap task moves to `done` only when CHANGELOG entry + docs reference exist

#### s6.5.t3 — Chunk strategies per source type

- **Module:** ingest
- **Depends on:** `s6.5.t1`
- **Description:** Lease PDF semantic sections, SFG20 one-per-task, email thread-aware, voice utterance.
- **Acceptance:** Per-source-type chunker selected automatically; visible in chunk metadata.
- **Research sources:**
  - Notebook entries tagged with the parent phase
  - docs/phases-5-6-6b-research.md (locked decisions + open questions)
  - SFG20 task code spec (licence terms)
- **Risk flags:**
  - **Scope creep** — Verify acceptance line is the only outcome shipped
- **Verify before approve:**
  - [ ] Acceptance line met: _Per-source-type chunker selected automatically; visible in chunk metadata._
  - [ ] Migration (if any) leaves RLS enabled and realtime publication updated
  - [ ] No new secret printed in logs or stored in plaintext
  - [ ] New events flow through `*_events` table and are visible in /db-explorer
  - [ ] Idempotency-Key replay returns identical response (writes only)
  - [ ] Roadmap task moves to `done` only when CHANGELOG entry + docs reference exist

#### s6.5.t4 — Hybrid search (FTS + vector)

- **Module:** ingest
- **Depends on:** `s6.5.t1`, `s6.5.t3`
- **Description:** Postgres FTS for asset codes / SFG20 references, pgvector for semantic. Single SQL function hybrid_search().
- **Acceptance:** Search for an asset code + semantic phrase returns merged ranked list.
- **Research sources:**
  - Notebook entries tagged with the parent phase
  - docs/phases-5-6-6b-research.md (locked decisions + open questions)
  - SFG20 task code spec (licence terms)
  - pgvector docs (hnsw vs ivfflat)
- **Risk flags:**
  - **LLM cost/quality** — Token budget, fallback model, eval on golden set
- **Verify before approve:**
  - [ ] Acceptance line met: _Search for an asset code + semantic phrase returns merged ranked list._
  - [ ] Migration (if any) leaves RLS enabled and realtime publication updated
  - [ ] No new secret printed in logs or stored in plaintext
  - [ ] New events flow through `*_events` table and are visible in /db-explorer
  - [ ] Idempotency-Key replay returns identical response (writes only)
  - [ ] Roadmap task moves to `done` only when CHANGELOG entry + docs reference exist

#### s6.5.t5 — Index choice

- **Module:** ingest
- **Depends on:** `s6.5.t1`
- **Description:** hnsw default; ivfflat for very large per-tenant corpora. Decision recorded per index.
- **Acceptance:** Index choice + reasoning recorded in ingest notes.
- **Research sources:**
  - Notebook entries tagged with the parent phase
  - docs/phases-5-6-6b-research.md (locked decisions + open questions)
- **Risk flags:**
  - **Security/isolation** — Cross-tenant leak or RLS bypass
  - **Schema migration** — Backwards-compat, RLS on new table, realtime publication
- **Verify before approve:**
  - [ ] Acceptance line met: _Index choice + reasoning recorded in ingest notes._
  - [ ] Migration (if any) leaves RLS enabled and realtime publication updated
  - [ ] No new secret printed in logs or stored in plaintext
  - [ ] New events flow through `*_events` table and are visible in /db-explorer
  - [ ] Idempotency-Key replay returns identical response (writes only)
  - [ ] Roadmap task moves to `done` only when CHANGELOG entry + docs reference exist

#### s6.5.t6 — Re-embed strategy

- **Module:** ingest
- **Depends on:** `s6.5.t2`, `s6.5.t3`
- **Description:** Lazy-on-read marker + nightly chunked rebuild; never block reads.
- **Acceptance:** Model swap test: old embeddings still queryable; nightly rebuild progresses incrementally.
- **Research sources:**
  - Notebook entries tagged with the parent phase
  - docs/phases-5-6-6b-research.md (locked decisions + open questions)
- **Risk flags:**
  - **LLM cost/quality** — Token budget, fallback model, eval on golden set
  - **Operator UX** — Realtime subscription + empty/loading/error states
- **Verify before approve:**
  - [ ] Acceptance line met: _Model swap test: old embeddings still queryable; nightly rebuild progresses incrementally._
  - [ ] Migration (if any) leaves RLS enabled and realtime publication updated
  - [ ] No new secret printed in logs or stored in plaintext
  - [ ] New events flow through `*_events` table and are visible in /db-explorer
  - [ ] Idempotency-Key replay returns identical response (writes only)
  - [ ] Roadmap task moves to `done` only when CHANGELOG entry + docs reference exist


### s6.6 — Compliance hooks

> Goal: SFG20 normaliser, BIM ISO 19650 references, Cyber Essentials audit, SECR/CSRD provenance.

#### s6.6.t1 — SFG20 task code normaliser skill

- **Module:** compliance
- **Depends on:** `s6.1.t3`
- **Description:** Accepts client-mapped codes, maps to canonical task taxonomy.
- **Acceptance:** Mapping uplift covers >=90% of sample task codes; unmapped go to quarantine.
- **Research sources:**
  - Notebook entries tagged with the parent phase
  - docs/phases-5-6-6b-research.md (locked decisions + open questions)
  - SFG20 task code spec (licence terms)
- **Risk flags:**
  - **Scope creep** — Verify acceptance line is the only outcome shipped
- **Verify before approve:**
  - [ ] Acceptance line met: _Mapping uplift covers >=90% of sample task codes; unmapped go to quarantine._
  - [ ] Migration (if any) leaves RLS enabled and realtime publication updated
  - [ ] No new secret printed in logs or stored in plaintext
  - [ ] New events flow through `*_events` table and are visible in /db-explorer
  - [ ] Idempotency-Key replay returns identical response (writes only)
  - [ ] Roadmap task moves to `done` only when CHANGELOG entry + docs reference exist

#### s6.6.t2 — BIM ISO 19650 CDE references

- **Module:** compliance
- **Depends on:** `s5.1.t4`
- **Description:** Store CDE URL + asset GUID on tenant_node.authoritative_ids.
- **Acceptance:** BIM GUID resolves via authoritative path; CDE link visible on /entities.
- **Research sources:**
  - Notebook entries tagged with the parent phase
  - docs/phases-5-6-6b-research.md (locked decisions + open questions)
  - ISO 19650 CDE reference model
  - buildingSMART IFC GUID spec
- **Risk flags:**
  - **Security/isolation** — Cross-tenant leak or RLS bypass
  - **Operator UX** — Realtime subscription + empty/loading/error states
- **Verify before approve:**
  - [ ] Acceptance line met: _BIM GUID resolves via authoritative path; CDE link visible on /entities._
  - [ ] Migration (if any) leaves RLS enabled and realtime publication updated
  - [ ] No new secret printed in logs or stored in plaintext
  - [ ] New events flow through `*_events` table and are visible in /db-explorer
  - [ ] Idempotency-Key replay returns identical response (writes only)
  - [ ] Roadmap task moves to `done` only when CHANGELOG entry + docs reference exist

#### s6.6.t3 — Cyber Essentials Plus connector audit

- **Module:** compliance
- **Depends on:** —
- **Description:** Every secret read logged to connector_audit_log.
- **Acceptance:** Secret read by edge function produces audit row; non-operator cannot select log.
- **Research sources:**
  - Notebook entries tagged with the parent phase
  - docs/phases-5-6-6b-research.md (locked decisions + open questions)
  - SECR reporting framework
  - Cyber Essentials Plus controls
- **Risk flags:**
  - **Secrets handling** — No plaintext secrets in logs/raw_records; rotation path
  - **Vendor coupling** — Pin upstream version; document break-glass
- **Verify before approve:**
  - [ ] Acceptance line met: _Secret read by edge function produces audit row; non-operator cannot select log._
  - [ ] Migration (if any) leaves RLS enabled and realtime publication updated
  - [ ] No new secret printed in logs or stored in plaintext
  - [ ] New events flow through `*_events` table and are visible in /db-explorer
  - [ ] Idempotency-Key replay returns identical response (writes only)
  - [ ] Roadmap task moves to `done` only when CHANGELOG entry + docs reference exist

#### s6.6.t4 — Audit pack export

- **Module:** compliance
- **Depends on:** `s6.1.t5`
- **Description:** On-demand zip of approvals, RLS map, resolver decisions for an evidence window.
- **Acceptance:** Export for a 30-day window returns a downloadable artefact; reuses db-explorer audit.
- **Research sources:**
  - Notebook entries tagged with the parent phase
  - docs/phases-5-6-6b-research.md (locked decisions + open questions)
- **Risk flags:**
  - **Security/isolation** — Cross-tenant leak or RLS bypass
  - **Approval contract** — New activity must be added to activity_policies + audited
- **Verify before approve:**
  - [ ] Acceptance line met: _Export for a 30-day window returns a downloadable artefact; reuses db-explorer audit._
  - [ ] Migration (if any) leaves RLS enabled and realtime publication updated
  - [ ] No new secret printed in logs or stored in plaintext
  - [ ] New events flow through `*_events` table and are visible in /db-explorer
  - [ ] Idempotency-Key replay returns identical response (writes only)
  - [ ] Roadmap task moves to `done` only when CHANGELOG entry + docs reference exist

#### s6.6.t5 — SECR/CSRD/SBTi emission factor capture

- **Module:** compliance
- **Depends on:** `s6.1.t3`
- **Description:** DEFRA year, scope, source URL on every emissions canonical row; validation trigger blocks unsourced rows.
- **Acceptance:** Emission row missing source URL fails validation in CI test.
- **Research sources:**
  - Notebook entries tagged with the parent phase
  - docs/phases-5-6-6b-research.md (locked decisions + open questions)
  - CSRD disclosure requirements
  - SECR reporting framework
  - SBTi target methodology
- **Risk flags:**
  - **Scope creep** — Verify acceptance line is the only outcome shipped
- **Verify before approve:**
  - [ ] Acceptance line met: _Emission row missing source URL fails validation in CI test._
  - [ ] Migration (if any) leaves RLS enabled and realtime publication updated
  - [ ] No new secret printed in logs or stored in plaintext
  - [ ] New events flow through `*_events` table and are visible in /db-explorer
  - [ ] Idempotency-Key replay returns identical response (writes only)
  - [ ] Roadmap task moves to `done` only when CHANGELOG entry + docs reference exist


## Ingest Observability (`phase-6b`)


### s6b.1 — Conflict review surface

> Goal: Operator UI for unresolved conflicts + replay.

#### s6b.1.t1 — /ingest dashboard skeleton

- **Module:** operator_console
- **Depends on:** `s6.1.t5`
- **Description:** Per-source counts: incoming, staged, quarantined, conflict, promoted (24h / 7d).
- **Acceptance:** Cards render with realtime updates; zero polling.
- **Research sources:**
  - Notebook entries tagged with the parent phase
  - docs/phases-5-6-6b-research.md (locked decisions + open questions)
- **Risk flags:**
  - **Operator UX** — Realtime subscription + empty/loading/error states
  - **Data integrity** — Append-only; never silent overwrite; audit diff
- **Verify before approve:**
  - [ ] Acceptance line met: _Cards render with realtime updates; zero polling._
  - [ ] Migration (if any) leaves RLS enabled and realtime publication updated
  - [ ] No new secret printed in logs or stored in plaintext
  - [ ] New events flow through `*_events` table and are visible in /db-explorer
  - [ ] Idempotency-Key replay returns identical response (writes only)
  - [ ] Roadmap task moves to `done` only when CHANGELOG entry + docs reference exist

#### s6b.1.t2 — Conflict card UI (one-row)

- **Module:** operator_console
- **Depends on:** `s6.3.t1`, `s6b.1.t1`
- **Description:** Side-by-side existing vs incoming, source provenance, decision actions.
- **Acceptance:** Decision posts to approval_queue and updates fact_conflicts within one realtime tick.
- **Research sources:**
  - Notebook entries tagged with the parent phase
  - docs/phases-5-6-6b-research.md (locked decisions + open questions)
- **Risk flags:**
  - **Approval contract** — New activity must be added to activity_policies + audited
  - **Operator UX** — Realtime subscription + empty/loading/error states
  - **Data integrity** — Append-only; never silent overwrite; audit diff
- **Verify before approve:**
  - [ ] Acceptance line met: _Decision posts to approval_queue and updates fact_conflicts within one realtime tick._
  - [ ] Migration (if any) leaves RLS enabled and realtime publication updated
  - [ ] No new secret printed in logs or stored in plaintext
  - [ ] New events flow through `*_events` table and are visible in /db-explorer
  - [ ] Idempotency-Key replay returns identical response (writes only)
  - [ ] Roadmap task moves to `done` only when CHANGELOG entry + docs reference exist

#### s6b.1.t3 — Bulk pattern card

- **Module:** operator_console
- **Depends on:** `s6.3.t5`, `s6b.1.t1`
- **Description:** Surfaces detected pattern from s6.3 t5; sample rows + accept-all.
- **Acceptance:** Accepting pattern resolves all matching conflicts and emits one ingest_event.
- **Research sources:**
  - Notebook entries tagged with the parent phase
  - docs/phases-5-6-6b-research.md (locked decisions + open questions)
  - docs/adr/0005-bulk-conflict-patterns.md (to draft)
- **Risk flags:**
  - **Data integrity** — Append-only; never silent overwrite; audit diff
- **Verify before approve:**
  - [ ] Acceptance line met: _Accepting pattern resolves all matching conflicts and emits one ingest_event._
  - [ ] Migration (if any) leaves RLS enabled and realtime publication updated
  - [ ] No new secret printed in logs or stored in plaintext
  - [ ] New events flow through `*_events` table and are visible in /db-explorer
  - [ ] Idempotency-Key replay returns identical response (writes only)
  - [ ] Roadmap task moves to `done` only when CHANGELOG entry + docs reference exist

#### s6b.1.t4 — Quarantine inbox

- **Module:** operator_console
- **Depends on:** `s6.1.t2`, `s6b.1.t1`
- **Description:** Per-source queue, bulk-fix patterns, SLA badge.
- **Acceptance:** Bulk-fix "infer postcode from site_id" releases matched rows; SLA badge turns red after threshold.
- **Research sources:**
  - Notebook entries tagged with the parent phase
  - docs/phases-5-6-6b-research.md (locked decisions + open questions)
- **Risk flags:**
  - **Scope creep** — Verify acceptance line is the only outcome shipped
- **Verify before approve:**
  - [ ] Acceptance line met: _Bulk-fix "infer postcode from site_id" releases matched rows; SLA badge turns red after threshold._
  - [ ] Migration (if any) leaves RLS enabled and realtime publication updated
  - [ ] No new secret printed in logs or stored in plaintext
  - [ ] New events flow through `*_events` table and are visible in /db-explorer
  - [ ] Idempotency-Key replay returns identical response (writes only)
  - [ ] Roadmap task moves to `done` only when CHANGELOG entry + docs reference exist

#### s6b.1.t5 — Replay control

- **Module:** operator_console
- **Depends on:** `s6.1.t1`, `s6b.1.t1`
- **Description:** Replay an ingest_run from raw_records with current source_mapping; diff vs previous outcome.
- **Acceptance:** Replay produces diff view; zero side effects until operator confirms.
- **Research sources:**
  - Notebook entries tagged with the parent phase
  - docs/phases-5-6-6b-research.md (locked decisions + open questions)
- **Risk flags:**
  - **Scope creep** — Verify acceptance line is the only outcome shipped
- **Verify before approve:**
  - [ ] Acceptance line met: _Replay produces diff view; zero side effects until operator confirms._
  - [ ] Migration (if any) leaves RLS enabled and realtime publication updated
  - [ ] No new secret printed in logs or stored in plaintext
  - [ ] New events flow through `*_events` table and are visible in /db-explorer
  - [ ] Idempotency-Key replay returns identical response (writes only)
  - [ ] Roadmap task moves to `done` only when CHANGELOG entry + docs reference exist


### s6b.2 — Resolver + alias UX

> Goal: /entities tree, alias review queue, bulk re-resolve, resolver decision detail.

#### s6b.2.t1 — /entities page

- **Module:** operator_console
- **Depends on:** `s5.1.t1`, `s5.2.t5`
- **Description:** Tenant_node tree with alias counts, authoritative IDs, last-seen sources.
- **Acceptance:** Tree to depth 6 renders <500ms on 10k nodes.
- **Research sources:**
  - Notebook entries tagged with the parent phase
  - docs/phases-5-6-6b-research.md (locked decisions + open questions)
- **Risk flags:**
  - **Security/isolation** — Cross-tenant leak or RLS bypass
  - **Operator UX** — Realtime subscription + empty/loading/error states
- **Verify before approve:**
  - [ ] Acceptance line met: _Tree to depth 6 renders <500ms on 10k nodes._
  - [ ] Migration (if any) leaves RLS enabled and realtime publication updated
  - [ ] No new secret printed in logs or stored in plaintext
  - [ ] New events flow through `*_events` table and are visible in /db-explorer
  - [ ] Idempotency-Key replay returns identical response (writes only)
  - [ ] Roadmap task moves to `done` only when CHANGELOG entry + docs reference exist

#### s6b.2.t2 — Alias review queue

- **Module:** operator_console
- **Depends on:** `s5.3.t1`, `s6b.2.t1`
- **Description:** Fuzzy-match proposals with score breakdown; one click binds batch.
- **Acceptance:** Approval rate visible; proposed alias with score is one click away from binding.
- **Research sources:**
  - Notebook entries tagged with the parent phase
  - docs/phases-5-6-6b-research.md (locked decisions + open questions)
- **Risk flags:**
  - **Approval contract** — New activity must be added to activity_policies + audited
- **Verify before approve:**
  - [ ] Acceptance line met: _Approval rate visible; proposed alias with score is one click away from binding._
  - [ ] Migration (if any) leaves RLS enabled and realtime publication updated
  - [ ] No new secret printed in logs or stored in plaintext
  - [ ] New events flow through `*_events` table and are visible in /db-explorer
  - [ ] Idempotency-Key replay returns identical response (writes only)
  - [ ] Roadmap task moves to `done` only when CHANGELOG entry + docs reference exist

#### s6b.2.t3 — Bulk re-resolve UI

- **Module:** operator_console
- **Depends on:** `s5.3.t3`, `s6b.2.t1`
- **Description:** Implements spec from s5.3 t3; for revoked aliases affecting >100 rows.
- **Acceptance:** 100-row case completes in single operator session with progress UI.
- **Research sources:**
  - Notebook entries tagged with the parent phase
  - docs/phases-5-6-6b-research.md (locked decisions + open questions)
- **Risk flags:**
  - **Operator UX** — Realtime subscription + empty/loading/error states
- **Verify before approve:**
  - [ ] Acceptance line met: _100-row case completes in single operator session with progress UI._
  - [ ] Migration (if any) leaves RLS enabled and realtime publication updated
  - [ ] No new secret printed in logs or stored in plaintext
  - [ ] New events flow through `*_events` table and are visible in /db-explorer
  - [ ] Idempotency-Key replay returns identical response (writes only)
  - [ ] Roadmap task moves to `done` only when CHANGELOG entry + docs reference exist

#### s6b.2.t4 — Resolver decision detail

- **Module:** operator_console
- **Depends on:** `s5.2.t5`, `s6b.2.t1`
- **Description:** Shows candidate set, scores, why winner won; linked from any canonical fact.
- **Acceptance:** Click-through from canonical fact reaches decision in <=2 clicks.
- **Research sources:**
  - Notebook entries tagged with the parent phase
  - docs/phases-5-6-6b-research.md (locked decisions + open questions)
- **Risk flags:**
  - **Scope creep** — Verify acceptance line is the only outcome shipped
- **Verify before approve:**
  - [ ] Acceptance line met: _Click-through from canonical fact reaches decision in <=2 clicks._
  - [ ] Migration (if any) leaves RLS enabled and realtime publication updated
  - [ ] No new secret printed in logs or stored in plaintext
  - [ ] New events flow through `*_events` table and are visible in /db-explorer
  - [ ] Idempotency-Key replay returns identical response (writes only)
  - [ ] Roadmap task moves to `done` only when CHANGELOG entry + docs reference exist


### s6b.3 — Operator SLAs + alerts

> Goal: Quarantine SLA, conflict SLA banners, Telegram digest, resolver health metrics.

#### s6b.3.t1 — Quarantine SLA config

- **Module:** operator_console
- **Depends on:** `s6.1.t5`, `s6b.1.t4`
- **Description:** Per-tenant threshold, hours-pending alert via existing alert_settings webhook.
- **Acceptance:** Threshold breach fires alert through existing dispatcher; visible in alert_log.
- **Research sources:**
  - Notebook entries tagged with the parent phase
  - docs/phases-5-6-6b-research.md (locked decisions + open questions)
  - docs/api.md webhook section (to author)
- **Risk flags:**
  - **Security/isolation** — Cross-tenant leak or RLS bypass
- **Verify before approve:**
  - [ ] Acceptance line met: _Threshold breach fires alert through existing dispatcher; visible in alert_log._
  - [ ] Migration (if any) leaves RLS enabled and realtime publication updated
  - [ ] No new secret printed in logs or stored in plaintext
  - [ ] New events flow through `*_events` table and are visible in /db-explorer
  - [ ] Idempotency-Key replay returns identical response (writes only)
  - [ ] Roadmap task moves to `done` only when CHANGELOG entry + docs reference exist

#### s6b.3.t2 — Conflict SLA + OKR rollup banner

- **Module:** operator_console
- **Depends on:** `s6.3.t1`, `s6b.1.t2`
- **Description:** Pending conflict on a KR fact shows on /roadmap task detail and OKR detail.
- **Acceptance:** Conflict older than threshold renders red banner on the affected OKR/task.
- **Research sources:**
  - Notebook entries tagged with the parent phase
  - docs/phases-5-6-6b-research.md (locked decisions + open questions)
- **Risk flags:**
  - **Operator UX** — Realtime subscription + empty/loading/error states
  - **Data integrity** — Append-only; never silent overwrite; audit diff
- **Verify before approve:**
  - [ ] Acceptance line met: _Conflict older than threshold renders red banner on the affected OKR/task._
  - [ ] Migration (if any) leaves RLS enabled and realtime publication updated
  - [ ] No new secret printed in logs or stored in plaintext
  - [ ] New events flow through `*_events` table and are visible in /db-explorer
  - [ ] Idempotency-Key replay returns identical response (writes only)
  - [ ] Roadmap task moves to `done` only when CHANGELOG entry + docs reference exist

#### s6b.3.t3 — Telegram digest job

- **Module:** operator_channel
- **Depends on:** `s6b.1.t1`, `s6b.2.t1`
- **Description:** Nightly: open conflicts, quarantined > N, aliases awaiting approval. Cron via existing automation infra.
- **Acceptance:** Digest delivered at 07:00 UTC; logged in automation_runs.
- **Research sources:**
  - Notebook entries tagged with the parent phase
  - docs/phases-5-6-6b-research.md (locked decisions + open questions)
- **Risk flags:**
  - **Approval contract** — New activity must be added to activity_policies + audited
  - **Data integrity** — Append-only; never silent overwrite; audit diff
- **Verify before approve:**
  - [ ] Acceptance line met: _Digest delivered at 07:00 UTC; logged in automation_runs._
  - [ ] Migration (if any) leaves RLS enabled and realtime publication updated
  - [ ] No new secret printed in logs or stored in plaintext
  - [ ] New events flow through `*_events` table and are visible in /db-explorer
  - [ ] Idempotency-Key replay returns identical response (writes only)
  - [ ] Roadmap task moves to `done` only when CHANGELOG entry + docs reference exist

#### s6b.3.t4 — Resolver health metrics

- **Module:** operator_console
- **Depends on:** `s5.2.t5`, `s6b.2.t4`
- **Description:** Auto-bind rate, manual-confirm rate, override rate per source. Visible on /status.
- **Acceptance:** Metrics update daily; Status page shows trend per source.
- **Research sources:**
  - Notebook entries tagged with the parent phase
  - docs/phases-5-6-6b-research.md (locked decisions + open questions)
  - RICS asset reference standard
- **Risk flags:**
  - **Scope creep** — Verify acceptance line is the only outcome shipped
- **Verify before approve:**
  - [ ] Acceptance line met: _Metrics update daily; Status page shows trend per source._
  - [ ] Migration (if any) leaves RLS enabled and realtime publication updated
  - [ ] No new secret printed in logs or stored in plaintext
  - [ ] New events flow through `*_events` table and are visible in /db-explorer
  - [ ] Idempotency-Key replay returns identical response (writes only)
  - [ ] Roadmap task moves to `done` only when CHANGELOG entry + docs reference exist


## Connector Marketplace (`phase-7`)


### s7.1 — Connector manifest v1

> Goal: Manifest schema, validator, install dry-run.

#### s7.1.t1 — connector_manifests table

- **Module:** core
- **Depends on:** —
- **Description:** Registry of connectors with name, version, vendor, scopes, status (planned/certified/community), source_type
- **Acceptance:** Manifest row required for any connector to load; status badge surfaced in /connectors UI
- **Research sources:**
  - Notebook entries tagged with the parent phase
  - docs/phases-5-6-6b-research.md (locked decisions + open questions)
- **Risk flags:**
  - **Schema migration** — Backwards-compat, RLS on new table, realtime publication
  - **Vendor coupling** — Pin upstream version; document break-glass
  - **Operator UX** — Realtime subscription + empty/loading/error states
- **Verify before approve:**
  - [ ] Acceptance line met: _Manifest row required for any connector to load; status badge surfaced in /connectors UI_
  - [ ] Migration (if any) leaves RLS enabled and realtime publication updated
  - [ ] No new secret printed in logs or stored in plaintext
  - [ ] New events flow through `*_events` table and are visible in /db-explorer
  - [ ] Idempotency-Key replay returns identical response (writes only)
  - [ ] Roadmap task moves to `done` only when CHANGELOG entry + docs reference exist

#### s7.1.t2 — connector_versions table

- **Module:** core
- **Depends on:** —
- **Description:** Semver-tracked releases per manifest with changelog and breaking-change flag
- **Acceptance:** Installs pin to a version; breaking-change flag forces operator approval before upgrade
- **Research sources:**
  - Notebook entries tagged with the parent phase
  - docs/phases-5-6-6b-research.md (locked decisions + open questions)
- **Risk flags:**
  - **Approval contract** — New activity must be added to activity_policies + audited
  - **Schema migration** — Backwards-compat, RLS on new table, realtime publication
  - **Vendor coupling** — Pin upstream version; document break-glass
- **Verify before approve:**
  - [ ] Acceptance line met: _Installs pin to a version; breaking-change flag forces operator approval before upgrade_
  - [ ] Migration (if any) leaves RLS enabled and realtime publication updated
  - [ ] No new secret printed in logs or stored in plaintext
  - [ ] New events flow through `*_events` table and are visible in /db-explorer
  - [ ] Idempotency-Key replay returns identical response (writes only)
  - [ ] Roadmap task moves to `done` only when CHANGELOG entry + docs reference exist

#### s7.1.t3 — connector_installs table

- **Module:** core
- **Depends on:** —
- **Description:** Per-tenant install record with version, configured secrets ref, enabled flag
- **Acceptance:** Install row scoped per tenant_id; one install per (tenant_id, manifest_id); RLS operator-only
- **Research sources:**
  - Notebook entries tagged with the parent phase
  - docs/phases-5-6-6b-research.md (locked decisions + open questions)
  - SECR reporting framework
- **Risk flags:**
  - **Security/isolation** — Cross-tenant leak or RLS bypass
  - **Schema migration** — Backwards-compat, RLS on new table, realtime publication
  - **Secrets handling** — No plaintext secrets in logs/raw_records; rotation path
  - **Vendor coupling** — Pin upstream version; document break-glass
- **Verify before approve:**
  - [ ] Acceptance line met: _Install row scoped per tenant_id; one install per (tenant_id, manifest_id); RLS operator-only_
  - [ ] Migration (if any) leaves RLS enabled and realtime publication updated
  - [ ] No new secret printed in logs or stored in plaintext
  - [ ] New events flow through `*_events` table and are visible in /db-explorer
  - [ ] Idempotency-Key replay returns identical response (writes only)
  - [ ] Roadmap task moves to `done` only when CHANGELOG entry + docs reference exist

#### s7.1.t4 — /connectors operator page

- **Module:** operator_console
- **Depends on:** —
- **Description:** List + detail view; install/uninstall + version pin + scope review
- **Acceptance:** Install/uninstall emits capability_event; UI shows certified vs community badge
- **Research sources:**
  - Notebook entries tagged with the parent phase
  - docs/phases-5-6-6b-research.md (locked decisions + open questions)
- **Risk flags:**
  - **Vendor coupling** — Pin upstream version; document break-glass
  - **Operator UX** — Realtime subscription + empty/loading/error states
- **Verify before approve:**
  - [ ] Acceptance line met: _Install/uninstall emits capability_event; UI shows certified vs community badge_
  - [ ] Migration (if any) leaves RLS enabled and realtime publication updated
  - [ ] No new secret printed in logs or stored in plaintext
  - [ ] New events flow through `*_events` table and are visible in /db-explorer
  - [ ] Idempotency-Key replay returns identical response (writes only)
  - [ ] Roadmap task moves to `done` only when CHANGELOG entry + docs reference exist

#### s7.1.t5 — connector_events stream

- **Module:** core
- **Depends on:** —
- **Description:** Append-only events: install, upgrade, disable, secret_rotated, error
- **Acceptance:** Every connector lifecycle change has a matching event row; visible on /connectors detail
- **Research sources:**
  - Notebook entries tagged with the parent phase
  - docs/phases-5-6-6b-research.md (locked decisions + open questions)
  - SECR reporting framework
- **Risk flags:**
  - **Secrets handling** — No plaintext secrets in logs/raw_records; rotation path
  - **Vendor coupling** — Pin upstream version; document break-glass
  - **Operator UX** — Realtime subscription + empty/loading/error states
- **Verify before approve:**
  - [ ] Acceptance line met: _Every connector lifecycle change has a matching event row; visible on /connectors detail_
  - [ ] Migration (if any) leaves RLS enabled and realtime publication updated
  - [ ] No new secret printed in logs or stored in plaintext
  - [ ] New events flow through `*_events` table and are visible in /db-explorer
  - [ ] Idempotency-Key replay returns identical response (writes only)
  - [ ] Roadmap task moves to `done` only when CHANGELOG entry + docs reference exist


### s7.2 — Connector SDK + certification

> Goal: Open SDK, certification tier, versioning + upgrade flow

#### s7.2.t1 — TypeScript SDK package

- **Module:** core
- **Depends on:** —
- **Description:** @awip/connector-sdk skeleton: lifecycle hooks (init, ingest, healthcheck), typed config, secret accessor
- **Acceptance:** npm publish dry-run passes; sample echo connector builds against the SDK
- **Research sources:**
  - Notebook entries tagged with the parent phase
  - docs/phases-5-6-6b-research.md (locked decisions + open questions)
  - SECR reporting framework
- **Risk flags:**
  - **Secrets handling** — No plaintext secrets in logs/raw_records; rotation path
  - **Vendor coupling** — Pin upstream version; document break-glass
  - **Operator UX** — Realtime subscription + empty/loading/error states
- **Verify before approve:**
  - [ ] Acceptance line met: _npm publish dry-run passes; sample echo connector builds against the SDK_
  - [ ] Migration (if any) leaves RLS enabled and realtime publication updated
  - [ ] No new secret printed in logs or stored in plaintext
  - [ ] New events flow through `*_events` table and are visible in /db-explorer
  - [ ] Idempotency-Key replay returns identical response (writes only)
  - [ ] Roadmap task moves to `done` only when CHANGELOG entry + docs reference exist

#### s7.2.t2 — Connector test harness

- **Module:** core
- **Depends on:** —
- **Description:** Local runner that exercises lifecycle hooks against a fake awip-api
- **Acceptance:** Echo connector passes harness in CI; PR template requires harness output
- **Research sources:**
  - Notebook entries tagged with the parent phase
  - docs/phases-5-6-6b-research.md (locked decisions + open questions)
- **Risk flags:**
  - **Vendor coupling** — Pin upstream version; document break-glass
  - **Operator UX** — Realtime subscription + empty/loading/error states
- **Verify before approve:**
  - [ ] Acceptance line met: _Echo connector passes harness in CI; PR template requires harness output_
  - [ ] Migration (if any) leaves RLS enabled and realtime publication updated
  - [ ] No new secret printed in logs or stored in plaintext
  - [ ] New events flow through `*_events` table and are visible in /db-explorer
  - [ ] Idempotency-Key replay returns identical response (writes only)
  - [ ] Roadmap task moves to `done` only when CHANGELOG entry + docs reference exist

#### s7.2.t3 — Certification checklist

- **Module:** compliance
- **Depends on:** —
- **Description:** Markdown checklist + automated linter: scopes minimised, no plaintext secrets, healthcheck implemented, retry policy declared
- **Acceptance:** Certified status only set when checklist + linter pass; recorded on connector_versions
- **Research sources:**
  - Notebook entries tagged with the parent phase
  - docs/phases-5-6-6b-research.md (locked decisions + open questions)
  - SECR reporting framework
- **Risk flags:**
  - **Idempotency** — Replay must produce identical response + single side-effect
  - **Secrets handling** — No plaintext secrets in logs/raw_records; rotation path
  - **Vendor coupling** — Pin upstream version; document break-glass
- **Verify before approve:**
  - [ ] Acceptance line met: _Certified status only set when checklist + linter pass; recorded on connector_versions_
  - [ ] Migration (if any) leaves RLS enabled and realtime publication updated
  - [ ] No new secret printed in logs or stored in plaintext
  - [ ] New events flow through `*_events` table and are visible in /db-explorer
  - [ ] Idempotency-Key replay returns identical response (writes only)
  - [ ] Roadmap task moves to `done` only when CHANGELOG entry + docs reference exist

#### s7.2.t4 — Upgrade approval flow

- **Module:** operator_console
- **Depends on:** —
- **Description:** Breaking-change upgrade routes via approval_queue with diff of declared scopes
- **Acceptance:** Upgrades that change scopes require operator approval; auto-upgrade allowed only for patch versions
- **Research sources:**
  - Notebook entries tagged with the parent phase
  - docs/phases-5-6-6b-research.md (locked decisions + open questions)
- **Risk flags:**
  - **Approval contract** — New activity must be added to activity_policies + audited
  - **Operator UX** — Realtime subscription + empty/loading/error states
- **Verify before approve:**
  - [ ] Acceptance line met: _Upgrades that change scopes require operator approval; auto-upgrade allowed only for patch versions_
  - [ ] Migration (if any) leaves RLS enabled and realtime publication updated
  - [ ] No new secret printed in logs or stored in plaintext
  - [ ] New events flow through `*_events` table and are visible in /db-explorer
  - [ ] Idempotency-Key replay returns identical response (writes only)
  - [ ] Roadmap task moves to `done` only when CHANGELOG entry + docs reference exist

#### s7.2.t5 — Connector secret rotation

- **Module:** core
- **Depends on:** —
- **Description:** Per-install rotate action that pulls fresh value from secrets vault and emits secret_rotated event
- **Acceptance:** Rotation completes without downtime; event row carries previous secret hash + new hash
- **Research sources:**
  - Notebook entries tagged with the parent phase
  - docs/phases-5-6-6b-research.md (locked decisions + open questions)
  - SECR reporting framework
- **Risk flags:**
  - **Secrets handling** — No plaintext secrets in logs/raw_records; rotation path
  - **Vendor coupling** — Pin upstream version; document break-glass
- **Verify before approve:**
  - [ ] Acceptance line met: _Rotation completes without downtime; event row carries previous secret hash + new hash_
  - [ ] Migration (if any) leaves RLS enabled and realtime publication updated
  - [ ] No new secret printed in logs or stored in plaintext
  - [ ] New events flow through `*_events` table and are visible in /db-explorer
  - [ ] Idempotency-Key replay returns identical response (writes only)
  - [ ] Roadmap task moves to `done` only when CHANGELOG entry + docs reference exist


### s7.3 — Division rollup engine

> Goal: Declarative rollup spec on parent KRs across heterogeneous divisions

#### s7.3.t1 — rollup_specs table

- **Module:** core
- **Depends on:** —
- **Description:** Declarative parent-KR rollup: kind (sum, weighted_avg, worst_of, custom_skill), filter, denominator field
- **Acceptance:** Spec row attached to okr_node; rollup engine refuses to compute without one
- **Research sources:**
  - Notebook entries tagged with the parent phase
  - docs/phases-5-6-6b-research.md (locked decisions + open questions)
- **Risk flags:**
  - **Schema migration** — Backwards-compat, RLS on new table, realtime publication
- **Verify before approve:**
  - [ ] Acceptance line met: _Spec row attached to okr_node; rollup engine refuses to compute without one_
  - [ ] Migration (if any) leaves RLS enabled and realtime publication updated
  - [ ] No new secret printed in logs or stored in plaintext
  - [ ] New events flow through `*_events` table and are visible in /db-explorer
  - [ ] Idempotency-Key replay returns identical response (writes only)
  - [ ] Roadmap task moves to `done` only when CHANGELOG entry + docs reference exist

#### s7.3.t2 — Denominator reconciliation

- **Module:** core
- **Depends on:** —
- **Description:** When divisions report metrics with different denominators (kWh/m2 vs kWh/unit), spec declares the canonical denominator + conversion
- **Acceptance:** Reconciliation logged per division; mismatched denominators raise a fact_conflict
- **Research sources:**
  - Notebook entries tagged with the parent phase
  - docs/phases-5-6-6b-research.md (locked decisions + open questions)
  - RICS asset reference standard
- **Risk flags:**
  - **Data integrity** — Append-only; never silent overwrite; audit diff
- **Verify before approve:**
  - [ ] Acceptance line met: _Reconciliation logged per division; mismatched denominators raise a fact_conflict_
  - [ ] Migration (if any) leaves RLS enabled and realtime publication updated
  - [ ] No new secret printed in logs or stored in plaintext
  - [ ] New events flow through `*_events` table and are visible in /db-explorer
  - [ ] Idempotency-Key replay returns identical response (writes only)
  - [ ] Roadmap task moves to `done` only when CHANGELOG entry + docs reference exist

#### s7.3.t3 — Differential cadence snapshots

- **Module:** core
- **Depends on:** —
- **Description:** Weekly division facts snapshot at quarterly close into immutable view consumed by central rollup
- **Acceptance:** Snapshot rows tagged with period_id; central report cites snapshot, not live data
- **Research sources:**
  - Notebook entries tagged with the parent phase
  - docs/phases-5-6-6b-research.md (locked decisions + open questions)
- **Risk flags:**
  - **Schema migration** — Backwards-compat, RLS on new table, realtime publication
- **Verify before approve:**
  - [ ] Acceptance line met: _Snapshot rows tagged with period_id; central report cites snapshot, not live data_
  - [ ] Migration (if any) leaves RLS enabled and realtime publication updated
  - [ ] No new secret printed in logs or stored in plaintext
  - [ ] New events flow through `*_events` table and are visible in /db-explorer
  - [ ] Idempotency-Key replay returns identical response (writes only)
  - [ ] Roadmap task moves to `done` only when CHANGELOG entry + docs reference exist

#### s7.3.t4 — Central restatement precedence

- **Module:** operator_console
- **Depends on:** —
- **Description:** Conflict_rule preset: central restatement supersedes division-published value with audit trail
- **Acceptance:** Restatement event visible on division dashboard with original + new values
- **Research sources:**
  - Notebook entries tagged with the parent phase
  - docs/phases-5-6-6b-research.md (locked decisions + open questions)
- **Risk flags:**
  - **Operator UX** — Realtime subscription + empty/loading/error states
  - **Data integrity** — Append-only; never silent overwrite; audit diff
- **Verify before approve:**
  - [ ] Acceptance line met: _Restatement event visible on division dashboard with original + new values_
  - [ ] Migration (if any) leaves RLS enabled and realtime publication updated
  - [ ] No new secret printed in logs or stored in plaintext
  - [ ] New events flow through `*_events` table and are visible in /db-explorer
  - [ ] Idempotency-Key replay returns identical response (writes only)
  - [ ] Roadmap task moves to `done` only when CHANGELOG entry + docs reference exist

#### s7.3.t5 — Schema inheritance

- **Module:** core
- **Depends on:** —
- **Description:** Divisions inherit central canonical schema; declared extensions are additive only
- **Acceptance:** Extension columns visible on division but invisible to sibling divisions; central rollup ignores extensions
- **Research sources:**
  - Notebook entries tagged with the parent phase
  - docs/phases-5-6-6b-research.md (locked decisions + open questions)
- **Risk flags:**
  - **Schema migration** — Backwards-compat, RLS on new table, realtime publication
- **Verify before approve:**
  - [ ] Acceptance line met: _Extension columns visible on division but invisible to sibling divisions; central rollup ignores extensions_
  - [ ] Migration (if any) leaves RLS enabled and realtime publication updated
  - [ ] No new secret printed in logs or stored in plaintext
  - [ ] New events flow through `*_events` table and are visible in /db-explorer
  - [ ] Idempotency-Key replay returns identical response (writes only)
  - [ ] Roadmap task moves to `done` only when CHANGELOG entry + docs reference exist


## Multi-tenant Hardening (`phase-9`)


### s9.1 — Tenant isolation audit

> Goal: RLS sweep + per-tenant fuzz tests.

#### s9.1.t1 — RLS audit script

- **Module:** core
- **Depends on:** —
- **Description:** Query enumerates every public table, asserts tenant_id or tenant_node_id RLS predicate exists
- **Acceptance:** CI fails when a new table lands without an isolation predicate
- **Research sources:**
  - Notebook entries tagged with the parent phase
  - docs/phases-5-6-6b-research.md (locked decisions + open questions)
- **Risk flags:**
  - **Security/isolation** — Cross-tenant leak or RLS bypass
  - **Schema migration** — Backwards-compat, RLS on new table, realtime publication
- **Verify before approve:**
  - [ ] Acceptance line met: _CI fails when a new table lands without an isolation predicate_
  - [ ] Migration (if any) leaves RLS enabled and realtime publication updated
  - [ ] No new secret printed in logs or stored in plaintext
  - [ ] New events flow through `*_events` table and are visible in /db-explorer
  - [ ] Idempotency-Key replay returns identical response (writes only)
  - [ ] Roadmap task moves to `done` only when CHANGELOG entry + docs reference exist

#### s9.1.t2 — Synthetic cross-tenant test pack

- **Module:** core
- **Depends on:** —
- **Description:** Seed two tenants with identical asset codes and run resolver, query, and rollup paths
- **Acceptance:** Zero cross-tenant rows returned in any of N test queries; recorded in test-runs
- **Research sources:**
  - Notebook entries tagged with the parent phase
  - docs/phases-5-6-6b-research.md (locked decisions + open questions)
- **Risk flags:**
  - **Security/isolation** — Cross-tenant leak or RLS bypass
- **Verify before approve:**
  - [ ] Acceptance line met: _Zero cross-tenant rows returned in any of N test queries; recorded in test-runs_
  - [ ] Migration (if any) leaves RLS enabled and realtime publication updated
  - [ ] No new secret printed in logs or stored in plaintext
  - [ ] New events flow through `*_events` table and are visible in /db-explorer
  - [ ] Idempotency-Key replay returns identical response (writes only)
  - [ ] Roadmap task moves to `done` only when CHANGELOG entry + docs reference exist

#### s9.1.t3 — Service-token scope check

- **Module:** core
- **Depends on:** —
- **Description:** x-awip-service-token validated against per-tenant capability allowlist before any write
- **Acceptance:** Token scoped to tenant A cannot mutate tenant B data; attempt logged + alert fires
- **Research sources:**
  - Notebook entries tagged with the parent phase
  - docs/phases-5-6-6b-research.md (locked decisions + open questions)
- **Risk flags:**
  - **Security/isolation** — Cross-tenant leak or RLS bypass
  - **Secrets handling** — No plaintext secrets in logs/raw_records; rotation path
- **Verify before approve:**
  - [ ] Acceptance line met: _Token scoped to tenant A cannot mutate tenant B data; attempt logged + alert fires_
  - [ ] Migration (if any) leaves RLS enabled and realtime publication updated
  - [ ] No new secret printed in logs or stored in plaintext
  - [ ] New events flow through `*_events` table and are visible in /db-explorer
  - [ ] Idempotency-Key replay returns identical response (writes only)
  - [ ] Roadmap task moves to `done` only when CHANGELOG entry + docs reference exist

#### s9.1.t4 — Cross-tenant near-miss metric

- **Module:** operator_console
- **Depends on:** —
- **Description:** Count resolver/query paths that returned a candidate from another tenant before the filter
- **Acceptance:** Metric exposed on /entities; >0 over a window triggers alert
- **Research sources:**
  - Notebook entries tagged with the parent phase
  - docs/phases-5-6-6b-research.md (locked decisions + open questions)
- **Risk flags:**
  - **Security/isolation** — Cross-tenant leak or RLS bypass
  - **Operator UX** — Realtime subscription + empty/loading/error states
- **Verify before approve:**
  - [ ] Acceptance line met: _Metric exposed on /entities; >0 over a window triggers alert_
  - [ ] Migration (if any) leaves RLS enabled and realtime publication updated
  - [ ] No new secret printed in logs or stored in plaintext
  - [ ] New events flow through `*_events` table and are visible in /db-explorer
  - [ ] Idempotency-Key replay returns identical response (writes only)
  - [ ] Roadmap task moves to `done` only when CHANGELOG entry + docs reference exist

#### s9.1.t5 — Audit pack export

- **Module:** compliance
- **Depends on:** —
- **Description:** One-click export: RLS coverage, last test-run, near-miss counts, secrets posture
- **Acceptance:** Pack downloads as a zip with markdown + json; referenced from /roadmap
- **Research sources:**
  - Notebook entries tagged with the parent phase
  - docs/phases-5-6-6b-research.md (locked decisions + open questions)
  - SECR reporting framework
- **Risk flags:**
  - **Security/isolation** — Cross-tenant leak or RLS bypass
  - **LLM cost/quality** — Token budget, fallback model, eval on golden set
  - **Secrets handling** — No plaintext secrets in logs/raw_records; rotation path
- **Verify before approve:**
  - [ ] Acceptance line met: _Pack downloads as a zip with markdown + json; referenced from /roadmap_
  - [ ] Migration (if any) leaves RLS enabled and realtime publication updated
  - [ ] No new secret printed in logs or stored in plaintext
  - [ ] New events flow through `*_events` table and are visible in /db-explorer
  - [ ] Idempotency-Key replay returns identical response (writes only)
  - [ ] Roadmap task moves to `done` only when CHANGELOG entry + docs reference exist


### s9.2 — Residency & k-anonymity

> Goal: Per-node region pinning, cross-region guards, benchmark cohort floor

#### s9.2.t1 — tenant_node region pinning

- **Module:** core
- **Depends on:** —
- **Description:** Add region column on tenant_nodes; resolver and query refuse cross-region results without explicit policy
- **Acceptance:** Cross-region query without policy returns 403 with structured reason
- **Research sources:**
  - Notebook entries tagged with the parent phase
  - docs/phases-5-6-6b-research.md (locked decisions + open questions)
- **Risk flags:**
  - **Security/isolation** — Cross-tenant leak or RLS bypass
- **Verify before approve:**
  - [ ] Acceptance line met: _Cross-region query without policy returns 403 with structured reason_
  - [ ] Migration (if any) leaves RLS enabled and realtime publication updated
  - [ ] No new secret printed in logs or stored in plaintext
  - [ ] New events flow through `*_events` table and are visible in /db-explorer
  - [ ] Idempotency-Key replay returns identical response (writes only)
  - [ ] Roadmap task moves to `done` only when CHANGELOG entry + docs reference exist

#### s9.2.t2 — Residency policy table

- **Module:** core
- **Depends on:** —
- **Description:** Per-tenant policy: allow, redact, or deny for each (source_region, target_region) pair
- **Acceptance:** Policy enforced in awip-api middleware; change requires operator approval
- **Research sources:**
  - Notebook entries tagged with the parent phase
  - docs/phases-5-6-6b-research.md (locked decisions + open questions)
- **Risk flags:**
  - **Security/isolation** — Cross-tenant leak or RLS bypass
  - **Approval contract** — New activity must be added to activity_policies + audited
  - **Schema migration** — Backwards-compat, RLS on new table, realtime publication
  - **Operator UX** — Realtime subscription + empty/loading/error states
- **Verify before approve:**
  - [ ] Acceptance line met: _Policy enforced in awip-api middleware; change requires operator approval_
  - [ ] Migration (if any) leaves RLS enabled and realtime publication updated
  - [ ] No new secret printed in logs or stored in plaintext
  - [ ] New events flow through `*_events` table and are visible in /db-explorer
  - [ ] Idempotency-Key replay returns identical response (writes only)
  - [ ] Roadmap task moves to `done` only when CHANGELOG entry + docs reference exist

#### s9.2.t3 — k-anonymity floor

- **Module:** core
- **Depends on:** —
- **Description:** Cross-division benchmark queries refuse to return cohorts smaller than configured k
- **Acceptance:** Default k=5; per-tenant override; refusal returns generic reason without leaking cohort size
- **Research sources:**
  - Notebook entries tagged with the parent phase
  - docs/phases-5-6-6b-research.md (locked decisions + open questions)
- **Risk flags:**
  - **Security/isolation** — Cross-tenant leak or RLS bypass
- **Verify before approve:**
  - [ ] Acceptance line met: _Default k=5; per-tenant override; refusal returns generic reason without leaking cohort size_
  - [ ] Migration (if any) leaves RLS enabled and realtime publication updated
  - [ ] No new secret printed in logs or stored in plaintext
  - [ ] New events flow through `*_events` table and are visible in /db-explorer
  - [ ] Idempotency-Key replay returns identical response (writes only)
  - [ ] Roadmap task moves to `done` only when CHANGELOG entry + docs reference exist

#### s9.2.t4 — Region-aware storage paths

- **Module:** core
- **Depends on:** —
- **Description:** Embeddings + raw_records partitioned by region; cross-region read requires policy
- **Acceptance:** Storage path includes region prefix; CI verifies no row crosses the boundary
- **Research sources:**
  - Notebook entries tagged with the parent phase
  - docs/phases-5-6-6b-research.md (locked decisions + open questions)
  - Embedding model benchmarks
- **Risk flags:**
  - **Security/isolation** — Cross-tenant leak or RLS bypass
  - **LLM cost/quality** — Token budget, fallback model, eval on golden set
  - **Schema migration** — Backwards-compat, RLS on new table, realtime publication
  - **Operator UX** — Realtime subscription + empty/loading/error states
- **Verify before approve:**
  - [ ] Acceptance line met: _Storage path includes region prefix; CI verifies no row crosses the boundary_
  - [ ] Migration (if any) leaves RLS enabled and realtime publication updated
  - [ ] No new secret printed in logs or stored in plaintext
  - [ ] New events flow through `*_events` table and are visible in /db-explorer
  - [ ] Idempotency-Key replay returns identical response (writes only)
  - [ ] Roadmap task moves to `done` only when CHANGELOG entry + docs reference exist

#### s9.2.t5 — Residency banner

- **Module:** operator_console
- **Depends on:** —
- **Description:** Operator console shows current region context + active policy on every page header
- **Acceptance:** Banner reflects the resolved region for the loaded tenant_node
- **Research sources:**
  - Notebook entries tagged with the parent phase
  - docs/phases-5-6-6b-research.md (locked decisions + open questions)
- **Risk flags:**
  - **Security/isolation** — Cross-tenant leak or RLS bypass
  - **Operator UX** — Realtime subscription + empty/loading/error states
- **Verify before approve:**
  - [ ] Acceptance line met: _Banner reflects the resolved region for the loaded tenant_node_
  - [ ] Migration (if any) leaves RLS enabled and realtime publication updated
  - [ ] No new secret printed in logs or stored in plaintext
  - [ ] New events flow through `*_events` table and are visible in /db-explorer
  - [ ] Idempotency-Key replay returns identical response (writes only)
  - [ ] Roadmap task moves to `done` only when CHANGELOG entry + docs reference exist


### s9.3 — Closed-period restatement

> Goal: Snapshot-on-close + restatement approval flow with downstream fan-out

#### s9.3.t1 — period_snapshots table

- **Module:** core
- **Depends on:** —
- **Description:** Immutable snapshot per (tenant_id, period_id, okr_node_id) with values + source provenance
- **Acceptance:** Closing a period writes the snapshot; subsequent reads of closed period serve from snapshot
- **Research sources:**
  - Notebook entries tagged with the parent phase
  - docs/phases-5-6-6b-research.md (locked decisions + open questions)
- **Risk flags:**
  - **Security/isolation** — Cross-tenant leak or RLS bypass
  - **Schema migration** — Backwards-compat, RLS on new table, realtime publication
  - **Data integrity** — Append-only; never silent overwrite; audit diff
- **Verify before approve:**
  - [ ] Acceptance line met: _Closing a period writes the snapshot; subsequent reads of closed period serve from snapshot_
  - [ ] Migration (if any) leaves RLS enabled and realtime publication updated
  - [ ] No new secret printed in logs or stored in plaintext
  - [ ] New events flow through `*_events` table and are visible in /db-explorer
  - [ ] Idempotency-Key replay returns identical response (writes only)
  - [ ] Roadmap task moves to `done` only when CHANGELOG entry + docs reference exist

#### s9.3.t2 — restatement approval activity

- **Module:** core
- **Depends on:** —
- **Description:** New approval_queue.activity = restate_closed_period with diff + downstream fan-out preview
- **Acceptance:** Approval shows affected reports + external consumers before commit
- **Research sources:**
  - Notebook entries tagged with the parent phase
  - docs/phases-5-6-6b-research.md (locked decisions + open questions)
- **Risk flags:**
  - **Approval contract** — New activity must be added to activity_policies + audited
  - **Data integrity** — Append-only; never silent overwrite; audit diff
- **Verify before approve:**
  - [ ] Acceptance line met: _Approval shows affected reports + external consumers before commit_
  - [ ] Migration (if any) leaves RLS enabled and realtime publication updated
  - [ ] No new secret printed in logs or stored in plaintext
  - [ ] New events flow through `*_events` table and are visible in /db-explorer
  - [ ] Idempotency-Key replay returns identical response (writes only)
  - [ ] Roadmap task moves to `done` only when CHANGELOG entry + docs reference exist

#### s9.3.t3 — Downstream consumer registry

- **Module:** compliance
- **Depends on:** —
- **Description:** Per-tenant registry of external report consumers (IFRS, CSRD, SBTi, regulator) with notify channels
- **Acceptance:** Restatement approval pings every registered consumer; delivery status logged
- **Research sources:**
  - Notebook entries tagged with the parent phase
  - docs/phases-5-6-6b-research.md (locked decisions + open questions)
  - CSRD disclosure requirements
  - SBTi target methodology
  - IFRS restatement guidance
- **Risk flags:**
  - **Security/isolation** — Cross-tenant leak or RLS bypass
  - **Approval contract** — New activity must be added to activity_policies + audited
  - **Data integrity** — Append-only; never silent overwrite; audit diff
- **Verify before approve:**
  - [ ] Acceptance line met: _Restatement approval pings every registered consumer; delivery status logged_
  - [ ] Migration (if any) leaves RLS enabled and realtime publication updated
  - [ ] No new secret printed in logs or stored in plaintext
  - [ ] New events flow through `*_events` table and are visible in /db-explorer
  - [ ] Idempotency-Key replay returns identical response (writes only)
  - [ ] Roadmap task moves to `done` only when CHANGELOG entry + docs reference exist

#### s9.3.t4 — Period v+1 versioning

- **Module:** core
- **Depends on:** —
- **Description:** Restatement creates a v+1 period that supersedes the closed snapshot; v0 retained read-only
- **Acceptance:** OKR detail page shows version history with reason and approver
- **Research sources:**
  - Notebook entries tagged with the parent phase
  - docs/phases-5-6-6b-research.md (locked decisions + open questions)
- **Risk flags:**
  - **Approval contract** — New activity must be added to activity_policies + audited
  - **Data integrity** — Append-only; never silent overwrite; audit diff
- **Verify before approve:**
  - [ ] Acceptance line met: _OKR detail page shows version history with reason and approver_
  - [ ] Migration (if any) leaves RLS enabled and realtime publication updated
  - [ ] No new secret printed in logs or stored in plaintext
  - [ ] New events flow through `*_events` table and are visible in /db-explorer
  - [ ] Idempotency-Key replay returns identical response (writes only)
  - [ ] Roadmap task moves to `done` only when CHANGELOG entry + docs reference exist

#### s9.3.t5 — IFRS/CSRD restatement encoding

- **Module:** compliance
- **Depends on:** —
- **Description:** Encode regulator-specific restatement rules as conflict_rule presets
- **Acceptance:** Selecting a regulator at tenant level loads the preset; presets are revocable + versioned
- **Research sources:**
  - Notebook entries tagged with the parent phase
  - docs/phases-5-6-6b-research.md (locked decisions + open questions)
  - CSRD disclosure requirements
  - IFRS restatement guidance
- **Risk flags:**
  - **Security/isolation** — Cross-tenant leak or RLS bypass
  - **Data integrity** — Append-only; never silent overwrite; audit diff
- **Verify before approve:**
  - [ ] Acceptance line met: _Selecting a regulator at tenant level loads the preset; presets are revocable + versioned_
  - [ ] Migration (if any) leaves RLS enabled and realtime publication updated
  - [ ] No new secret printed in logs or stored in plaintext
  - [ ] New events flow through `*_events` table and are visible in /db-explorer
  - [ ] Idempotency-Key replay returns identical response (writes only)
  - [ ] Roadmap task moves to `done` only when CHANGELOG entry + docs reference exist


## Public API & SDK (`phase-11`)


### s11.1 — Contract freeze v1

> Goal: Pin awip-api surface, version header, deprecation policy.

#### s11.1.t1 — OpenAPI 3.1 spec for awip-api

- **Module:** core
- **Depends on:** —
- **Description:** Generate spec from edge function routes; cover OKR, capability, approval, ingest, entity endpoints
- **Acceptance:** Spec lints clean; checked into repo; published at /api/openapi.json
- **Research sources:**
  - Notebook entries tagged with the parent phase
  - docs/phases-5-6-6b-research.md (locked decisions + open questions)
  - OpenAPI 3.1 spec for awip-api
- **Risk flags:**
  - **Approval contract** — New activity must be added to activity_policies + audited
- **Verify before approve:**
  - [ ] Acceptance line met: _Spec lints clean; checked into repo; published at /api/openapi.json_
  - [ ] Migration (if any) leaves RLS enabled and realtime publication updated
  - [ ] No new secret printed in logs or stored in plaintext
  - [ ] New events flow through `*_events` table and are visible in /db-explorer
  - [ ] Idempotency-Key replay returns identical response (writes only)
  - [ ] Roadmap task moves to `done` only when CHANGELOG entry + docs reference exist

#### s11.1.t2 — Versioned URL prefix

- **Module:** core
- **Depends on:** —
- **Description:** /v1 prefix added to awip-api with backwards-compat shim for unprefixed legacy routes (deprecation header)
- **Acceptance:** Legacy routes return Sunset header; v1 is the canonical contract
- **Research sources:**
  - Notebook entries tagged with the parent phase
  - docs/phases-5-6-6b-research.md (locked decisions + open questions)
- **Risk flags:**
  - **Scope creep** — Verify acceptance line is the only outcome shipped
- **Verify before approve:**
  - [ ] Acceptance line met: _Legacy routes return Sunset header; v1 is the canonical contract_
  - [ ] Migration (if any) leaves RLS enabled and realtime publication updated
  - [ ] No new secret printed in logs or stored in plaintext
  - [ ] New events flow through `*_events` table and are visible in /db-explorer
  - [ ] Idempotency-Key replay returns identical response (writes only)
  - [ ] Roadmap task moves to `done` only when CHANGELOG entry + docs reference exist

#### s11.1.t3 — Idempotency-Key contract test

- **Module:** core
- **Depends on:** —
- **Description:** Test pack replays every write endpoint twice with the same key + asserts identical response + single side-effect
- **Acceptance:** Failures block release; results recorded in test_runs
- **Research sources:**
  - Notebook entries tagged with the parent phase
  - docs/phases-5-6-6b-research.md (locked decisions + open questions)
- **Risk flags:**
  - **Idempotency** — Replay must produce identical response + single side-effect
- **Verify before approve:**
  - [ ] Acceptance line met: _Failures block release; results recorded in test_runs_
  - [ ] Migration (if any) leaves RLS enabled and realtime publication updated
  - [ ] No new secret printed in logs or stored in plaintext
  - [ ] New events flow through `*_events` table and are visible in /db-explorer
  - [ ] Idempotency-Key replay returns identical response (writes only)
  - [ ] Roadmap task moves to `done` only when CHANGELOG entry + docs reference exist

#### s11.1.t4 — Error envelope standard

- **Module:** core
- **Depends on:** —
- **Description:** Uniform error shape: code, message, hint, request_id; documented in api.md
- **Acceptance:** Every endpoint returns the envelope on 4xx/5xx; lint check in CI
- **Research sources:**
  - Notebook entries tagged with the parent phase
  - docs/phases-5-6-6b-research.md (locked decisions + open questions)
- **Risk flags:**
  - **Scope creep** — Verify acceptance line is the only outcome shipped
- **Verify before approve:**
  - [ ] Acceptance line met: _Every endpoint returns the envelope on 4xx/5xx; lint check in CI_
  - [ ] Migration (if any) leaves RLS enabled and realtime publication updated
  - [ ] No new secret printed in logs or stored in plaintext
  - [ ] New events flow through `*_events` table and are visible in /db-explorer
  - [ ] Idempotency-Key replay returns identical response (writes only)
  - [ ] Roadmap task moves to `done` only when CHANGELOG entry + docs reference exist

#### s11.1.t5 — Contract changelog

- **Module:** core
- **Depends on:** —
- **Description:** /v1 changelog file with semver entries; CI fails on uncategorised contract diff
- **Acceptance:** PR touching openapi.json requires changelog entry
- **Research sources:**
  - Notebook entries tagged with the parent phase
  - docs/phases-5-6-6b-research.md (locked decisions + open questions)
- **Risk flags:**
  - **Operator UX** — Realtime subscription + empty/loading/error states
- **Verify before approve:**
  - [ ] Acceptance line met: _PR touching openapi.json requires changelog entry_
  - [ ] Migration (if any) leaves RLS enabled and realtime publication updated
  - [ ] No new secret printed in logs or stored in plaintext
  - [ ] New events flow through `*_events` table and are visible in /db-explorer
  - [ ] Idempotency-Key replay returns identical response (writes only)
  - [ ] Roadmap task moves to `done` only when CHANGELOG entry + docs reference exist


### s11.2 — SDK + auth surface

> Goal: TS + Python SDK, scoped tokens, OAuth client credentials

#### s11.2.t1 — TypeScript SDK

- **Module:** core
- **Depends on:** —
- **Description:** @awip/sdk-ts generated from OpenAPI; typed clients for OKR, capability, approval, ingest, entity
- **Acceptance:** npm publish dry-run passes; quickstart in docs runs end-to-end
- **Research sources:**
  - Notebook entries tagged with the parent phase
  - docs/phases-5-6-6b-research.md (locked decisions + open questions)
  - OpenAPI 3.1 spec for awip-api
- **Risk flags:**
  - **Approval contract** — New activity must be added to activity_policies + audited
  - **Operator UX** — Realtime subscription + empty/loading/error states
- **Verify before approve:**
  - [ ] Acceptance line met: _npm publish dry-run passes; quickstart in docs runs end-to-end_
  - [ ] Migration (if any) leaves RLS enabled and realtime publication updated
  - [ ] No new secret printed in logs or stored in plaintext
  - [ ] New events flow through `*_events` table and are visible in /db-explorer
  - [ ] Idempotency-Key replay returns identical response (writes only)
  - [ ] Roadmap task moves to `done` only when CHANGELOG entry + docs reference exist

#### s11.2.t2 — Python SDK

- **Module:** core
- **Depends on:** —
- **Description:** @awip/sdk-py generated from OpenAPI with async client
- **Acceptance:** PyPI dry-run passes; quickstart matches TS parity
- **Research sources:**
  - Notebook entries tagged with the parent phase
  - docs/phases-5-6-6b-research.md (locked decisions + open questions)
  - OpenAPI 3.1 spec for awip-api
- **Risk flags:**
  - **Operator UX** — Realtime subscription + empty/loading/error states
- **Verify before approve:**
  - [ ] Acceptance line met: _PyPI dry-run passes; quickstart matches TS parity_
  - [ ] Migration (if any) leaves RLS enabled and realtime publication updated
  - [ ] No new secret printed in logs or stored in plaintext
  - [ ] New events flow through `*_events` table and are visible in /db-explorer
  - [ ] Idempotency-Key replay returns identical response (writes only)
  - [ ] Roadmap task moves to `done` only when CHANGELOG entry + docs reference exist

#### s11.2.t3 — Scoped API tokens

- **Module:** core
- **Depends on:** —
- **Description:** Per-tenant tokens with capability + table scopes, expiry, rotation; stored hashed
- **Acceptance:** Token cannot exceed declared scopes; rotation emits event; expired tokens 401
- **Research sources:**
  - Notebook entries tagged with the parent phase
  - docs/phases-5-6-6b-research.md (locked decisions + open questions)
- **Risk flags:**
  - **Security/isolation** — Cross-tenant leak or RLS bypass
  - **Schema migration** — Backwards-compat, RLS on new table, realtime publication
  - **Secrets handling** — No plaintext secrets in logs/raw_records; rotation path
- **Verify before approve:**
  - [ ] Acceptance line met: _Token cannot exceed declared scopes; rotation emits event; expired tokens 401_
  - [ ] Migration (if any) leaves RLS enabled and realtime publication updated
  - [ ] No new secret printed in logs or stored in plaintext
  - [ ] New events flow through `*_events` table and are visible in /db-explorer
  - [ ] Idempotency-Key replay returns identical response (writes only)
  - [ ] Roadmap task moves to `done` only when CHANGELOG entry + docs reference exist

#### s11.2.t4 — OAuth client credentials

- **Module:** core
- **Depends on:** —
- **Description:** Client credentials grant for machine-to-machine; client + secret per integration
- **Acceptance:** Token endpoint returns short-lived JWT; integration recorded in capability_events
- **Research sources:**
  - Notebook entries tagged with the parent phase
  - docs/phases-5-6-6b-research.md (locked decisions + open questions)
  - SECR reporting framework
  - OAuth 2.0 client_credentials RFC 6749 §4.4
- **Risk flags:**
  - **Secrets handling** — No plaintext secrets in logs/raw_records; rotation path
- **Verify before approve:**
  - [ ] Acceptance line met: _Token endpoint returns short-lived JWT; integration recorded in capability_events_
  - [ ] Migration (if any) leaves RLS enabled and realtime publication updated
  - [ ] No new secret printed in logs or stored in plaintext
  - [ ] New events flow through `*_events` table and are visible in /db-explorer
  - [ ] Idempotency-Key replay returns identical response (writes only)
  - [ ] Roadmap task moves to `done` only when CHANGELOG entry + docs reference exist

#### s11.2.t5 — SDK examples + quickstart

- **Module:** core
- **Depends on:** —
- **Description:** Worked examples: create OKR, register capability, approve activity, ingest CSV
- **Acceptance:** Examples runnable from clean machine following docs/api.md
- **Research sources:**
  - Notebook entries tagged with the parent phase
  - docs/phases-5-6-6b-research.md (locked decisions + open questions)
- **Risk flags:**
  - **Approval contract** — New activity must be added to activity_policies + audited
  - **Operator UX** — Realtime subscription + empty/loading/error states
- **Verify before approve:**
  - [ ] Acceptance line met: _Examples runnable from clean machine following docs/api.md_
  - [ ] Migration (if any) leaves RLS enabled and realtime publication updated
  - [ ] No new secret printed in logs or stored in plaintext
  - [ ] New events flow through `*_events` table and are visible in /db-explorer
  - [ ] Idempotency-Key replay returns identical response (writes only)
  - [ ] Roadmap task moves to `done` only when CHANGELOG entry + docs reference exist


### s11.3 — Webhooks & rate-limits

> Goal: Outbound webhook contract, retries, per-tenant quotas

#### s11.3.t1 — outbound_webhooks table

- **Module:** core
- **Depends on:** —
- **Description:** Per-tenant subscriptions: event_type filter, target_url, signing secret, active flag
- **Acceptance:** Subscription create/delete emits capability_event; secrets stored hashed
- **Research sources:**
  - Notebook entries tagged with the parent phase
  - docs/phases-5-6-6b-research.md (locked decisions + open questions)
  - SECR reporting framework
  - docs/api.md webhook section (to author)
- **Risk flags:**
  - **Security/isolation** — Cross-tenant leak or RLS bypass
  - **Schema migration** — Backwards-compat, RLS on new table, realtime publication
  - **Secrets handling** — No plaintext secrets in logs/raw_records; rotation path
- **Verify before approve:**
  - [ ] Acceptance line met: _Subscription create/delete emits capability_event; secrets stored hashed_
  - [ ] Migration (if any) leaves RLS enabled and realtime publication updated
  - [ ] No new secret printed in logs or stored in plaintext
  - [ ] New events flow through `*_events` table and are visible in /db-explorer
  - [ ] Idempotency-Key replay returns identical response (writes only)
  - [ ] Roadmap task moves to `done` only when CHANGELOG entry + docs reference exist

#### s11.3.t2 — Webhook delivery worker

- **Module:** core
- **Depends on:** —
- **Description:** Edge function dispatches matching events; HMAC-SHA256 signature header
- **Acceptance:** Successful delivery logged with status + duration; idempotent retries on 5xx
- **Research sources:**
  - Notebook entries tagged with the parent phase
  - docs/phases-5-6-6b-research.md (locked decisions + open questions)
  - docs/api.md webhook section (to author)
- **Risk flags:**
  - **Idempotency** — Replay must produce identical response + single side-effect
  - **Secrets handling** — No plaintext secrets in logs/raw_records; rotation path
- **Verify before approve:**
  - [ ] Acceptance line met: _Successful delivery logged with status + duration; idempotent retries on 5xx_
  - [ ] Migration (if any) leaves RLS enabled and realtime publication updated
  - [ ] No new secret printed in logs or stored in plaintext
  - [ ] New events flow through `*_events` table and are visible in /db-explorer
  - [ ] Idempotency-Key replay returns identical response (writes only)
  - [ ] Roadmap task moves to `done` only when CHANGELOG entry + docs reference exist

#### s11.3.t3 — Retry + dead-letter

- **Module:** operator_console
- **Depends on:** —
- **Description:** Exponential backoff up to N attempts; failed deliveries land in webhook_dead_letters with replay action
- **Acceptance:** Operator can replay from dead-letter UI; replay emits new delivery row
- **Research sources:**
  - Notebook entries tagged with the parent phase
  - docs/phases-5-6-6b-research.md (locked decisions + open questions)
  - docs/api.md webhook section (to author)
- **Risk flags:**
  - **Idempotency** — Replay must produce identical response + single side-effect
  - **Operator UX** — Realtime subscription + empty/loading/error states
- **Verify before approve:**
  - [ ] Acceptance line met: _Operator can replay from dead-letter UI; replay emits new delivery row_
  - [ ] Migration (if any) leaves RLS enabled and realtime publication updated
  - [ ] No new secret printed in logs or stored in plaintext
  - [ ] New events flow through `*_events` table and are visible in /db-explorer
  - [ ] Idempotency-Key replay returns identical response (writes only)
  - [ ] Roadmap task moves to `done` only when CHANGELOG entry + docs reference exist

#### s11.3.t4 — Per-tenant rate limits

- **Module:** core
- **Depends on:** —
- **Description:** Token-bucket rate limit per tenant + per route family; 429 with Retry-After
- **Acceptance:** Limits configurable per tenant; breaches counted on /roadmap automation panel
- **Research sources:**
  - Notebook entries tagged with the parent phase
  - docs/phases-5-6-6b-research.md (locked decisions + open questions)
- **Risk flags:**
  - **Security/isolation** — Cross-tenant leak or RLS bypass
  - **Idempotency** — Replay must produce identical response + single side-effect
  - **Secrets handling** — No plaintext secrets in logs/raw_records; rotation path
  - **Abuse/quota** — Per-tenant cap; clear 429 + Retry-After
- **Verify before approve:**
  - [ ] Acceptance line met: _Limits configurable per tenant; breaches counted on /roadmap automation panel_
  - [ ] Migration (if any) leaves RLS enabled and realtime publication updated
  - [ ] No new secret printed in logs or stored in plaintext
  - [ ] New events flow through `*_events` table and are visible in /db-explorer
  - [ ] Idempotency-Key replay returns identical response (writes only)
  - [ ] Roadmap task moves to `done` only when CHANGELOG entry + docs reference exist

#### s11.3.t5 — Webhook signing docs

- **Module:** core
- **Depends on:** —
- **Description:** Public docs: payload shape, signature verification snippets in TS + Python
- **Acceptance:** Signed payload verifies using docs snippet on first try
- **Research sources:**
  - Notebook entries tagged with the parent phase
  - docs/phases-5-6-6b-research.md (locked decisions + open questions)
  - docs/api.md webhook section (to author)
- **Risk flags:**
  - **Secrets handling** — No plaintext secrets in logs/raw_records; rotation path
- **Verify before approve:**
  - [ ] Acceptance line met: _Signed payload verifies using docs snippet on first try_
  - [ ] Migration (if any) leaves RLS enabled and realtime publication updated
  - [ ] No new secret printed in logs or stored in plaintext
  - [ ] New events flow through `*_events` table and are visible in /db-explorer
  - [ ] Idempotency-Key replay returns identical response (writes only)
  - [ ] Roadmap task moves to `done` only when CHANGELOG entry + docs reference exist
