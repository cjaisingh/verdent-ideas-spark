-- AUTO-GENERATED: roadmap seed for Phases 5, 6, 6b, 7, 9, 11
-- Idempotent: re-running is a no-op. Adjust by editing and re-applying.
-- Generated from live roadmap_* tables.
BEGIN;

INSERT INTO public.roadmap_phases (key, title, summary, "order", status)
VALUES ('phase-5', 'Entity & Tenant Resolution', 'Canonical entity model, alias resolver, tenant_node graph. Foundation for ingest.', 5, 'planned')
ON CONFLICT (key) DO NOTHING;
INSERT INTO public.roadmap_phases (key, title, summary, "order", status)
VALUES ('phase-6', 'Ingest & Canonicalisation', 'Source adapters, conflict detection, supersede semantics, idempotent writes.', 6, 'planned')
ON CONFLICT (key) DO NOTHING;
INSERT INTO public.roadmap_phases (key, title, summary, "order", status)
VALUES ('phase-6b', 'Ingest Observability', 'Per-source dashboards, conflict review UI, replay. Splits cleanly from Phase 6 build-out.', 7, 'planned')
ON CONFLICT (key) DO NOTHING;
INSERT INTO public.roadmap_phases (key, title, summary, "order", status)
VALUES ('phase-7', 'Connector Marketplace', 'Third-party capability connectors, manifest validation, install/uninstall flow. (Phase 8 reserved for OKR-driven slot once Phase 4 produces signal.)', 8, 'planned')
ON CONFLICT (key) DO NOTHING;
INSERT INTO public.roadmap_phases (key, title, summary, "order", status)
VALUES ('phase-9', 'Multi-tenant Hardening', 'Per-tenant RLS audit, quota, isolation tests, tenant admin surface. (Phase 10 reserved for OKR-driven slot.)', 10, 'planned')
ON CONFLICT (key) DO NOTHING;
INSERT INTO public.roadmap_phases (key, title, summary, "order", status)
VALUES ('phase-11', 'Public API & SDK', 'Stable contract surface, versioning, generated SDK, docs site.', 11, 'planned')
ON CONFLICT (key) DO NOTHING;

INSERT INTO public.roadmap_sprints (phase_id, key, title, goal, "order", status)
SELECT id, 's5.1', 'Entity model + alias resolver', 'Schema + resolve_entity() SDF, no UI yet.', 1, 'planned' FROM public.roadmap_phases WHERE key = 'phase-5'
ON CONFLICT (phase_id, key) DO NOTHING;
INSERT INTO public.roadmap_sprints (phase_id, key, title, goal, "order", status)
SELECT id, 's5.2', 'Resolver scoring + ancestry', 'Composite scoring, thresholds, ancestry storage decision, universal RLS helper.', 2, 'planned' FROM public.roadmap_phases WHERE key = 'phase-5'
ON CONFLICT (phase_id, key) DO NOTHING;
INSERT INTO public.roadmap_sprints (phase_id, key, title, goal, "order", status)
SELECT id, 's5.3', 'Alias lifecycle', 'Approval flow, revocation cascade, merge/split as first-class operations.', 3, 'planned' FROM public.roadmap_phases WHERE key = 'phase-5'
ON CONFLICT (phase_id, key) DO NOTHING;
INSERT INTO public.roadmap_sprints (phase_id, key, title, goal, "order", status)
SELECT id, 's6.1', 'Canonical ingest spine', 'Source adapter contract, conflict table, supersede rules.', 1, 'planned' FROM public.roadmap_phases WHERE key = 'phase-6'
ON CONFLICT (phase_id, key) DO NOTHING;
INSERT INTO public.roadmap_sprints (phase_id, key, title, goal, "order", status)
SELECT id, 's6.2', 'Source adapters', 'Connector contract + adapters for CSV/XLSX, JSON, BMS, lease PDFs, email, Telegram voice.', 2, 'planned' FROM public.roadmap_phases WHERE key = 'phase-6'
ON CONFLICT (phase_id, key) DO NOTHING;
INSERT INTO public.roadmap_sprints (phase_id, key, title, goal, "order", status)
SELECT id, 's6.3', 'Conflict layer', 'fact_conflicts, per-type tolerances, declarative conflict_rules, bulk patterns, retroactive corrections.', 3, 'planned' FROM public.roadmap_phases WHERE key = 'phase-6'
ON CONFLICT (phase_id, key) DO NOTHING;
INSERT INTO public.roadmap_sprints (phase_id, key, title, goal, "order", status)
SELECT id, 's6.4', 'PII, lawful basis, DSAR', 'Tag PII at raw, lawful basis registry, DSAR traversal, retention per source.', 4, 'planned' FROM public.roadmap_phases WHERE key = 'phase-6'
ON CONFLICT (phase_id, key) DO NOTHING;
INSERT INTO public.roadmap_sprints (phase_id, key, title, goal, "order", status)
SELECT id, 's6.5', 'RAG / unstructured', 'document_chunks + pgvector, embedding model decision, chunk strategies, hybrid search.', 5, 'planned' FROM public.roadmap_phases WHERE key = 'phase-6'
ON CONFLICT (phase_id, key) DO NOTHING;
INSERT INTO public.roadmap_sprints (phase_id, key, title, goal, "order", status)
SELECT id, 's6.6', 'Compliance hooks', 'SFG20 normaliser, BIM ISO 19650 references, Cyber Essentials audit, SECR/CSRD provenance.', 6, 'planned' FROM public.roadmap_phases WHERE key = 'phase-6'
ON CONFLICT (phase_id, key) DO NOTHING;
INSERT INTO public.roadmap_sprints (phase_id, key, title, goal, "order", status)
SELECT id, 's6b.1', 'Conflict review surface', 'Operator UI for unresolved conflicts + replay.', 1, 'planned' FROM public.roadmap_phases WHERE key = 'phase-6b'
ON CONFLICT (phase_id, key) DO NOTHING;
INSERT INTO public.roadmap_sprints (phase_id, key, title, goal, "order", status)
SELECT id, 's6b.2', 'Resolver + alias UX', '/entities tree, alias review queue, bulk re-resolve, resolver decision detail.', 2, 'planned' FROM public.roadmap_phases WHERE key = 'phase-6b'
ON CONFLICT (phase_id, key) DO NOTHING;
INSERT INTO public.roadmap_sprints (phase_id, key, title, goal, "order", status)
SELECT id, 's6b.3', 'Operator SLAs + alerts', 'Quarantine SLA, conflict SLA banners, Telegram digest, resolver health metrics.', 3, 'planned' FROM public.roadmap_phases WHERE key = 'phase-6b'
ON CONFLICT (phase_id, key) DO NOTHING;
INSERT INTO public.roadmap_sprints (phase_id, key, title, goal, "order", status)
SELECT id, 's7.1', 'Connector manifest v1', 'Manifest schema, validator, install dry-run.', 1, 'planned' FROM public.roadmap_phases WHERE key = 'phase-7'
ON CONFLICT (phase_id, key) DO NOTHING;
INSERT INTO public.roadmap_sprints (phase_id, key, title, goal, "order", status)
SELECT id, 's7.2', 'Connector SDK + certification', 'Open SDK, certification tier, versioning + upgrade flow', 2, 'planned' FROM public.roadmap_phases WHERE key = 'phase-7'
ON CONFLICT (phase_id, key) DO NOTHING;
INSERT INTO public.roadmap_sprints (phase_id, key, title, goal, "order", status)
SELECT id, 's7.3', 'Division rollup engine', 'Declarative rollup spec on parent KRs across heterogeneous divisions', 3, 'planned' FROM public.roadmap_phases WHERE key = 'phase-7'
ON CONFLICT (phase_id, key) DO NOTHING;
INSERT INTO public.roadmap_sprints (phase_id, key, title, goal, "order", status)
SELECT id, 's9.1', 'Tenant isolation audit', 'RLS sweep + per-tenant fuzz tests.', 1, 'planned' FROM public.roadmap_phases WHERE key = 'phase-9'
ON CONFLICT (phase_id, key) DO NOTHING;
INSERT INTO public.roadmap_sprints (phase_id, key, title, goal, "order", status)
SELECT id, 's9.2', 'Residency & k-anonymity', 'Per-node region pinning, cross-region guards, benchmark cohort floor', 2, 'planned' FROM public.roadmap_phases WHERE key = 'phase-9'
ON CONFLICT (phase_id, key) DO NOTHING;
INSERT INTO public.roadmap_sprints (phase_id, key, title, goal, "order", status)
SELECT id, 's9.3', 'Closed-period restatement', 'Snapshot-on-close + restatement approval flow with downstream fan-out', 3, 'planned' FROM public.roadmap_phases WHERE key = 'phase-9'
ON CONFLICT (phase_id, key) DO NOTHING;
INSERT INTO public.roadmap_sprints (phase_id, key, title, goal, "order", status)
SELECT id, 's11.1', 'Contract freeze v1', 'Pin awip-api surface, version header, deprecation policy.', 1, 'planned' FROM public.roadmap_phases WHERE key = 'phase-11'
ON CONFLICT (phase_id, key) DO NOTHING;
INSERT INTO public.roadmap_sprints (phase_id, key, title, goal, "order", status)
SELECT id, 's11.2', 'SDK + auth surface', 'TS + Python SDK, scoped tokens, OAuth client credentials', 2, 'planned' FROM public.roadmap_phases WHERE key = 'phase-11'
ON CONFLICT (phase_id, key) DO NOTHING;
INSERT INTO public.roadmap_sprints (phase_id, key, title, goal, "order", status)
SELECT id, 's11.3', 'Webhooks & rate-limits', 'Outbound webhook contract, retries, per-tenant quotas', 3, 'planned' FROM public.roadmap_phases WHERE key = 'phase-11'
ON CONFLICT (phase_id, key) DO NOTHING;

INSERT INTO public.roadmap_tasks (sprint_id, key, title, description, acceptance, module, capability_id, "order", status)
SELECT s.id, 'open-questions', 'Open questions', 'Sentinel task. Pinned notebook open-questions for this phase appear as comments here. Not counted as work.', NULL, NULL, NULL, 0, 'todo'
FROM public.roadmap_sprints s JOIN public.roadmap_phases p ON p.id = s.phase_id
WHERE p.key = 'phase-5' AND s.key = 's5.1'
ON CONFLICT (sprint_id, key) DO NOTHING;
INSERT INTO public.roadmap_tasks (sprint_id, key, title, description, acceptance, module, capability_id, "order", status)
SELECT s.id, 't1', 'tenant_nodes schema', 'Table with parent_id, kind (group/region/opco/division/site/asset), authoritative_ids jsonb, tenant_id scoping.', 'Ancestry walk to depth 6 returns in <50ms on 10k rows; RLS forbids cross-tenant select.', 'core', NULL, 1, 'todo'
FROM public.roadmap_sprints s JOIN public.roadmap_phases p ON p.id = s.phase_id
WHERE p.key = 'phase-5' AND s.key = 's5.1'
ON CONFLICT (sprint_id, key) DO NOTHING;
INSERT INTO public.roadmap_tasks (sprint_id, key, title, description, acceptance, module, capability_id, "order", status)
SELECT s.id, 't2', 'tenant_node_aliases table', 'Alias text, descriptor_kind (name/postcode/asset_code/external_id), source, approved_by, revoked_at.', 'Revocation flips revoked_at and emits a tenant_node_event row.', 'core', NULL, 2, 'todo'
FROM public.roadmap_sprints s JOIN public.roadmap_phases p ON p.id = s.phase_id
WHERE p.key = 'phase-5' AND s.key = 's5.1'
ON CONFLICT (sprint_id, key) DO NOTHING;
INSERT INTO public.roadmap_tasks (sprint_id, key, title, description, acceptance, module, capability_id, "order", status)
SELECT s.id, 't3', 'resolve_entity() function — deterministic core', 'Exact + normalised match against aliases and authoritative_ids. Returns single binding or candidate set with scores.', 'Golden-set test passes; never returns cross-tenant candidates.', 'core', NULL, 3, 'todo'
FROM public.roadmap_sprints s JOIN public.roadmap_phases p ON p.id = s.phase_id
WHERE p.key = 'phase-5' AND s.key = 's5.1'
ON CONFLICT (sprint_id, key) DO NOTHING;
INSERT INTO public.roadmap_tasks (sprint_id, key, title, description, acceptance, module, capability_id, "order", status)
SELECT s.id, 't4', 'Authoritative ID registry', 'Namespaces table for bim_ifc_guid, rics_asset_ref, os_uprn, sap_functional_loc with per-namespace match rules.', 'BIM GUID match short-circuits and beats fuzzy name match in resolver test.', 'core', NULL, 4, 'todo'
FROM public.roadmap_sprints s JOIN public.roadmap_phases p ON p.id = s.phase_id
WHERE p.key = 'phase-5' AND s.key = 's5.1'
ON CONFLICT (sprint_id, key) DO NOTHING;
INSERT INTO public.roadmap_tasks (sprint_id, key, title, description, acceptance, module, capability_id, "order", status)
SELECT s.id, 't5', 'Cross-tenant isolation test suite', 'Synthetic dataset with intentional code collisions across two tenants; CI check.', 'Zero cross-tenant proposals across full test corpus; failure breaks CI.', 'core', NULL, 5, 'todo'
FROM public.roadmap_sprints s JOIN public.roadmap_phases p ON p.id = s.phase_id
WHERE p.key = 'phase-5' AND s.key = 's5.1'
ON CONFLICT (sprint_id, key) DO NOTHING;
INSERT INTO public.roadmap_tasks (sprint_id, key, title, description, acceptance, module, capability_id, "order", status)
SELECT s.id, 't6', 'entity_resolution_conflicts table + approval activity', 'One approval per batch (not per row). Adds entity_resolution, tenant_node_create, tenant_node_merge, tenant_node_split to activity_policies.', 'Importing 14 conflicting rows from one file produces exactly one approval card.', 'core', NULL, 6, 'todo'
FROM public.roadmap_sprints s JOIN public.roadmap_phases p ON p.id = s.phase_id
WHERE p.key = 'phase-5' AND s.key = 's5.1'
ON CONFLICT (sprint_id, key) DO NOTHING;
INSERT INTO public.roadmap_tasks (sprint_id, key, title, description, acceptance, module, capability_id, "order", status)
SELECT s.id, 't1', 'Composite scorer with descriptor weights', 'Postcode 0.9 floor, free-text name 0.5, weighted sum + per-source overrides. Config in resolver_weights table.', 'Unit test: changing a weight changes the winner deterministically.', 'core', NULL, 1, 'todo'
FROM public.roadmap_sprints s JOIN public.roadmap_phases p ON p.id = s.phase_id
WHERE p.key = 'phase-5' AND s.key = 's5.2'
ON CONFLICT (sprint_id, key) DO NOTHING;
INSERT INTO public.roadmap_tasks (sprint_id, key, title, description, acceptance, module, capability_id, "order", status)
SELECT s.id, 't2', 'Score threshold defaults', 'Auto-bind >=0.92, propose 0.7-0.92, reject <0.7. Per-source overridable.', 'Thresholds editable from /admin and decision is logged in resolver_decision_log.', 'core', NULL, 2, 'todo'
FROM public.roadmap_sprints s JOIN public.roadmap_phases p ON p.id = s.phase_id
WHERE p.key = 'phase-5' AND s.key = 's5.2'
ON CONFLICT (sprint_id, key) DO NOTHING;
INSERT INTO public.roadmap_tasks (sprint_id, key, title, description, acceptance, module, capability_id, "order", status)
SELECT s.id, 't3', 'Ancestry storage decision (ADR-0003)', 'Benchmark recursive CTE vs ltree vs denormalised ancestor_ids[]; choose based on 6-level depth + RLS predicate cost.', 'ADR-0003 merged; benchmark numbers in docs/adr/0003-*.md.', 'core', NULL, 3, 'todo'
FROM public.roadmap_sprints s JOIN public.roadmap_phases p ON p.id = s.phase_id
WHERE p.key = 'phase-5' AND s.key = 's5.2'
ON CONFLICT (sprint_id, key) DO NOTHING;
INSERT INTO public.roadmap_tasks (sprint_id, key, title, description, acceptance, module, capability_id, "order", status)
SELECT s.id, 't4', 'Universal RLS predicate helper', 'has_tenant_node_access(uuid) security-definer, used by every fact table.', 'Smoke test across canonical_facts read/write passes for in-scope, fails for out-of-scope.', 'core', NULL, 4, 'todo'
FROM public.roadmap_sprints s JOIN public.roadmap_phases p ON p.id = s.phase_id
WHERE p.key = 'phase-5' AND s.key = 's5.2'
ON CONFLICT (sprint_id, key) DO NOTHING;
INSERT INTO public.roadmap_tasks (sprint_id, key, title, description, acceptance, module, capability_id, "order", status)
SELECT s.id, 't5', 'Resolver decision log', 'Every resolve call records candidate set, scores, choice, actor.', 'Visible in /db-explorer; resolver call without log row breaks CI.', 'core', NULL, 5, 'todo'
FROM public.roadmap_sprints s JOIN public.roadmap_phases p ON p.id = s.phase_id
WHERE p.key = 'phase-5' AND s.key = 's5.2'
ON CONFLICT (sprint_id, key) DO NOTHING;
INSERT INTO public.roadmap_tasks (sprint_id, key, title, description, acceptance, module, capability_id, "order", status)
SELECT s.id, 't1', 'Alias approval flow', 'Fuzzy match raises an approval with sample rows; one decision binds the batch.', 'Approving once promotes all rows from the batch; no per-row clicks.', 'core', NULL, 1, 'todo'
FROM public.roadmap_sprints s JOIN public.roadmap_phases p ON p.id = s.phase_id
WHERE p.key = 'phase-5' AND s.key = 's5.3'
ON CONFLICT (sprint_id, key) DO NOTHING;
INSERT INTO public.roadmap_tasks (sprint_id, key, title, description, acceptance, module, capability_id, "order", status)
SELECT s.id, 't2', 'Alias revocation cascade — soft flag (ADR-0004)', 'Revocation flags every fact bound via that alias as re_review; fact stays live; banner on OKR detail.', 'ADR-0004 records soft-vs-hard decision; flagged facts show banner; nothing is silently mutated.', 'core', NULL, 2, 'todo'
FROM public.roadmap_sprints s JOIN public.roadmap_phases p ON p.id = s.phase_id
WHERE p.key = 'phase-5' AND s.key = 's5.3'
ON CONFLICT (sprint_id, key) DO NOTHING;
INSERT INTO public.roadmap_tasks (sprint_id, key, title, description, acceptance, module, capability_id, "order", status)
SELECT s.id, 't3', 'Bulk re-resolve UX spec', 'Design doc only this sprint; UI lands in s6b.2.', 'Spec PR merged with mocks for the >100-row case.', 'operator_console', NULL, 3, 'todo'
FROM public.roadmap_sprints s JOIN public.roadmap_phases p ON p.id = s.phase_id
WHERE p.key = 'phase-5' AND s.key = 's5.3'
ON CONFLICT (sprint_id, key) DO NOTHING;
INSERT INTO public.roadmap_tasks (sprint_id, key, title, description, acceptance, module, capability_id, "order", status)
SELECT s.id, 't4', 'tenant_node merge/split operations', 'First-class approvals; merge unions aliases, split requires reassignment plan.', 'Merge then split round-trip preserves all aliases and emits two tenant_node_events.', 'core', NULL, 4, 'todo'
FROM public.roadmap_sprints s JOIN public.roadmap_phases p ON p.id = s.phase_id
WHERE p.key = 'phase-5' AND s.key = 's5.3'
ON CONFLICT (sprint_id, key) DO NOTHING;
INSERT INTO public.roadmap_tasks (sprint_id, key, title, description, acceptance, module, capability_id, "order", status)
SELECT s.id, 'open-questions', 'Open questions', 'Sentinel task. Pinned notebook open-questions for this phase appear as comments here. Not counted as work.', NULL, NULL, NULL, 0, 'todo'
FROM public.roadmap_sprints s JOIN public.roadmap_phases p ON p.id = s.phase_id
WHERE p.key = 'phase-6' AND s.key = 's6.1'
ON CONFLICT (sprint_id, key) DO NOTHING;
INSERT INTO public.roadmap_tasks (sprint_id, key, title, description, acceptance, module, capability_id, "order", status)
SELECT s.id, 't1', 'raw_records table', 'Append-only, source_id, payload jsonb, ingested_at, retention_class. Per-source retention from retention_settings.', 'Insert + nightly purge respect per-source retention; immutable audit row.', 'ingest', NULL, 1, 'todo'
FROM public.roadmap_sprints s JOIN public.roadmap_phases p ON p.id = s.phase_id
WHERE p.key = 'phase-6' AND s.key = 's6.1'
ON CONFLICT (sprint_id, key) DO NOTHING;
INSERT INTO public.roadmap_tasks (sprint_id, key, title, description, acceptance, module, capability_id, "order", status)
SELECT s.id, 't2', 'staged_records table', 'Typed, validated, awaiting promotion. References raw_record_id + source_mapping_id.', 'Failed validation routes row to quarantine with reason; never to canonical.', 'ingest', NULL, 2, 'todo'
FROM public.roadmap_sprints s JOIN public.roadmap_phases p ON p.id = s.phase_id
WHERE p.key = 'phase-6' AND s.key = 's6.1'
ON CONFLICT (sprint_id, key) DO NOTHING;
INSERT INTO public.roadmap_tasks (sprint_id, key, title, description, acceptance, module, capability_id, "order", status)
SELECT s.id, 't3', 'canonical_facts pattern (per fact-type)', 'Every row carries raw_record_id, source_mapping_id, tenant_node_id, promoted_at, promoted_by, superseded_by. Hard-delete forbidden.', 'Trigger blocks DELETE except via DSAR path; supersede preserves history.', 'ingest', NULL, 3, 'todo'
FROM public.roadmap_sprints s JOIN public.roadmap_phases p ON p.id = s.phase_id
WHERE p.key = 'phase-6' AND s.key = 's6.1'
ON CONFLICT (sprint_id, key) DO NOTHING;
INSERT INTO public.roadmap_tasks (sprint_id, key, title, description, acceptance, module, capability_id, "order", status)
SELECT s.id, 't4', 'source_mappings table + versioning', 'Operator-approved column->canonical field map; column drift bumps version.', 'Renamed column produces v+1 mapping awaiting approval, not silent failure.', 'ingest', NULL, 4, 'todo'
FROM public.roadmap_sprints s JOIN public.roadmap_phases p ON p.id = s.phase_id
WHERE p.key = 'phase-6' AND s.key = 's6.1'
ON CONFLICT (sprint_id, key) DO NOTHING;
INSERT INTO public.roadmap_tasks (sprint_id, key, title, description, acceptance, module, capability_id, "order", status)
SELECT s.id, 't5', 'ingest_events table', 'One event per promotion / supersede / quarantine / release.', 'Every state change observable on /events; no orphan canonical rows.', 'ingest', NULL, 5, 'todo'
FROM public.roadmap_sprints s JOIN public.roadmap_phases p ON p.id = s.phase_id
WHERE p.key = 'phase-6' AND s.key = 's6.1'
ON CONFLICT (sprint_id, key) DO NOTHING;
INSERT INTO public.roadmap_tasks (sprint_id, key, title, description, acceptance, module, capability_id, "order", status)
SELECT s.id, 't6', 'Auto-promote rule', 'Only when source_mapping approved AND validations pass AND no untagged PII. Otherwise queue.', 'PII-tagged column without lawful basis blocks promotion in test.', 'ingest', NULL, 6, 'todo'
FROM public.roadmap_sprints s JOIN public.roadmap_phases p ON p.id = s.phase_id
WHERE p.key = 'phase-6' AND s.key = 's6.1'
ON CONFLICT (sprint_id, key) DO NOTHING;
INSERT INTO public.roadmap_tasks (sprint_id, key, title, description, acceptance, module, capability_id, "order", status)
SELECT s.id, 't1', 'Source connector contract', 'Manifest fields: id, kind, schema_inference_supported, pii_classes_emitted, lawful_basis_required.', 'Manifest validated on register; missing field returns 400.', 'ingest', NULL, 1, 'todo'
FROM public.roadmap_sprints s JOIN public.roadmap_phases p ON p.id = s.phase_id
WHERE p.key = 'phase-6' AND s.key = 's6.2'
ON CONFLICT (sprint_id, key) DO NOTHING;
INSERT INTO public.roadmap_tasks (sprint_id, key, title, description, acceptance, module, capability_id, "order", status)
SELECT s.id, 't2', 'CSV/XLSX adapter', 'Multi-sheet, header-row detection, merged cells, big-file streaming.', '10MB XLSX with header in row 5 ingests without OOM.', 'ingest', NULL, 2, 'todo'
FROM public.roadmap_sprints s JOIN public.roadmap_phases p ON p.id = s.phase_id
WHERE p.key = 'phase-6' AND s.key = 's6.2'
ON CONFLICT (sprint_id, key) DO NOTHING;
INSERT INTO public.roadmap_tasks (sprint_id, key, title, description, acceptance, module, capability_id, "order", status)
SELECT s.id, 't3', 'JSON/XML feed adapter', 'Schema sample + jsonpath mapping.', 'Operator approves jsonpath map; subsequent feeds promote silently.', 'ingest', NULL, 3, 'todo'
FROM public.roadmap_sprints s JOIN public.roadmap_phases p ON p.id = s.phase_id
WHERE p.key = 'phase-6' AND s.key = 's6.2'
ON CONFLICT (sprint_id, key) DO NOTHING;
INSERT INTO public.roadmap_tasks (sprint_id, key, title, description, acceptance, module, capability_id, "order", status)
SELECT s.id, 't4', 'BMS/IoT batch adapter', 'BACnet/Modbus/MQTT capture stub; payload normalisation skill.', 'Synthetic Modbus batch lands in raw_records with unit normalisation.', 'ingest', NULL, 4, 'todo'
FROM public.roadmap_sprints s JOIN public.roadmap_phases p ON p.id = s.phase_id
WHERE p.key = 'phase-6' AND s.key = 's6.2'
ON CONFLICT (sprint_id, key) DO NOTHING;
INSERT INTO public.roadmap_tasks (sprint_id, key, title, description, acceptance, module, capability_id, "order", status)
SELECT s.id, 't5', 'Lease PDF adapter (Gemini 2.5 Pro vision)', 'Layout-aware extraction, table + signature capture, cost ceiling (degrade to 2.5 Flash above N pages).', 'Sample lease produces structured staged_records; cost ceiling triggers downgrade in test.', 'ingest', NULL, 5, 'todo'
FROM public.roadmap_sprints s JOIN public.roadmap_phases p ON p.id = s.phase_id
WHERE p.key = 'phase-6' AND s.key = 's6.2'
ON CONFLICT (sprint_id, key) DO NOTHING;
INSERT INTO public.roadmap_tasks (sprint_id, key, title, description, acceptance, module, capability_id, "order", status)
SELECT s.id, 't6', 'Email adapter (inbound webhook)', 'Postmark/SES inbound, thread reconstruction, attachment fan-out into the same ingest_run.', 'Threaded email with 2 attachments creates one ingest_run with 3 raw_records.', 'ingest', NULL, 6, 'todo'
FROM public.roadmap_sprints s JOIN public.roadmap_phases p ON p.id = s.phase_id
WHERE p.key = 'phase-6' AND s.key = 's6.2'
ON CONFLICT (sprint_id, key) DO NOTHING;
INSERT INTO public.roadmap_tasks (sprint_id, key, title, description, acceptance, module, capability_id, "order", status)
SELECT s.id, 't7', 'Telegram voice -> ingest_run bridge', 'Reuse existing transcription, route to intent classifier instead of approval queue.', 'Voice note about a new asset alias creates an alias_create approval.', 'ingest', NULL, 7, 'todo'
FROM public.roadmap_sprints s JOIN public.roadmap_phases p ON p.id = s.phase_id
WHERE p.key = 'phase-6' AND s.key = 's6.2'
ON CONFLICT (sprint_id, key) DO NOTHING;
INSERT INTO public.roadmap_tasks (sprint_id, key, title, description, acceptance, module, capability_id, "order", status)
SELECT s.id, 't1', 'fact_conflicts table', 'Existing vs incoming, materiality, tolerance breach reason.', 'Incoming row that breaches tolerance lands in fact_conflicts, not canonical.', 'ingest', NULL, 1, 'todo'
FROM public.roadmap_sprints s JOIN public.roadmap_phases p ON p.id = s.phase_id
WHERE p.key = 'phase-6' AND s.key = 's6.3'
ON CONFLICT (sprint_id, key) DO NOTHING;
INSERT INTO public.roadmap_tasks (sprint_id, key, title, description, acceptance, module, capability_id, "order", status)
SELECT s.id, 't2', 'Per-fact-type tolerance config', 'Declared on canonical schema, overridable per tenant_node.', 'Financial type tolerance 0.001; sensor type 0.05; override per tenant_node respected.', 'ingest', NULL, 2, 'todo'
FROM public.roadmap_sprints s JOIN public.roadmap_phases p ON p.id = s.phase_id
WHERE p.key = 'phase-6' AND s.key = 's6.3'
ON CONFLICT (sprint_id, key) DO NOTHING;
INSERT INTO public.roadmap_tasks (sprint_id, key, title, description, acceptance, module, capability_id, "order", status)
SELECT s.id, 't3', 'conflict_rules table (declarative precedence)', 'Versioned, revocable, emits event each fire. e.g. audit PDF wins over BMS for quarterly close.', 'Rule fire creates ingest_event with old->new diff.', 'ingest', NULL, 3, 'todo'
FROM public.roadmap_sprints s JOIN public.roadmap_phases p ON p.id = s.phase_id
WHERE p.key = 'phase-6' AND s.key = 's6.3'
ON CONFLICT (sprint_id, key) DO NOTHING;
INSERT INTO public.roadmap_tasks (sprint_id, key, title, description, acceptance, module, capability_id, "order", status)
SELECT s.id, 't4', 'Conflict resolution approval activity', 'fact_conflict_resolution added to activity_policies; supersede / reject / split / quarantine actions.', 'Each action recorded as a distinct event; rejection requires reason.', 'ingest', NULL, 4, 'todo'
FROM public.roadmap_sprints s JOIN public.roadmap_phases p ON p.id = s.phase_id
WHERE p.key = 'phase-6' AND s.key = 's6.3'
ON CONFLICT (sprint_id, key) DO NOTHING;
INSERT INTO public.roadmap_tasks (sprint_id, key, title, description, acceptance, module, capability_id, "order", status)
SELECT s.id, 't5', 'Bulk conflict pattern detection (ADR-0005)', 'Group by source_mapping + diff signature; one-click accept pattern with operator review of N samples.', '400-row pattern resolves in one click after N=5 sample approval; ADR-0005 merged.', 'ingest', NULL, 5, 'todo'
FROM public.roadmap_sprints s JOIN public.roadmap_phases p ON p.id = s.phase_id
WHERE p.key = 'phase-6' AND s.key = 's6.3'
ON CONFLICT (sprint_id, key) DO NOTHING;
INSERT INTO public.roadmap_tasks (sprint_id, key, title, description, acceptance, module, capability_id, "order", status)
SELECT s.id, 't6', 'Retroactive correction policy', 'Closed periods immutable; corrections create v+1 + restate approval kind. SECR/CSRD restatement notes captured.', 'Correcting a closed Q3 number requires restate approval and fans out an event.', 'ingest', NULL, 6, 'todo'
FROM public.roadmap_sprints s JOIN public.roadmap_phases p ON p.id = s.phase_id
WHERE p.key = 'phase-6' AND s.key = 's6.3'
ON CONFLICT (sprint_id, key) DO NOTHING;
INSERT INTO public.roadmap_tasks (sprint_id, key, title, description, acceptance, module, capability_id, "order", status)
SELECT s.id, 't7', 'Rule learning loop (deferred flag)', 'Log 5 consistent decisions candidates; do not auto-create rules yet, surface on admin.', 'Admin page shows candidate rule with provenance; no auto-creation.', 'ingest', NULL, 7, 'todo'
FROM public.roadmap_sprints s JOIN public.roadmap_phases p ON p.id = s.phase_id
WHERE p.key = 'phase-6' AND s.key = 's6.3'
ON CONFLICT (sprint_id, key) DO NOTHING;
INSERT INTO public.roadmap_tasks (sprint_id, key, title, description, acceptance, module, capability_id, "order", status)
SELECT s.id, 't1', 'PII tagging at raw_records', 'pii_classes text[] populated by source connector manifest; required before promotion of fields touching PII.', 'Connector emitting pii_classes=[email] tags rows; promotion blocks without lawful basis.', 'core', NULL, 1, 'todo'
FROM public.roadmap_sprints s JOIN public.roadmap_phases p ON p.id = s.phase_id
WHERE p.key = 'phase-6' AND s.key = 's6.4'
ON CONFLICT (sprint_id, key) DO NOTHING;
INSERT INTO public.roadmap_tasks (sprint_id, key, title, description, acceptance, module, capability_id, "order", status)
SELECT s.id, 't2', 'Lawful basis registry', 'Declared at connector setup AND optionally per ingest_run; blocks promotion otherwise.', 'Setup without lawful basis fails; per-run override recorded in ingest_event.', 'core', NULL, 2, 'todo'
FROM public.roadmap_sprints s JOIN public.roadmap_phases p ON p.id = s.phase_id
WHERE p.key = 'phase-6' AND s.key = 's6.4'
ON CONFLICT (sprint_id, key) DO NOTHING;
INSERT INTO public.roadmap_tasks (sprint_id, key, title, description, acceptance, module, capability_id, "order", status)
SELECT s.id, 't3', 'DSAR erasure traversal', 'Function walks raw_records -> staged -> canonical_facts -> document_chunks -> embeddings; tombstones, never hard-deletes audit rows.', 'DSAR for a synthetic subject removes all PII rows and leaves audit tombstones.', 'core', NULL, 3, 'todo'
FROM public.roadmap_sprints s JOIN public.roadmap_phases p ON p.id = s.phase_id
WHERE p.key = 'phase-6' AND s.key = 's6.4'
ON CONFLICT (sprint_id, key) DO NOTHING;
INSERT INTO public.roadmap_tasks (sprint_id, key, title, description, acceptance, module, capability_id, "order", status)
SELECT s.id, 't4', 'Right to rectification flow', 'Append correction event + replay; never mutate.', 'Rectification creates supersede event, original row preserved.', 'core', NULL, 4, 'todo'
FROM public.roadmap_sprints s JOIN public.roadmap_phases p ON p.id = s.phase_id
WHERE p.key = 'phase-6' AND s.key = 's6.4'
ON CONFLICT (sprint_id, key) DO NOTHING;
INSERT INTO public.roadmap_tasks (sprint_id, key, title, description, acceptance, module, capability_id, "order", status)
SELECT s.id, 't5', 'Per-source raw_records retention', 'Extends retention_settings with source_id; nightly purge job logs to automation_runs.', '30/90/365-day per-source overrides honoured by nightly purge.', 'core', NULL, 5, 'todo'
FROM public.roadmap_sprints s JOIN public.roadmap_phases p ON p.id = s.phase_id
WHERE p.key = 'phase-6' AND s.key = 's6.4'
ON CONFLICT (sprint_id, key) DO NOTHING;
INSERT INTO public.roadmap_tasks (sprint_id, key, title, description, acceptance, module, capability_id, "order", status)
SELECT s.id, 't6', 'Column-level redaction policy', 'RLS + redaction view; pgcrypto deferred unless residency demands it.', 'Non-operator role reads redacted view; operator reads raw; visible in security audit.', 'core', NULL, 6, 'todo'
FROM public.roadmap_sprints s JOIN public.roadmap_phases p ON p.id = s.phase_id
WHERE p.key = 'phase-6' AND s.key = 's6.4'
ON CONFLICT (sprint_id, key) DO NOTHING;
INSERT INTO public.roadmap_tasks (sprint_id, key, title, description, acceptance, module, capability_id, "order", status)
SELECT s.id, 't1', 'document_chunks + embeddings tables', 'pgvector, model_id, chunk_strategy, source_record_id.', 'Inserting a chunk computes embedding via Lovable AI Gateway and indexes it.', 'ingest', NULL, 1, 'todo'
FROM public.roadmap_sprints s JOIN public.roadmap_phases p ON p.id = s.phase_id
WHERE p.key = 'phase-6' AND s.key = 's6.5'
ON CONFLICT (sprint_id, key) DO NOTHING;
INSERT INTO public.roadmap_tasks (sprint_id, key, title, description, acceptance, module, capability_id, "order", status)
SELECT s.id, 't2', 'Embedding model decision (ADR-0006)', 'Gemini text-embedding-004 default; ADR covers cost vs residency vs re-embed pain.', 'ADR-0006 merged; default model wired into chunker.', 'ingest', NULL, 2, 'todo'
FROM public.roadmap_sprints s JOIN public.roadmap_phases p ON p.id = s.phase_id
WHERE p.key = 'phase-6' AND s.key = 's6.5'
ON CONFLICT (sprint_id, key) DO NOTHING;
INSERT INTO public.roadmap_tasks (sprint_id, key, title, description, acceptance, module, capability_id, "order", status)
SELECT s.id, 't3', 'Chunk strategies per source type', 'Lease PDF semantic sections, SFG20 one-per-task, email thread-aware, voice utterance.', 'Per-source-type chunker selected automatically; visible in chunk metadata.', 'ingest', NULL, 3, 'todo'
FROM public.roadmap_sprints s JOIN public.roadmap_phases p ON p.id = s.phase_id
WHERE p.key = 'phase-6' AND s.key = 's6.5'
ON CONFLICT (sprint_id, key) DO NOTHING;
INSERT INTO public.roadmap_tasks (sprint_id, key, title, description, acceptance, module, capability_id, "order", status)
SELECT s.id, 't4', 'Hybrid search (FTS + vector)', 'Postgres FTS for asset codes / SFG20 references, pgvector for semantic. Single SQL function hybrid_search().', 'Search for an asset code + semantic phrase returns merged ranked list.', 'ingest', NULL, 4, 'todo'
FROM public.roadmap_sprints s JOIN public.roadmap_phases p ON p.id = s.phase_id
WHERE p.key = 'phase-6' AND s.key = 's6.5'
ON CONFLICT (sprint_id, key) DO NOTHING;
INSERT INTO public.roadmap_tasks (sprint_id, key, title, description, acceptance, module, capability_id, "order", status)
SELECT s.id, 't5', 'Index choice', 'hnsw default; ivfflat for very large per-tenant corpora. Decision recorded per index.', 'Index choice + reasoning recorded in ingest notes.', 'ingest', NULL, 5, 'todo'
FROM public.roadmap_sprints s JOIN public.roadmap_phases p ON p.id = s.phase_id
WHERE p.key = 'phase-6' AND s.key = 's6.5'
ON CONFLICT (sprint_id, key) DO NOTHING;
INSERT INTO public.roadmap_tasks (sprint_id, key, title, description, acceptance, module, capability_id, "order", status)
SELECT s.id, 't6', 'Re-embed strategy', 'Lazy-on-read marker + nightly chunked rebuild; never block reads.', 'Model swap test: old embeddings still queryable; nightly rebuild progresses incrementally.', 'ingest', NULL, 6, 'todo'
FROM public.roadmap_sprints s JOIN public.roadmap_phases p ON p.id = s.phase_id
WHERE p.key = 'phase-6' AND s.key = 's6.5'
ON CONFLICT (sprint_id, key) DO NOTHING;
INSERT INTO public.roadmap_tasks (sprint_id, key, title, description, acceptance, module, capability_id, "order", status)
SELECT s.id, 't1', 'SFG20 task code normaliser skill', 'Accepts client-mapped codes, maps to canonical task taxonomy.', 'Mapping uplift covers >=90% of sample task codes; unmapped go to quarantine.', 'compliance', NULL, 1, 'todo'
FROM public.roadmap_sprints s JOIN public.roadmap_phases p ON p.id = s.phase_id
WHERE p.key = 'phase-6' AND s.key = 's6.6'
ON CONFLICT (sprint_id, key) DO NOTHING;
INSERT INTO public.roadmap_tasks (sprint_id, key, title, description, acceptance, module, capability_id, "order", status)
SELECT s.id, 't2', 'BIM ISO 19650 CDE references', 'Store CDE URL + asset GUID on tenant_node.authoritative_ids.', 'BIM GUID resolves via authoritative path; CDE link visible on /entities.', 'compliance', NULL, 2, 'todo'
FROM public.roadmap_sprints s JOIN public.roadmap_phases p ON p.id = s.phase_id
WHERE p.key = 'phase-6' AND s.key = 's6.6'
ON CONFLICT (sprint_id, key) DO NOTHING;
INSERT INTO public.roadmap_tasks (sprint_id, key, title, description, acceptance, module, capability_id, "order", status)
SELECT s.id, 't3', 'Cyber Essentials Plus connector audit', 'Every secret read logged to connector_audit_log.', 'Secret read by edge function produces audit row; non-operator cannot select log.', 'compliance', NULL, 3, 'todo'
FROM public.roadmap_sprints s JOIN public.roadmap_phases p ON p.id = s.phase_id
WHERE p.key = 'phase-6' AND s.key = 's6.6'
ON CONFLICT (sprint_id, key) DO NOTHING;
INSERT INTO public.roadmap_tasks (sprint_id, key, title, description, acceptance, module, capability_id, "order", status)
SELECT s.id, 't4', 'Audit pack export', 'On-demand zip of approvals, RLS map, resolver decisions for an evidence window.', 'Export for a 30-day window returns a downloadable artefact; reuses db-explorer audit.', 'compliance', NULL, 4, 'todo'
FROM public.roadmap_sprints s JOIN public.roadmap_phases p ON p.id = s.phase_id
WHERE p.key = 'phase-6' AND s.key = 's6.6'
ON CONFLICT (sprint_id, key) DO NOTHING;
INSERT INTO public.roadmap_tasks (sprint_id, key, title, description, acceptance, module, capability_id, "order", status)
SELECT s.id, 't5', 'SECR/CSRD/SBTi emission factor capture', 'DEFRA year, scope, source URL on every emissions canonical row; validation trigger blocks unsourced rows.', 'Emission row missing source URL fails validation in CI test.', 'compliance', NULL, 5, 'todo'
FROM public.roadmap_sprints s JOIN public.roadmap_phases p ON p.id = s.phase_id
WHERE p.key = 'phase-6' AND s.key = 's6.6'
ON CONFLICT (sprint_id, key) DO NOTHING;
INSERT INTO public.roadmap_tasks (sprint_id, key, title, description, acceptance, module, capability_id, "order", status)
SELECT s.id, 'open-questions', 'Open questions', 'Sentinel task. Pinned notebook open-questions for this phase appear as comments here. Not counted as work.', NULL, NULL, NULL, 0, 'todo'
FROM public.roadmap_sprints s JOIN public.roadmap_phases p ON p.id = s.phase_id
WHERE p.key = 'phase-6b' AND s.key = 's6b.1'
ON CONFLICT (sprint_id, key) DO NOTHING;
INSERT INTO public.roadmap_tasks (sprint_id, key, title, description, acceptance, module, capability_id, "order", status)
SELECT s.id, 't1', '/ingest dashboard skeleton', 'Per-source counts: incoming, staged, quarantined, conflict, promoted (24h / 7d).', 'Cards render with realtime updates; zero polling.', 'operator_console', NULL, 1, 'todo'
FROM public.roadmap_sprints s JOIN public.roadmap_phases p ON p.id = s.phase_id
WHERE p.key = 'phase-6b' AND s.key = 's6b.1'
ON CONFLICT (sprint_id, key) DO NOTHING;
INSERT INTO public.roadmap_tasks (sprint_id, key, title, description, acceptance, module, capability_id, "order", status)
SELECT s.id, 't2', 'Conflict card UI (one-row)', 'Side-by-side existing vs incoming, source provenance, decision actions.', 'Decision posts to approval_queue and updates fact_conflicts within one realtime tick.', 'operator_console', NULL, 2, 'todo'
FROM public.roadmap_sprints s JOIN public.roadmap_phases p ON p.id = s.phase_id
WHERE p.key = 'phase-6b' AND s.key = 's6b.1'
ON CONFLICT (sprint_id, key) DO NOTHING;
INSERT INTO public.roadmap_tasks (sprint_id, key, title, description, acceptance, module, capability_id, "order", status)
SELECT s.id, 't3', 'Bulk pattern card', 'Surfaces detected pattern from s6.3 t5; sample rows + accept-all.', 'Accepting pattern resolves all matching conflicts and emits one ingest_event.', 'operator_console', NULL, 3, 'todo'
FROM public.roadmap_sprints s JOIN public.roadmap_phases p ON p.id = s.phase_id
WHERE p.key = 'phase-6b' AND s.key = 's6b.1'
ON CONFLICT (sprint_id, key) DO NOTHING;
INSERT INTO public.roadmap_tasks (sprint_id, key, title, description, acceptance, module, capability_id, "order", status)
SELECT s.id, 't4', 'Quarantine inbox', 'Per-source queue, bulk-fix patterns, SLA badge.', 'Bulk-fix "infer postcode from site_id" releases matched rows; SLA badge turns red after threshold.', 'operator_console', NULL, 4, 'todo'
FROM public.roadmap_sprints s JOIN public.roadmap_phases p ON p.id = s.phase_id
WHERE p.key = 'phase-6b' AND s.key = 's6b.1'
ON CONFLICT (sprint_id, key) DO NOTHING;
INSERT INTO public.roadmap_tasks (sprint_id, key, title, description, acceptance, module, capability_id, "order", status)
SELECT s.id, 't5', 'Replay control', 'Replay an ingest_run from raw_records with current source_mapping; diff vs previous outcome.', 'Replay produces diff view; zero side effects until operator confirms.', 'operator_console', NULL, 5, 'todo'
FROM public.roadmap_sprints s JOIN public.roadmap_phases p ON p.id = s.phase_id
WHERE p.key = 'phase-6b' AND s.key = 's6b.1'
ON CONFLICT (sprint_id, key) DO NOTHING;
INSERT INTO public.roadmap_tasks (sprint_id, key, title, description, acceptance, module, capability_id, "order", status)
SELECT s.id, 't1', '/entities page', 'Tenant_node tree with alias counts, authoritative IDs, last-seen sources.', 'Tree to depth 6 renders <500ms on 10k nodes.', 'operator_console', NULL, 1, 'todo'
FROM public.roadmap_sprints s JOIN public.roadmap_phases p ON p.id = s.phase_id
WHERE p.key = 'phase-6b' AND s.key = 's6b.2'
ON CONFLICT (sprint_id, key) DO NOTHING;
INSERT INTO public.roadmap_tasks (sprint_id, key, title, description, acceptance, module, capability_id, "order", status)
SELECT s.id, 't2', 'Alias review queue', 'Fuzzy-match proposals with score breakdown; one click binds batch.', 'Approval rate visible; proposed alias with score is one click away from binding.', 'operator_console', NULL, 2, 'todo'
FROM public.roadmap_sprints s JOIN public.roadmap_phases p ON p.id = s.phase_id
WHERE p.key = 'phase-6b' AND s.key = 's6b.2'
ON CONFLICT (sprint_id, key) DO NOTHING;
INSERT INTO public.roadmap_tasks (sprint_id, key, title, description, acceptance, module, capability_id, "order", status)
SELECT s.id, 't3', 'Bulk re-resolve UI', 'Implements spec from s5.3 t3; for revoked aliases affecting >100 rows.', '100-row case completes in single operator session with progress UI.', 'operator_console', NULL, 3, 'todo'
FROM public.roadmap_sprints s JOIN public.roadmap_phases p ON p.id = s.phase_id
WHERE p.key = 'phase-6b' AND s.key = 's6b.2'
ON CONFLICT (sprint_id, key) DO NOTHING;
INSERT INTO public.roadmap_tasks (sprint_id, key, title, description, acceptance, module, capability_id, "order", status)
SELECT s.id, 't4', 'Resolver decision detail', 'Shows candidate set, scores, why winner won; linked from any canonical fact.', 'Click-through from canonical fact reaches decision in <=2 clicks.', 'operator_console', NULL, 4, 'todo'
FROM public.roadmap_sprints s JOIN public.roadmap_phases p ON p.id = s.phase_id
WHERE p.key = 'phase-6b' AND s.key = 's6b.2'
ON CONFLICT (sprint_id, key) DO NOTHING;
INSERT INTO public.roadmap_tasks (sprint_id, key, title, description, acceptance, module, capability_id, "order", status)
SELECT s.id, 't1', 'Quarantine SLA config', 'Per-tenant threshold, hours-pending alert via existing alert_settings webhook.', 'Threshold breach fires alert through existing dispatcher; visible in alert_log.', 'operator_console', NULL, 1, 'todo'
FROM public.roadmap_sprints s JOIN public.roadmap_phases p ON p.id = s.phase_id
WHERE p.key = 'phase-6b' AND s.key = 's6b.3'
ON CONFLICT (sprint_id, key) DO NOTHING;
INSERT INTO public.roadmap_tasks (sprint_id, key, title, description, acceptance, module, capability_id, "order", status)
SELECT s.id, 't2', 'Conflict SLA + OKR rollup banner', 'Pending conflict on a KR fact shows on /roadmap task detail and OKR detail.', 'Conflict older than threshold renders red banner on the affected OKR/task.', 'operator_console', NULL, 2, 'todo'
FROM public.roadmap_sprints s JOIN public.roadmap_phases p ON p.id = s.phase_id
WHERE p.key = 'phase-6b' AND s.key = 's6b.3'
ON CONFLICT (sprint_id, key) DO NOTHING;
INSERT INTO public.roadmap_tasks (sprint_id, key, title, description, acceptance, module, capability_id, "order", status)
SELECT s.id, 't3', 'Telegram digest job', 'Nightly: open conflicts, quarantined > N, aliases awaiting approval. Cron via existing automation infra.', 'Digest delivered at 07:00 UTC; logged in automation_runs.', 'operator_channel', NULL, 3, 'todo'
FROM public.roadmap_sprints s JOIN public.roadmap_phases p ON p.id = s.phase_id
WHERE p.key = 'phase-6b' AND s.key = 's6b.3'
ON CONFLICT (sprint_id, key) DO NOTHING;
INSERT INTO public.roadmap_tasks (sprint_id, key, title, description, acceptance, module, capability_id, "order", status)
SELECT s.id, 't4', 'Resolver health metrics', 'Auto-bind rate, manual-confirm rate, override rate per source. Visible on /status.', 'Metrics update daily; Status page shows trend per source.', 'operator_console', NULL, 4, 'todo'
FROM public.roadmap_sprints s JOIN public.roadmap_phases p ON p.id = s.phase_id
WHERE p.key = 'phase-6b' AND s.key = 's6b.3'
ON CONFLICT (sprint_id, key) DO NOTHING;
INSERT INTO public.roadmap_tasks (sprint_id, key, title, description, acceptance, module, capability_id, "order", status)
SELECT s.id, 'open-questions', 'Open questions', 'Sentinel task. Pinned notebook open-questions for this phase appear as comments here. Not counted as work.', NULL, NULL, NULL, 0, 'todo'
FROM public.roadmap_sprints s JOIN public.roadmap_phases p ON p.id = s.phase_id
WHERE p.key = 'phase-7' AND s.key = 's7.1'
ON CONFLICT (sprint_id, key) DO NOTHING;
INSERT INTO public.roadmap_tasks (sprint_id, key, title, description, acceptance, module, capability_id, "order", status)
SELECT s.id, 't1', 'connector_manifests table', 'Registry of connectors with name, version, vendor, scopes, status (planned/certified/community), source_type', 'Manifest row required for any connector to load; status badge surfaced in /connectors UI', 'core', NULL, 1, 'todo'
FROM public.roadmap_sprints s JOIN public.roadmap_phases p ON p.id = s.phase_id
WHERE p.key = 'phase-7' AND s.key = 's7.1'
ON CONFLICT (sprint_id, key) DO NOTHING;
INSERT INTO public.roadmap_tasks (sprint_id, key, title, description, acceptance, module, capability_id, "order", status)
SELECT s.id, 't2', 'connector_versions table', 'Semver-tracked releases per manifest with changelog and breaking-change flag', 'Installs pin to a version; breaking-change flag forces operator approval before upgrade', 'core', NULL, 2, 'todo'
FROM public.roadmap_sprints s JOIN public.roadmap_phases p ON p.id = s.phase_id
WHERE p.key = 'phase-7' AND s.key = 's7.1'
ON CONFLICT (sprint_id, key) DO NOTHING;
INSERT INTO public.roadmap_tasks (sprint_id, key, title, description, acceptance, module, capability_id, "order", status)
SELECT s.id, 't3', 'connector_installs table', 'Per-tenant install record with version, configured secrets ref, enabled flag', 'Install row scoped per tenant_id; one install per (tenant_id, manifest_id); RLS operator-only', 'core', NULL, 3, 'todo'
FROM public.roadmap_sprints s JOIN public.roadmap_phases p ON p.id = s.phase_id
WHERE p.key = 'phase-7' AND s.key = 's7.1'
ON CONFLICT (sprint_id, key) DO NOTHING;
INSERT INTO public.roadmap_tasks (sprint_id, key, title, description, acceptance, module, capability_id, "order", status)
SELECT s.id, 't4', '/connectors operator page', 'List + detail view; install/uninstall + version pin + scope review', 'Install/uninstall emits capability_event; UI shows certified vs community badge', 'operator_console', NULL, 4, 'todo'
FROM public.roadmap_sprints s JOIN public.roadmap_phases p ON p.id = s.phase_id
WHERE p.key = 'phase-7' AND s.key = 's7.1'
ON CONFLICT (sprint_id, key) DO NOTHING;
INSERT INTO public.roadmap_tasks (sprint_id, key, title, description, acceptance, module, capability_id, "order", status)
SELECT s.id, 't5', 'connector_events stream', 'Append-only events: install, upgrade, disable, secret_rotated, error', 'Every connector lifecycle change has a matching event row; visible on /connectors detail', 'core', NULL, 5, 'todo'
FROM public.roadmap_sprints s JOIN public.roadmap_phases p ON p.id = s.phase_id
WHERE p.key = 'phase-7' AND s.key = 's7.1'
ON CONFLICT (sprint_id, key) DO NOTHING;
INSERT INTO public.roadmap_tasks (sprint_id, key, title, description, acceptance, module, capability_id, "order", status)
SELECT s.id, 't1', 'TypeScript SDK package', '@awip/connector-sdk skeleton: lifecycle hooks (init, ingest, healthcheck), typed config, secret accessor', 'npm publish dry-run passes; sample echo connector builds against the SDK', 'core', NULL, 1, 'todo'
FROM public.roadmap_sprints s JOIN public.roadmap_phases p ON p.id = s.phase_id
WHERE p.key = 'phase-7' AND s.key = 's7.2'
ON CONFLICT (sprint_id, key) DO NOTHING;
INSERT INTO public.roadmap_tasks (sprint_id, key, title, description, acceptance, module, capability_id, "order", status)
SELECT s.id, 't2', 'Connector test harness', 'Local runner that exercises lifecycle hooks against a fake awip-api', 'Echo connector passes harness in CI; PR template requires harness output', 'core', NULL, 2, 'todo'
FROM public.roadmap_sprints s JOIN public.roadmap_phases p ON p.id = s.phase_id
WHERE p.key = 'phase-7' AND s.key = 's7.2'
ON CONFLICT (sprint_id, key) DO NOTHING;
INSERT INTO public.roadmap_tasks (sprint_id, key, title, description, acceptance, module, capability_id, "order", status)
SELECT s.id, 't3', 'Certification checklist', 'Markdown checklist + automated linter: scopes minimised, no plaintext secrets, healthcheck implemented, retry policy declared', 'Certified status only set when checklist + linter pass; recorded on connector_versions', 'compliance', NULL, 3, 'todo'
FROM public.roadmap_sprints s JOIN public.roadmap_phases p ON p.id = s.phase_id
WHERE p.key = 'phase-7' AND s.key = 's7.2'
ON CONFLICT (sprint_id, key) DO NOTHING;
INSERT INTO public.roadmap_tasks (sprint_id, key, title, description, acceptance, module, capability_id, "order", status)
SELECT s.id, 't4', 'Upgrade approval flow', 'Breaking-change upgrade routes via approval_queue with diff of declared scopes', 'Upgrades that change scopes require operator approval; auto-upgrade allowed only for patch versions', 'operator_console', NULL, 4, 'todo'
FROM public.roadmap_sprints s JOIN public.roadmap_phases p ON p.id = s.phase_id
WHERE p.key = 'phase-7' AND s.key = 's7.2'
ON CONFLICT (sprint_id, key) DO NOTHING;
INSERT INTO public.roadmap_tasks (sprint_id, key, title, description, acceptance, module, capability_id, "order", status)
SELECT s.id, 't5', 'Connector secret rotation', 'Per-install rotate action that pulls fresh value from secrets vault and emits secret_rotated event', 'Rotation completes without downtime; event row carries previous secret hash + new hash', 'core', NULL, 5, 'todo'
FROM public.roadmap_sprints s JOIN public.roadmap_phases p ON p.id = s.phase_id
WHERE p.key = 'phase-7' AND s.key = 's7.2'
ON CONFLICT (sprint_id, key) DO NOTHING;
INSERT INTO public.roadmap_tasks (sprint_id, key, title, description, acceptance, module, capability_id, "order", status)
SELECT s.id, 't1', 'rollup_specs table', 'Declarative parent-KR rollup: kind (sum, weighted_avg, worst_of, custom_skill), filter, denominator field', 'Spec row attached to okr_node; rollup engine refuses to compute without one', 'core', NULL, 1, 'todo'
FROM public.roadmap_sprints s JOIN public.roadmap_phases p ON p.id = s.phase_id
WHERE p.key = 'phase-7' AND s.key = 's7.3'
ON CONFLICT (sprint_id, key) DO NOTHING;
INSERT INTO public.roadmap_tasks (sprint_id, key, title, description, acceptance, module, capability_id, "order", status)
SELECT s.id, 't2', 'Denominator reconciliation', 'When divisions report metrics with different denominators (kWh/m2 vs kWh/unit), spec declares the canonical denominator + conversion', 'Reconciliation logged per division; mismatched denominators raise a fact_conflict', 'core', NULL, 2, 'todo'
FROM public.roadmap_sprints s JOIN public.roadmap_phases p ON p.id = s.phase_id
WHERE p.key = 'phase-7' AND s.key = 's7.3'
ON CONFLICT (sprint_id, key) DO NOTHING;
INSERT INTO public.roadmap_tasks (sprint_id, key, title, description, acceptance, module, capability_id, "order", status)
SELECT s.id, 't3', 'Differential cadence snapshots', 'Weekly division facts snapshot at quarterly close into immutable view consumed by central rollup', 'Snapshot rows tagged with period_id; central report cites snapshot, not live data', 'core', NULL, 3, 'todo'
FROM public.roadmap_sprints s JOIN public.roadmap_phases p ON p.id = s.phase_id
WHERE p.key = 'phase-7' AND s.key = 's7.3'
ON CONFLICT (sprint_id, key) DO NOTHING;
INSERT INTO public.roadmap_tasks (sprint_id, key, title, description, acceptance, module, capability_id, "order", status)
SELECT s.id, 't4', 'Central restatement precedence', 'Conflict_rule preset: central restatement supersedes division-published value with audit trail', 'Restatement event visible on division dashboard with original + new values', 'operator_console', NULL, 4, 'todo'
FROM public.roadmap_sprints s JOIN public.roadmap_phases p ON p.id = s.phase_id
WHERE p.key = 'phase-7' AND s.key = 's7.3'
ON CONFLICT (sprint_id, key) DO NOTHING;
INSERT INTO public.roadmap_tasks (sprint_id, key, title, description, acceptance, module, capability_id, "order", status)
SELECT s.id, 't5', 'Schema inheritance', 'Divisions inherit central canonical schema; declared extensions are additive only', 'Extension columns visible on division but invisible to sibling divisions; central rollup ignores extensions', 'core', NULL, 5, 'todo'
FROM public.roadmap_sprints s JOIN public.roadmap_phases p ON p.id = s.phase_id
WHERE p.key = 'phase-7' AND s.key = 's7.3'
ON CONFLICT (sprint_id, key) DO NOTHING;
INSERT INTO public.roadmap_tasks (sprint_id, key, title, description, acceptance, module, capability_id, "order", status)
SELECT s.id, 'open-questions', 'Open questions', 'Sentinel task. Pinned notebook open-questions for this phase appear as comments here. Not counted as work.', NULL, NULL, NULL, 0, 'todo'
FROM public.roadmap_sprints s JOIN public.roadmap_phases p ON p.id = s.phase_id
WHERE p.key = 'phase-9' AND s.key = 's9.1'
ON CONFLICT (sprint_id, key) DO NOTHING;
INSERT INTO public.roadmap_tasks (sprint_id, key, title, description, acceptance, module, capability_id, "order", status)
SELECT s.id, 't1', 'RLS audit script', 'Query enumerates every public table, asserts tenant_id or tenant_node_id RLS predicate exists', 'CI fails when a new table lands without an isolation predicate', 'core', NULL, 1, 'todo'
FROM public.roadmap_sprints s JOIN public.roadmap_phases p ON p.id = s.phase_id
WHERE p.key = 'phase-9' AND s.key = 's9.1'
ON CONFLICT (sprint_id, key) DO NOTHING;
INSERT INTO public.roadmap_tasks (sprint_id, key, title, description, acceptance, module, capability_id, "order", status)
SELECT s.id, 't2', 'Synthetic cross-tenant test pack', 'Seed two tenants with identical asset codes and run resolver, query, and rollup paths', 'Zero cross-tenant rows returned in any of N test queries; recorded in test-runs', 'core', NULL, 2, 'todo'
FROM public.roadmap_sprints s JOIN public.roadmap_phases p ON p.id = s.phase_id
WHERE p.key = 'phase-9' AND s.key = 's9.1'
ON CONFLICT (sprint_id, key) DO NOTHING;
INSERT INTO public.roadmap_tasks (sprint_id, key, title, description, acceptance, module, capability_id, "order", status)
SELECT s.id, 't3', 'Service-token scope check', 'x-awip-service-token validated against per-tenant capability allowlist before any write', 'Token scoped to tenant A cannot mutate tenant B data; attempt logged + alert fires', 'core', NULL, 3, 'todo'
FROM public.roadmap_sprints s JOIN public.roadmap_phases p ON p.id = s.phase_id
WHERE p.key = 'phase-9' AND s.key = 's9.1'
ON CONFLICT (sprint_id, key) DO NOTHING;
INSERT INTO public.roadmap_tasks (sprint_id, key, title, description, acceptance, module, capability_id, "order", status)
SELECT s.id, 't4', 'Cross-tenant near-miss metric', 'Count resolver/query paths that returned a candidate from another tenant before the filter', 'Metric exposed on /entities; >0 over a window triggers alert', 'operator_console', NULL, 4, 'todo'
FROM public.roadmap_sprints s JOIN public.roadmap_phases p ON p.id = s.phase_id
WHERE p.key = 'phase-9' AND s.key = 's9.1'
ON CONFLICT (sprint_id, key) DO NOTHING;
INSERT INTO public.roadmap_tasks (sprint_id, key, title, description, acceptance, module, capability_id, "order", status)
SELECT s.id, 't5', 'Audit pack export', 'One-click export: RLS coverage, last test-run, near-miss counts, secrets posture', 'Pack downloads as a zip with markdown + json; referenced from /roadmap', 'compliance', NULL, 5, 'todo'
FROM public.roadmap_sprints s JOIN public.roadmap_phases p ON p.id = s.phase_id
WHERE p.key = 'phase-9' AND s.key = 's9.1'
ON CONFLICT (sprint_id, key) DO NOTHING;
INSERT INTO public.roadmap_tasks (sprint_id, key, title, description, acceptance, module, capability_id, "order", status)
SELECT s.id, 't1', 'tenant_node region pinning', 'Add region column on tenant_nodes; resolver and query refuse cross-region results without explicit policy', 'Cross-region query without policy returns 403 with structured reason', 'core', NULL, 1, 'todo'
FROM public.roadmap_sprints s JOIN public.roadmap_phases p ON p.id = s.phase_id
WHERE p.key = 'phase-9' AND s.key = 's9.2'
ON CONFLICT (sprint_id, key) DO NOTHING;
INSERT INTO public.roadmap_tasks (sprint_id, key, title, description, acceptance, module, capability_id, "order", status)
SELECT s.id, 't2', 'Residency policy table', 'Per-tenant policy: allow, redact, or deny for each (source_region, target_region) pair', 'Policy enforced in awip-api middleware; change requires operator approval', 'core', NULL, 2, 'todo'
FROM public.roadmap_sprints s JOIN public.roadmap_phases p ON p.id = s.phase_id
WHERE p.key = 'phase-9' AND s.key = 's9.2'
ON CONFLICT (sprint_id, key) DO NOTHING;
INSERT INTO public.roadmap_tasks (sprint_id, key, title, description, acceptance, module, capability_id, "order", status)
SELECT s.id, 't3', 'k-anonymity floor', 'Cross-division benchmark queries refuse to return cohorts smaller than configured k', 'Default k=5; per-tenant override; refusal returns generic reason without leaking cohort size', 'core', NULL, 3, 'todo'
FROM public.roadmap_sprints s JOIN public.roadmap_phases p ON p.id = s.phase_id
WHERE p.key = 'phase-9' AND s.key = 's9.2'
ON CONFLICT (sprint_id, key) DO NOTHING;
INSERT INTO public.roadmap_tasks (sprint_id, key, title, description, acceptance, module, capability_id, "order", status)
SELECT s.id, 't4', 'Region-aware storage paths', 'Embeddings + raw_records partitioned by region; cross-region read requires policy', 'Storage path includes region prefix; CI verifies no row crosses the boundary', 'core', NULL, 4, 'todo'
FROM public.roadmap_sprints s JOIN public.roadmap_phases p ON p.id = s.phase_id
WHERE p.key = 'phase-9' AND s.key = 's9.2'
ON CONFLICT (sprint_id, key) DO NOTHING;
INSERT INTO public.roadmap_tasks (sprint_id, key, title, description, acceptance, module, capability_id, "order", status)
SELECT s.id, 't5', 'Residency banner', 'Operator console shows current region context + active policy on every page header', 'Banner reflects the resolved region for the loaded tenant_node', 'operator_console', NULL, 5, 'todo'
FROM public.roadmap_sprints s JOIN public.roadmap_phases p ON p.id = s.phase_id
WHERE p.key = 'phase-9' AND s.key = 's9.2'
ON CONFLICT (sprint_id, key) DO NOTHING;
INSERT INTO public.roadmap_tasks (sprint_id, key, title, description, acceptance, module, capability_id, "order", status)
SELECT s.id, 't1', 'period_snapshots table', 'Immutable snapshot per (tenant_id, period_id, okr_node_id) with values + source provenance', 'Closing a period writes the snapshot; subsequent reads of closed period serve from snapshot', 'core', NULL, 1, 'todo'
FROM public.roadmap_sprints s JOIN public.roadmap_phases p ON p.id = s.phase_id
WHERE p.key = 'phase-9' AND s.key = 's9.3'
ON CONFLICT (sprint_id, key) DO NOTHING;
INSERT INTO public.roadmap_tasks (sprint_id, key, title, description, acceptance, module, capability_id, "order", status)
SELECT s.id, 't2', 'restatement approval activity', 'New approval_queue.activity = restate_closed_period with diff + downstream fan-out preview', 'Approval shows affected reports + external consumers before commit', 'core', NULL, 2, 'todo'
FROM public.roadmap_sprints s JOIN public.roadmap_phases p ON p.id = s.phase_id
WHERE p.key = 'phase-9' AND s.key = 's9.3'
ON CONFLICT (sprint_id, key) DO NOTHING;
INSERT INTO public.roadmap_tasks (sprint_id, key, title, description, acceptance, module, capability_id, "order", status)
SELECT s.id, 't3', 'Downstream consumer registry', 'Per-tenant registry of external report consumers (IFRS, CSRD, SBTi, regulator) with notify channels', 'Restatement approval pings every registered consumer; delivery status logged', 'compliance', NULL, 3, 'todo'
FROM public.roadmap_sprints s JOIN public.roadmap_phases p ON p.id = s.phase_id
WHERE p.key = 'phase-9' AND s.key = 's9.3'
ON CONFLICT (sprint_id, key) DO NOTHING;
INSERT INTO public.roadmap_tasks (sprint_id, key, title, description, acceptance, module, capability_id, "order", status)
SELECT s.id, 't4', 'Period v+1 versioning', 'Restatement creates a v+1 period that supersedes the closed snapshot; v0 retained read-only', 'OKR detail page shows version history with reason and approver', 'core', NULL, 4, 'todo'
FROM public.roadmap_sprints s JOIN public.roadmap_phases p ON p.id = s.phase_id
WHERE p.key = 'phase-9' AND s.key = 's9.3'
ON CONFLICT (sprint_id, key) DO NOTHING;
INSERT INTO public.roadmap_tasks (sprint_id, key, title, description, acceptance, module, capability_id, "order", status)
SELECT s.id, 't5', 'IFRS/CSRD restatement encoding', 'Encode regulator-specific restatement rules as conflict_rule presets', 'Selecting a regulator at tenant level loads the preset; presets are revocable + versioned', 'compliance', NULL, 5, 'todo'
FROM public.roadmap_sprints s JOIN public.roadmap_phases p ON p.id = s.phase_id
WHERE p.key = 'phase-9' AND s.key = 's9.3'
ON CONFLICT (sprint_id, key) DO NOTHING;
INSERT INTO public.roadmap_tasks (sprint_id, key, title, description, acceptance, module, capability_id, "order", status)
SELECT s.id, 'open-questions', 'Open questions', 'Sentinel task. Pinned notebook open-questions for this phase appear as comments here. Not counted as work.', NULL, NULL, NULL, 0, 'todo'
FROM public.roadmap_sprints s JOIN public.roadmap_phases p ON p.id = s.phase_id
WHERE p.key = 'phase-11' AND s.key = 's11.1'
ON CONFLICT (sprint_id, key) DO NOTHING;
INSERT INTO public.roadmap_tasks (sprint_id, key, title, description, acceptance, module, capability_id, "order", status)
SELECT s.id, 't1', 'OpenAPI 3.1 spec for awip-api', 'Generate spec from edge function routes; cover OKR, capability, approval, ingest, entity endpoints', 'Spec lints clean; checked into repo; published at /api/openapi.json', 'core', NULL, 1, 'todo'
FROM public.roadmap_sprints s JOIN public.roadmap_phases p ON p.id = s.phase_id
WHERE p.key = 'phase-11' AND s.key = 's11.1'
ON CONFLICT (sprint_id, key) DO NOTHING;
INSERT INTO public.roadmap_tasks (sprint_id, key, title, description, acceptance, module, capability_id, "order", status)
SELECT s.id, 't2', 'Versioned URL prefix', '/v1 prefix added to awip-api with backwards-compat shim for unprefixed legacy routes (deprecation header)', 'Legacy routes return Sunset header; v1 is the canonical contract', 'core', NULL, 2, 'todo'
FROM public.roadmap_sprints s JOIN public.roadmap_phases p ON p.id = s.phase_id
WHERE p.key = 'phase-11' AND s.key = 's11.1'
ON CONFLICT (sprint_id, key) DO NOTHING;
INSERT INTO public.roadmap_tasks (sprint_id, key, title, description, acceptance, module, capability_id, "order", status)
SELECT s.id, 't3', 'Idempotency-Key contract test', 'Test pack replays every write endpoint twice with the same key + asserts identical response + single side-effect', 'Failures block release; results recorded in test_runs', 'core', NULL, 3, 'todo'
FROM public.roadmap_sprints s JOIN public.roadmap_phases p ON p.id = s.phase_id
WHERE p.key = 'phase-11' AND s.key = 's11.1'
ON CONFLICT (sprint_id, key) DO NOTHING;
INSERT INTO public.roadmap_tasks (sprint_id, key, title, description, acceptance, module, capability_id, "order", status)
SELECT s.id, 't4', 'Error envelope standard', 'Uniform error shape: code, message, hint, request_id; documented in api.md', 'Every endpoint returns the envelope on 4xx/5xx; lint check in CI', 'core', NULL, 4, 'todo'
FROM public.roadmap_sprints s JOIN public.roadmap_phases p ON p.id = s.phase_id
WHERE p.key = 'phase-11' AND s.key = 's11.1'
ON CONFLICT (sprint_id, key) DO NOTHING;
INSERT INTO public.roadmap_tasks (sprint_id, key, title, description, acceptance, module, capability_id, "order", status)
SELECT s.id, 't5', 'Contract changelog', '/v1 changelog file with semver entries; CI fails on uncategorised contract diff', 'PR touching openapi.json requires changelog entry', 'core', NULL, 5, 'todo'
FROM public.roadmap_sprints s JOIN public.roadmap_phases p ON p.id = s.phase_id
WHERE p.key = 'phase-11' AND s.key = 's11.1'
ON CONFLICT (sprint_id, key) DO NOTHING;
INSERT INTO public.roadmap_tasks (sprint_id, key, title, description, acceptance, module, capability_id, "order", status)
SELECT s.id, 't1', 'TypeScript SDK', '@awip/sdk-ts generated from OpenAPI; typed clients for OKR, capability, approval, ingest, entity', 'npm publish dry-run passes; quickstart in docs runs end-to-end', 'core', NULL, 1, 'todo'
FROM public.roadmap_sprints s JOIN public.roadmap_phases p ON p.id = s.phase_id
WHERE p.key = 'phase-11' AND s.key = 's11.2'
ON CONFLICT (sprint_id, key) DO NOTHING;
INSERT INTO public.roadmap_tasks (sprint_id, key, title, description, acceptance, module, capability_id, "order", status)
SELECT s.id, 't2', 'Python SDK', '@awip/sdk-py generated from OpenAPI with async client', 'PyPI dry-run passes; quickstart matches TS parity', 'core', NULL, 2, 'todo'
FROM public.roadmap_sprints s JOIN public.roadmap_phases p ON p.id = s.phase_id
WHERE p.key = 'phase-11' AND s.key = 's11.2'
ON CONFLICT (sprint_id, key) DO NOTHING;
INSERT INTO public.roadmap_tasks (sprint_id, key, title, description, acceptance, module, capability_id, "order", status)
SELECT s.id, 't3', 'Scoped API tokens', 'Per-tenant tokens with capability + table scopes, expiry, rotation; stored hashed', 'Token cannot exceed declared scopes; rotation emits event; expired tokens 401', 'core', NULL, 3, 'todo'
FROM public.roadmap_sprints s JOIN public.roadmap_phases p ON p.id = s.phase_id
WHERE p.key = 'phase-11' AND s.key = 's11.2'
ON CONFLICT (sprint_id, key) DO NOTHING;
INSERT INTO public.roadmap_tasks (sprint_id, key, title, description, acceptance, module, capability_id, "order", status)
SELECT s.id, 't4', 'OAuth client credentials', 'Client credentials grant for machine-to-machine; client + secret per integration', 'Token endpoint returns short-lived JWT; integration recorded in capability_events', 'core', NULL, 4, 'todo'
FROM public.roadmap_sprints s JOIN public.roadmap_phases p ON p.id = s.phase_id
WHERE p.key = 'phase-11' AND s.key = 's11.2'
ON CONFLICT (sprint_id, key) DO NOTHING;
INSERT INTO public.roadmap_tasks (sprint_id, key, title, description, acceptance, module, capability_id, "order", status)
SELECT s.id, 't5', 'SDK examples + quickstart', 'Worked examples: create OKR, register capability, approve activity, ingest CSV', 'Examples runnable from clean machine following docs/api.md', 'core', NULL, 5, 'todo'
FROM public.roadmap_sprints s JOIN public.roadmap_phases p ON p.id = s.phase_id
WHERE p.key = 'phase-11' AND s.key = 's11.2'
ON CONFLICT (sprint_id, key) DO NOTHING;
INSERT INTO public.roadmap_tasks (sprint_id, key, title, description, acceptance, module, capability_id, "order", status)
SELECT s.id, 't1', 'outbound_webhooks table', 'Per-tenant subscriptions: event_type filter, target_url, signing secret, active flag', 'Subscription create/delete emits capability_event; secrets stored hashed', 'core', NULL, 1, 'todo'
FROM public.roadmap_sprints s JOIN public.roadmap_phases p ON p.id = s.phase_id
WHERE p.key = 'phase-11' AND s.key = 's11.3'
ON CONFLICT (sprint_id, key) DO NOTHING;
INSERT INTO public.roadmap_tasks (sprint_id, key, title, description, acceptance, module, capability_id, "order", status)
SELECT s.id, 't2', 'Webhook delivery worker', 'Edge function dispatches matching events; HMAC-SHA256 signature header', 'Successful delivery logged with status + duration; idempotent retries on 5xx', 'core', NULL, 2, 'todo'
FROM public.roadmap_sprints s JOIN public.roadmap_phases p ON p.id = s.phase_id
WHERE p.key = 'phase-11' AND s.key = 's11.3'
ON CONFLICT (sprint_id, key) DO NOTHING;
INSERT INTO public.roadmap_tasks (sprint_id, key, title, description, acceptance, module, capability_id, "order", status)
SELECT s.id, 't3', 'Retry + dead-letter', 'Exponential backoff up to N attempts; failed deliveries land in webhook_dead_letters with replay action', 'Operator can replay from dead-letter UI; replay emits new delivery row', 'operator_console', NULL, 3, 'todo'
FROM public.roadmap_sprints s JOIN public.roadmap_phases p ON p.id = s.phase_id
WHERE p.key = 'phase-11' AND s.key = 's11.3'
ON CONFLICT (sprint_id, key) DO NOTHING;
INSERT INTO public.roadmap_tasks (sprint_id, key, title, description, acceptance, module, capability_id, "order", status)
SELECT s.id, 't4', 'Per-tenant rate limits', 'Token-bucket rate limit per tenant + per route family; 429 with Retry-After', 'Limits configurable per tenant; breaches counted on /roadmap automation panel', 'core', NULL, 4, 'todo'
FROM public.roadmap_sprints s JOIN public.roadmap_phases p ON p.id = s.phase_id
WHERE p.key = 'phase-11' AND s.key = 's11.3'
ON CONFLICT (sprint_id, key) DO NOTHING;
INSERT INTO public.roadmap_tasks (sprint_id, key, title, description, acceptance, module, capability_id, "order", status)
SELECT s.id, 't5', 'Webhook signing docs', 'Public docs: payload shape, signature verification snippets in TS + Python', 'Signed payload verifies using docs snippet on first try', 'core', NULL, 5, 'todo'
FROM public.roadmap_sprints s JOIN public.roadmap_phases p ON p.id = s.phase_id
WHERE p.key = 'phase-11' AND s.key = 's11.3'
ON CONFLICT (sprint_id, key) DO NOTHING;

-- Resolve blocked_by dependencies via (sprint_key, task_key) lookups
UPDATE public.roadmap_tasks SET blocked_by = ARRAY(
  SELECT t2.id FROM public.roadmap_tasks t2
  JOIN public.roadmap_sprints s2 ON s2.id = t2.sprint_id
  WHERE (s2.key, t2.key) IN (('s5.1', 't1'))
)
WHERE id = (
  SELECT t.id FROM public.roadmap_tasks t
  JOIN public.roadmap_sprints s ON s.id = t.sprint_id
  JOIN public.roadmap_phases p ON p.id = s.phase_id
  WHERE p.key = 'phase-5' AND s.key = 's5.1' AND t.key = 't2'
);
UPDATE public.roadmap_tasks SET blocked_by = ARRAY(
  SELECT t2.id FROM public.roadmap_tasks t2
  JOIN public.roadmap_sprints s2 ON s2.id = t2.sprint_id
  WHERE (s2.key, t2.key) IN (('s5.1', 't2'))
)
WHERE id = (
  SELECT t.id FROM public.roadmap_tasks t
  JOIN public.roadmap_sprints s ON s.id = t.sprint_id
  JOIN public.roadmap_phases p ON p.id = s.phase_id
  WHERE p.key = 'phase-5' AND s.key = 's5.1' AND t.key = 't3'
);
UPDATE public.roadmap_tasks SET blocked_by = ARRAY(
  SELECT t2.id FROM public.roadmap_tasks t2
  JOIN public.roadmap_sprints s2 ON s2.id = t2.sprint_id
  WHERE (s2.key, t2.key) IN (('s5.1', 't3'))
)
WHERE id = (
  SELECT t.id FROM public.roadmap_tasks t
  JOIN public.roadmap_sprints s ON s.id = t.sprint_id
  JOIN public.roadmap_phases p ON p.id = s.phase_id
  WHERE p.key = 'phase-5' AND s.key = 's5.1' AND t.key = 't4'
);
UPDATE public.roadmap_tasks SET blocked_by = ARRAY(
  SELECT t2.id FROM public.roadmap_tasks t2
  JOIN public.roadmap_sprints s2 ON s2.id = t2.sprint_id
  WHERE (s2.key, t2.key) IN (('s5.1', 't3'))
)
WHERE id = (
  SELECT t.id FROM public.roadmap_tasks t
  JOIN public.roadmap_sprints s ON s.id = t.sprint_id
  JOIN public.roadmap_phases p ON p.id = s.phase_id
  WHERE p.key = 'phase-5' AND s.key = 's5.1' AND t.key = 't5'
);
UPDATE public.roadmap_tasks SET blocked_by = ARRAY(
  SELECT t2.id FROM public.roadmap_tasks t2
  JOIN public.roadmap_sprints s2 ON s2.id = t2.sprint_id
  WHERE (s2.key, t2.key) IN (('s5.1', 't3'))
)
WHERE id = (
  SELECT t.id FROM public.roadmap_tasks t
  JOIN public.roadmap_sprints s ON s.id = t.sprint_id
  JOIN public.roadmap_phases p ON p.id = s.phase_id
  WHERE p.key = 'phase-5' AND s.key = 's5.1' AND t.key = 't6'
);
UPDATE public.roadmap_tasks SET blocked_by = ARRAY(
  SELECT t2.id FROM public.roadmap_tasks t2
  JOIN public.roadmap_sprints s2 ON s2.id = t2.sprint_id
  WHERE (s2.key, t2.key) IN (('s5.1', 't3'))
)
WHERE id = (
  SELECT t.id FROM public.roadmap_tasks t
  JOIN public.roadmap_sprints s ON s.id = t.sprint_id
  JOIN public.roadmap_phases p ON p.id = s.phase_id
  WHERE p.key = 'phase-5' AND s.key = 's5.2' AND t.key = 't1'
);
UPDATE public.roadmap_tasks SET blocked_by = ARRAY(
  SELECT t2.id FROM public.roadmap_tasks t2
  JOIN public.roadmap_sprints s2 ON s2.id = t2.sprint_id
  WHERE (s2.key, t2.key) IN (('s5.2', 't1'))
)
WHERE id = (
  SELECT t.id FROM public.roadmap_tasks t
  JOIN public.roadmap_sprints s ON s.id = t.sprint_id
  JOIN public.roadmap_phases p ON p.id = s.phase_id
  WHERE p.key = 'phase-5' AND s.key = 's5.2' AND t.key = 't2'
);
UPDATE public.roadmap_tasks SET blocked_by = ARRAY(
  SELECT t2.id FROM public.roadmap_tasks t2
  JOIN public.roadmap_sprints s2 ON s2.id = t2.sprint_id
  WHERE (s2.key, t2.key) IN (('s5.1', 't1'))
)
WHERE id = (
  SELECT t.id FROM public.roadmap_tasks t
  JOIN public.roadmap_sprints s ON s.id = t.sprint_id
  JOIN public.roadmap_phases p ON p.id = s.phase_id
  WHERE p.key = 'phase-5' AND s.key = 's5.2' AND t.key = 't4'
);
UPDATE public.roadmap_tasks SET blocked_by = ARRAY(
  SELECT t2.id FROM public.roadmap_tasks t2
  JOIN public.roadmap_sprints s2 ON s2.id = t2.sprint_id
  WHERE (s2.key, t2.key) IN (('s5.2', 't1'))
)
WHERE id = (
  SELECT t.id FROM public.roadmap_tasks t
  JOIN public.roadmap_sprints s ON s.id = t.sprint_id
  JOIN public.roadmap_phases p ON p.id = s.phase_id
  WHERE p.key = 'phase-5' AND s.key = 's5.2' AND t.key = 't5'
);
UPDATE public.roadmap_tasks SET blocked_by = ARRAY(
  SELECT t2.id FROM public.roadmap_tasks t2
  JOIN public.roadmap_sprints s2 ON s2.id = t2.sprint_id
  WHERE (s2.key, t2.key) IN (('s5.2', 't5'), ('s5.1', 't6'))
)
WHERE id = (
  SELECT t.id FROM public.roadmap_tasks t
  JOIN public.roadmap_sprints s ON s.id = t.sprint_id
  JOIN public.roadmap_phases p ON p.id = s.phase_id
  WHERE p.key = 'phase-5' AND s.key = 's5.3' AND t.key = 't1'
);
UPDATE public.roadmap_tasks SET blocked_by = ARRAY(
  SELECT t2.id FROM public.roadmap_tasks t2
  JOIN public.roadmap_sprints s2 ON s2.id = t2.sprint_id
  WHERE (s2.key, t2.key) IN (('s5.3', 't1'))
)
WHERE id = (
  SELECT t.id FROM public.roadmap_tasks t
  JOIN public.roadmap_sprints s ON s.id = t.sprint_id
  JOIN public.roadmap_phases p ON p.id = s.phase_id
  WHERE p.key = 'phase-5' AND s.key = 's5.3' AND t.key = 't2'
);
UPDATE public.roadmap_tasks SET blocked_by = ARRAY(
  SELECT t2.id FROM public.roadmap_tasks t2
  JOIN public.roadmap_sprints s2 ON s2.id = t2.sprint_id
  WHERE (s2.key, t2.key) IN (('s5.2', 't1'))
)
WHERE id = (
  SELECT t.id FROM public.roadmap_tasks t
  JOIN public.roadmap_sprints s ON s.id = t.sprint_id
  JOIN public.roadmap_phases p ON p.id = s.phase_id
  WHERE p.key = 'phase-5' AND s.key = 's5.3' AND t.key = 't3'
);
UPDATE public.roadmap_tasks SET blocked_by = ARRAY(
  SELECT t2.id FROM public.roadmap_tasks t2
  JOIN public.roadmap_sprints s2 ON s2.id = t2.sprint_id
  WHERE (s2.key, t2.key) IN (('s5.3', 't1'), ('s5.1', 't1'))
)
WHERE id = (
  SELECT t.id FROM public.roadmap_tasks t
  JOIN public.roadmap_sprints s ON s.id = t.sprint_id
  JOIN public.roadmap_phases p ON p.id = s.phase_id
  WHERE p.key = 'phase-5' AND s.key = 's5.3' AND t.key = 't4'
);
UPDATE public.roadmap_tasks SET blocked_by = ARRAY(
  SELECT t2.id FROM public.roadmap_tasks t2
  JOIN public.roadmap_sprints s2 ON s2.id = t2.sprint_id
  WHERE (s2.key, t2.key) IN (('s6.1', 't1'))
)
WHERE id = (
  SELECT t.id FROM public.roadmap_tasks t
  JOIN public.roadmap_sprints s ON s.id = t.sprint_id
  JOIN public.roadmap_phases p ON p.id = s.phase_id
  WHERE p.key = 'phase-6' AND s.key = 's6.1' AND t.key = 't2'
);
UPDATE public.roadmap_tasks SET blocked_by = ARRAY(
  SELECT t2.id FROM public.roadmap_tasks t2
  JOIN public.roadmap_sprints s2 ON s2.id = t2.sprint_id
  WHERE (s2.key, t2.key) IN (('s6.1', 't2'))
)
WHERE id = (
  SELECT t.id FROM public.roadmap_tasks t
  JOIN public.roadmap_sprints s ON s.id = t.sprint_id
  JOIN public.roadmap_phases p ON p.id = s.phase_id
  WHERE p.key = 'phase-6' AND s.key = 's6.1' AND t.key = 't3'
);
UPDATE public.roadmap_tasks SET blocked_by = ARRAY(
  SELECT t2.id FROM public.roadmap_tasks t2
  JOIN public.roadmap_sprints s2 ON s2.id = t2.sprint_id
  WHERE (s2.key, t2.key) IN (('s6.1', 't1'), ('s6.1', 't2'))
)
WHERE id = (
  SELECT t.id FROM public.roadmap_tasks t
  JOIN public.roadmap_sprints s ON s.id = t.sprint_id
  JOIN public.roadmap_phases p ON p.id = s.phase_id
  WHERE p.key = 'phase-6' AND s.key = 's6.1' AND t.key = 't4'
);
UPDATE public.roadmap_tasks SET blocked_by = ARRAY(
  SELECT t2.id FROM public.roadmap_tasks t2
  JOIN public.roadmap_sprints s2 ON s2.id = t2.sprint_id
  WHERE (s2.key, t2.key) IN (('s6.1', 't1'))
)
WHERE id = (
  SELECT t.id FROM public.roadmap_tasks t
  JOIN public.roadmap_sprints s ON s.id = t.sprint_id
  JOIN public.roadmap_phases p ON p.id = s.phase_id
  WHERE p.key = 'phase-6' AND s.key = 's6.1' AND t.key = 't5'
);
UPDATE public.roadmap_tasks SET blocked_by = ARRAY(
  SELECT t2.id FROM public.roadmap_tasks t2
  JOIN public.roadmap_sprints s2 ON s2.id = t2.sprint_id
  WHERE (s2.key, t2.key) IN (('s6.1', 't3'), ('s6.1', 't4'))
)
WHERE id = (
  SELECT t.id FROM public.roadmap_tasks t
  JOIN public.roadmap_sprints s ON s.id = t.sprint_id
  JOIN public.roadmap_phases p ON p.id = s.phase_id
  WHERE p.key = 'phase-6' AND s.key = 's6.1' AND t.key = 't6'
);
UPDATE public.roadmap_tasks SET blocked_by = ARRAY(
  SELECT t2.id FROM public.roadmap_tasks t2
  JOIN public.roadmap_sprints s2 ON s2.id = t2.sprint_id
  WHERE (s2.key, t2.key) IN (('s6.1', 't1'), ('s6.1', 't2'))
)
WHERE id = (
  SELECT t.id FROM public.roadmap_tasks t
  JOIN public.roadmap_sprints s ON s.id = t.sprint_id
  JOIN public.roadmap_phases p ON p.id = s.phase_id
  WHERE p.key = 'phase-6' AND s.key = 's6.2' AND t.key = 't1'
);
UPDATE public.roadmap_tasks SET blocked_by = ARRAY(
  SELECT t2.id FROM public.roadmap_tasks t2
  JOIN public.roadmap_sprints s2 ON s2.id = t2.sprint_id
  WHERE (s2.key, t2.key) IN (('s6.2', 't1'))
)
WHERE id = (
  SELECT t.id FROM public.roadmap_tasks t
  JOIN public.roadmap_sprints s ON s.id = t.sprint_id
  JOIN public.roadmap_phases p ON p.id = s.phase_id
  WHERE p.key = 'phase-6' AND s.key = 's6.2' AND t.key = 't2'
);
UPDATE public.roadmap_tasks SET blocked_by = ARRAY(
  SELECT t2.id FROM public.roadmap_tasks t2
  JOIN public.roadmap_sprints s2 ON s2.id = t2.sprint_id
  WHERE (s2.key, t2.key) IN (('s6.2', 't1'))
)
WHERE id = (
  SELECT t.id FROM public.roadmap_tasks t
  JOIN public.roadmap_sprints s ON s.id = t.sprint_id
  JOIN public.roadmap_phases p ON p.id = s.phase_id
  WHERE p.key = 'phase-6' AND s.key = 's6.2' AND t.key = 't3'
);
UPDATE public.roadmap_tasks SET blocked_by = ARRAY(
  SELECT t2.id FROM public.roadmap_tasks t2
  JOIN public.roadmap_sprints s2 ON s2.id = t2.sprint_id
  WHERE (s2.key, t2.key) IN (('s6.2', 't1'))
)
WHERE id = (
  SELECT t.id FROM public.roadmap_tasks t
  JOIN public.roadmap_sprints s ON s.id = t.sprint_id
  JOIN public.roadmap_phases p ON p.id = s.phase_id
  WHERE p.key = 'phase-6' AND s.key = 's6.2' AND t.key = 't4'
);
UPDATE public.roadmap_tasks SET blocked_by = ARRAY(
  SELECT t2.id FROM public.roadmap_tasks t2
  JOIN public.roadmap_sprints s2 ON s2.id = t2.sprint_id
  WHERE (s2.key, t2.key) IN (('s6.2', 't1'))
)
WHERE id = (
  SELECT t.id FROM public.roadmap_tasks t
  JOIN public.roadmap_sprints s ON s.id = t.sprint_id
  JOIN public.roadmap_phases p ON p.id = s.phase_id
  WHERE p.key = 'phase-6' AND s.key = 's6.2' AND t.key = 't5'
);
UPDATE public.roadmap_tasks SET blocked_by = ARRAY(
  SELECT t2.id FROM public.roadmap_tasks t2
  JOIN public.roadmap_sprints s2 ON s2.id = t2.sprint_id
  WHERE (s2.key, t2.key) IN (('s6.2', 't1'))
)
WHERE id = (
  SELECT t.id FROM public.roadmap_tasks t
  JOIN public.roadmap_sprints s ON s.id = t.sprint_id
  JOIN public.roadmap_phases p ON p.id = s.phase_id
  WHERE p.key = 'phase-6' AND s.key = 's6.2' AND t.key = 't6'
);
UPDATE public.roadmap_tasks SET blocked_by = ARRAY(
  SELECT t2.id FROM public.roadmap_tasks t2
  JOIN public.roadmap_sprints s2 ON s2.id = t2.sprint_id
  WHERE (s2.key, t2.key) IN (('s6.2', 't1'))
)
WHERE id = (
  SELECT t.id FROM public.roadmap_tasks t
  JOIN public.roadmap_sprints s ON s.id = t.sprint_id
  JOIN public.roadmap_phases p ON p.id = s.phase_id
  WHERE p.key = 'phase-6' AND s.key = 's6.2' AND t.key = 't7'
);
UPDATE public.roadmap_tasks SET blocked_by = ARRAY(
  SELECT t2.id FROM public.roadmap_tasks t2
  JOIN public.roadmap_sprints s2 ON s2.id = t2.sprint_id
  WHERE (s2.key, t2.key) IN (('s6.1', 't3'))
)
WHERE id = (
  SELECT t.id FROM public.roadmap_tasks t
  JOIN public.roadmap_sprints s ON s.id = t.sprint_id
  JOIN public.roadmap_phases p ON p.id = s.phase_id
  WHERE p.key = 'phase-6' AND s.key = 's6.3' AND t.key = 't1'
);
UPDATE public.roadmap_tasks SET blocked_by = ARRAY(
  SELECT t2.id FROM public.roadmap_tasks t2
  JOIN public.roadmap_sprints s2 ON s2.id = t2.sprint_id
  WHERE (s2.key, t2.key) IN (('s6.3', 't1'))
)
WHERE id = (
  SELECT t.id FROM public.roadmap_tasks t
  JOIN public.roadmap_sprints s ON s.id = t.sprint_id
  JOIN public.roadmap_phases p ON p.id = s.phase_id
  WHERE p.key = 'phase-6' AND s.key = 's6.3' AND t.key = 't2'
);
UPDATE public.roadmap_tasks SET blocked_by = ARRAY(
  SELECT t2.id FROM public.roadmap_tasks t2
  JOIN public.roadmap_sprints s2 ON s2.id = t2.sprint_id
  WHERE (s2.key, t2.key) IN (('s6.3', 't1'))
)
WHERE id = (
  SELECT t.id FROM public.roadmap_tasks t
  JOIN public.roadmap_sprints s ON s.id = t.sprint_id
  JOIN public.roadmap_phases p ON p.id = s.phase_id
  WHERE p.key = 'phase-6' AND s.key = 's6.3' AND t.key = 't3'
);
UPDATE public.roadmap_tasks SET blocked_by = ARRAY(
  SELECT t2.id FROM public.roadmap_tasks t2
  JOIN public.roadmap_sprints s2 ON s2.id = t2.sprint_id
  WHERE (s2.key, t2.key) IN (('s6.3', 't1'), ('s6.3', 't3'))
)
WHERE id = (
  SELECT t.id FROM public.roadmap_tasks t
  JOIN public.roadmap_sprints s ON s.id = t.sprint_id
  JOIN public.roadmap_phases p ON p.id = s.phase_id
  WHERE p.key = 'phase-6' AND s.key = 's6.3' AND t.key = 't4'
);
UPDATE public.roadmap_tasks SET blocked_by = ARRAY(
  SELECT t2.id FROM public.roadmap_tasks t2
  JOIN public.roadmap_sprints s2 ON s2.id = t2.sprint_id
  WHERE (s2.key, t2.key) IN (('s6.3', 't1'))
)
WHERE id = (
  SELECT t.id FROM public.roadmap_tasks t
  JOIN public.roadmap_sprints s ON s.id = t.sprint_id
  JOIN public.roadmap_phases p ON p.id = s.phase_id
  WHERE p.key = 'phase-6' AND s.key = 's6.3' AND t.key = 't5'
);
UPDATE public.roadmap_tasks SET blocked_by = ARRAY(
  SELECT t2.id FROM public.roadmap_tasks t2
  JOIN public.roadmap_sprints s2 ON s2.id = t2.sprint_id
  WHERE (s2.key, t2.key) IN (('s6.3', 't1'))
)
WHERE id = (
  SELECT t.id FROM public.roadmap_tasks t
  JOIN public.roadmap_sprints s ON s.id = t.sprint_id
  JOIN public.roadmap_phases p ON p.id = s.phase_id
  WHERE p.key = 'phase-6' AND s.key = 's6.3' AND t.key = 't6'
);
UPDATE public.roadmap_tasks SET blocked_by = ARRAY(
  SELECT t2.id FROM public.roadmap_tasks t2
  JOIN public.roadmap_sprints s2 ON s2.id = t2.sprint_id
  WHERE (s2.key, t2.key) IN (('s6.3', 't3'))
)
WHERE id = (
  SELECT t.id FROM public.roadmap_tasks t
  JOIN public.roadmap_sprints s ON s.id = t.sprint_id
  JOIN public.roadmap_phases p ON p.id = s.phase_id
  WHERE p.key = 'phase-6' AND s.key = 's6.3' AND t.key = 't7'
);
UPDATE public.roadmap_tasks SET blocked_by = ARRAY(
  SELECT t2.id FROM public.roadmap_tasks t2
  JOIN public.roadmap_sprints s2 ON s2.id = t2.sprint_id
  WHERE (s2.key, t2.key) IN (('s6.1', 't1'))
)
WHERE id = (
  SELECT t.id FROM public.roadmap_tasks t
  JOIN public.roadmap_sprints s ON s.id = t.sprint_id
  JOIN public.roadmap_phases p ON p.id = s.phase_id
  WHERE p.key = 'phase-6' AND s.key = 's6.4' AND t.key = 't1'
);
UPDATE public.roadmap_tasks SET blocked_by = ARRAY(
  SELECT t2.id FROM public.roadmap_tasks t2
  JOIN public.roadmap_sprints s2 ON s2.id = t2.sprint_id
  WHERE (s2.key, t2.key) IN (('s6.4', 't1'), ('s6.4', 't2'), ('s5.1', 't3'))
)
WHERE id = (
  SELECT t.id FROM public.roadmap_tasks t
  JOIN public.roadmap_sprints s ON s.id = t.sprint_id
  JOIN public.roadmap_phases p ON p.id = s.phase_id
  WHERE p.key = 'phase-6' AND s.key = 's6.4' AND t.key = 't3'
);
UPDATE public.roadmap_tasks SET blocked_by = ARRAY(
  SELECT t2.id FROM public.roadmap_tasks t2
  JOIN public.roadmap_sprints s2 ON s2.id = t2.sprint_id
  WHERE (s2.key, t2.key) IN (('s6.4', 't3'))
)
WHERE id = (
  SELECT t.id FROM public.roadmap_tasks t
  JOIN public.roadmap_sprints s ON s.id = t.sprint_id
  JOIN public.roadmap_phases p ON p.id = s.phase_id
  WHERE p.key = 'phase-6' AND s.key = 's6.4' AND t.key = 't4'
);
UPDATE public.roadmap_tasks SET blocked_by = ARRAY(
  SELECT t2.id FROM public.roadmap_tasks t2
  JOIN public.roadmap_sprints s2 ON s2.id = t2.sprint_id
  WHERE (s2.key, t2.key) IN (('s6.4', 't1'))
)
WHERE id = (
  SELECT t.id FROM public.roadmap_tasks t
  JOIN public.roadmap_sprints s ON s.id = t.sprint_id
  JOIN public.roadmap_phases p ON p.id = s.phase_id
  WHERE p.key = 'phase-6' AND s.key = 's6.4' AND t.key = 't5'
);
UPDATE public.roadmap_tasks SET blocked_by = ARRAY(
  SELECT t2.id FROM public.roadmap_tasks t2
  JOIN public.roadmap_sprints s2 ON s2.id = t2.sprint_id
  WHERE (s2.key, t2.key) IN (('s6.4', 't1'))
)
WHERE id = (
  SELECT t.id FROM public.roadmap_tasks t
  JOIN public.roadmap_sprints s ON s.id = t.sprint_id
  JOIN public.roadmap_phases p ON p.id = s.phase_id
  WHERE p.key = 'phase-6' AND s.key = 's6.4' AND t.key = 't6'
);
UPDATE public.roadmap_tasks SET blocked_by = ARRAY(
  SELECT t2.id FROM public.roadmap_tasks t2
  JOIN public.roadmap_sprints s2 ON s2.id = t2.sprint_id
  WHERE (s2.key, t2.key) IN (('s6.1', 't3'))
)
WHERE id = (
  SELECT t.id FROM public.roadmap_tasks t
  JOIN public.roadmap_sprints s ON s.id = t.sprint_id
  JOIN public.roadmap_phases p ON p.id = s.phase_id
  WHERE p.key = 'phase-6' AND s.key = 's6.5' AND t.key = 't1'
);
UPDATE public.roadmap_tasks SET blocked_by = ARRAY(
  SELECT t2.id FROM public.roadmap_tasks t2
  JOIN public.roadmap_sprints s2 ON s2.id = t2.sprint_id
  WHERE (s2.key, t2.key) IN (('s6.5', 't1'))
)
WHERE id = (
  SELECT t.id FROM public.roadmap_tasks t
  JOIN public.roadmap_sprints s ON s.id = t.sprint_id
  JOIN public.roadmap_phases p ON p.id = s.phase_id
  WHERE p.key = 'phase-6' AND s.key = 's6.5' AND t.key = 't3'
);
UPDATE public.roadmap_tasks SET blocked_by = ARRAY(
  SELECT t2.id FROM public.roadmap_tasks t2
  JOIN public.roadmap_sprints s2 ON s2.id = t2.sprint_id
  WHERE (s2.key, t2.key) IN (('s6.5', 't1'), ('s6.5', 't3'))
)
WHERE id = (
  SELECT t.id FROM public.roadmap_tasks t
  JOIN public.roadmap_sprints s ON s.id = t.sprint_id
  JOIN public.roadmap_phases p ON p.id = s.phase_id
  WHERE p.key = 'phase-6' AND s.key = 's6.5' AND t.key = 't4'
);
UPDATE public.roadmap_tasks SET blocked_by = ARRAY(
  SELECT t2.id FROM public.roadmap_tasks t2
  JOIN public.roadmap_sprints s2 ON s2.id = t2.sprint_id
  WHERE (s2.key, t2.key) IN (('s6.5', 't1'))
)
WHERE id = (
  SELECT t.id FROM public.roadmap_tasks t
  JOIN public.roadmap_sprints s ON s.id = t.sprint_id
  JOIN public.roadmap_phases p ON p.id = s.phase_id
  WHERE p.key = 'phase-6' AND s.key = 's6.5' AND t.key = 't5'
);
UPDATE public.roadmap_tasks SET blocked_by = ARRAY(
  SELECT t2.id FROM public.roadmap_tasks t2
  JOIN public.roadmap_sprints s2 ON s2.id = t2.sprint_id
  WHERE (s2.key, t2.key) IN (('s6.5', 't2'), ('s6.5', 't3'))
)
WHERE id = (
  SELECT t.id FROM public.roadmap_tasks t
  JOIN public.roadmap_sprints s ON s.id = t.sprint_id
  JOIN public.roadmap_phases p ON p.id = s.phase_id
  WHERE p.key = 'phase-6' AND s.key = 's6.5' AND t.key = 't6'
);
UPDATE public.roadmap_tasks SET blocked_by = ARRAY(
  SELECT t2.id FROM public.roadmap_tasks t2
  JOIN public.roadmap_sprints s2 ON s2.id = t2.sprint_id
  WHERE (s2.key, t2.key) IN (('s6.1', 't3'))
)
WHERE id = (
  SELECT t.id FROM public.roadmap_tasks t
  JOIN public.roadmap_sprints s ON s.id = t.sprint_id
  JOIN public.roadmap_phases p ON p.id = s.phase_id
  WHERE p.key = 'phase-6' AND s.key = 's6.6' AND t.key = 't1'
);
UPDATE public.roadmap_tasks SET blocked_by = ARRAY(
  SELECT t2.id FROM public.roadmap_tasks t2
  JOIN public.roadmap_sprints s2 ON s2.id = t2.sprint_id
  WHERE (s2.key, t2.key) IN (('s5.1', 't4'))
)
WHERE id = (
  SELECT t.id FROM public.roadmap_tasks t
  JOIN public.roadmap_sprints s ON s.id = t.sprint_id
  JOIN public.roadmap_phases p ON p.id = s.phase_id
  WHERE p.key = 'phase-6' AND s.key = 's6.6' AND t.key = 't2'
);
UPDATE public.roadmap_tasks SET blocked_by = ARRAY(
  SELECT t2.id FROM public.roadmap_tasks t2
  JOIN public.roadmap_sprints s2 ON s2.id = t2.sprint_id
  WHERE (s2.key, t2.key) IN (('s6.1', 't5'))
)
WHERE id = (
  SELECT t.id FROM public.roadmap_tasks t
  JOIN public.roadmap_sprints s ON s.id = t.sprint_id
  JOIN public.roadmap_phases p ON p.id = s.phase_id
  WHERE p.key = 'phase-6' AND s.key = 's6.6' AND t.key = 't4'
);
UPDATE public.roadmap_tasks SET blocked_by = ARRAY(
  SELECT t2.id FROM public.roadmap_tasks t2
  JOIN public.roadmap_sprints s2 ON s2.id = t2.sprint_id
  WHERE (s2.key, t2.key) IN (('s6.1', 't3'))
)
WHERE id = (
  SELECT t.id FROM public.roadmap_tasks t
  JOIN public.roadmap_sprints s ON s.id = t.sprint_id
  JOIN public.roadmap_phases p ON p.id = s.phase_id
  WHERE p.key = 'phase-6' AND s.key = 's6.6' AND t.key = 't5'
);
UPDATE public.roadmap_tasks SET blocked_by = ARRAY(
  SELECT t2.id FROM public.roadmap_tasks t2
  JOIN public.roadmap_sprints s2 ON s2.id = t2.sprint_id
  WHERE (s2.key, t2.key) IN (('s6.1', 't5'))
)
WHERE id = (
  SELECT t.id FROM public.roadmap_tasks t
  JOIN public.roadmap_sprints s ON s.id = t.sprint_id
  JOIN public.roadmap_phases p ON p.id = s.phase_id
  WHERE p.key = 'phase-6b' AND s.key = 's6b.1' AND t.key = 't1'
);
UPDATE public.roadmap_tasks SET blocked_by = ARRAY(
  SELECT t2.id FROM public.roadmap_tasks t2
  JOIN public.roadmap_sprints s2 ON s2.id = t2.sprint_id
  WHERE (s2.key, t2.key) IN (('s6b.1', 't1'), ('s6.3', 't1'))
)
WHERE id = (
  SELECT t.id FROM public.roadmap_tasks t
  JOIN public.roadmap_sprints s ON s.id = t.sprint_id
  JOIN public.roadmap_phases p ON p.id = s.phase_id
  WHERE p.key = 'phase-6b' AND s.key = 's6b.1' AND t.key = 't2'
);
UPDATE public.roadmap_tasks SET blocked_by = ARRAY(
  SELECT t2.id FROM public.roadmap_tasks t2
  JOIN public.roadmap_sprints s2 ON s2.id = t2.sprint_id
  WHERE (s2.key, t2.key) IN (('s6b.1', 't1'), ('s6.3', 't5'))
)
WHERE id = (
  SELECT t.id FROM public.roadmap_tasks t
  JOIN public.roadmap_sprints s ON s.id = t.sprint_id
  JOIN public.roadmap_phases p ON p.id = s.phase_id
  WHERE p.key = 'phase-6b' AND s.key = 's6b.1' AND t.key = 't3'
);
UPDATE public.roadmap_tasks SET blocked_by = ARRAY(
  SELECT t2.id FROM public.roadmap_tasks t2
  JOIN public.roadmap_sprints s2 ON s2.id = t2.sprint_id
  WHERE (s2.key, t2.key) IN (('s6b.1', 't1'), ('s6.1', 't2'))
)
WHERE id = (
  SELECT t.id FROM public.roadmap_tasks t
  JOIN public.roadmap_sprints s ON s.id = t.sprint_id
  JOIN public.roadmap_phases p ON p.id = s.phase_id
  WHERE p.key = 'phase-6b' AND s.key = 's6b.1' AND t.key = 't4'
);
UPDATE public.roadmap_tasks SET blocked_by = ARRAY(
  SELECT t2.id FROM public.roadmap_tasks t2
  JOIN public.roadmap_sprints s2 ON s2.id = t2.sprint_id
  WHERE (s2.key, t2.key) IN (('s6b.1', 't1'), ('s6.1', 't1'))
)
WHERE id = (
  SELECT t.id FROM public.roadmap_tasks t
  JOIN public.roadmap_sprints s ON s.id = t.sprint_id
  JOIN public.roadmap_phases p ON p.id = s.phase_id
  WHERE p.key = 'phase-6b' AND s.key = 's6b.1' AND t.key = 't5'
);
UPDATE public.roadmap_tasks SET blocked_by = ARRAY(
  SELECT t2.id FROM public.roadmap_tasks t2
  JOIN public.roadmap_sprints s2 ON s2.id = t2.sprint_id
  WHERE (s2.key, t2.key) IN (('s5.1', 't1'), ('s5.2', 't5'))
)
WHERE id = (
  SELECT t.id FROM public.roadmap_tasks t
  JOIN public.roadmap_sprints s ON s.id = t.sprint_id
  JOIN public.roadmap_phases p ON p.id = s.phase_id
  WHERE p.key = 'phase-6b' AND s.key = 's6b.2' AND t.key = 't1'
);
UPDATE public.roadmap_tasks SET blocked_by = ARRAY(
  SELECT t2.id FROM public.roadmap_tasks t2
  JOIN public.roadmap_sprints s2 ON s2.id = t2.sprint_id
  WHERE (s2.key, t2.key) IN (('s6b.2', 't1'), ('s5.3', 't1'))
)
WHERE id = (
  SELECT t.id FROM public.roadmap_tasks t
  JOIN public.roadmap_sprints s ON s.id = t.sprint_id
  JOIN public.roadmap_phases p ON p.id = s.phase_id
  WHERE p.key = 'phase-6b' AND s.key = 's6b.2' AND t.key = 't2'
);
UPDATE public.roadmap_tasks SET blocked_by = ARRAY(
  SELECT t2.id FROM public.roadmap_tasks t2
  JOIN public.roadmap_sprints s2 ON s2.id = t2.sprint_id
  WHERE (s2.key, t2.key) IN (('s6b.2', 't1'), ('s5.3', 't3'))
)
WHERE id = (
  SELECT t.id FROM public.roadmap_tasks t
  JOIN public.roadmap_sprints s ON s.id = t.sprint_id
  JOIN public.roadmap_phases p ON p.id = s.phase_id
  WHERE p.key = 'phase-6b' AND s.key = 's6b.2' AND t.key = 't3'
);
UPDATE public.roadmap_tasks SET blocked_by = ARRAY(
  SELECT t2.id FROM public.roadmap_tasks t2
  JOIN public.roadmap_sprints s2 ON s2.id = t2.sprint_id
  WHERE (s2.key, t2.key) IN (('s6b.2', 't1'), ('s5.2', 't5'))
)
WHERE id = (
  SELECT t.id FROM public.roadmap_tasks t
  JOIN public.roadmap_sprints s ON s.id = t.sprint_id
  JOIN public.roadmap_phases p ON p.id = s.phase_id
  WHERE p.key = 'phase-6b' AND s.key = 's6b.2' AND t.key = 't4'
);
UPDATE public.roadmap_tasks SET blocked_by = ARRAY(
  SELECT t2.id FROM public.roadmap_tasks t2
  JOIN public.roadmap_sprints s2 ON s2.id = t2.sprint_id
  WHERE (s2.key, t2.key) IN (('s6b.1', 't4'), ('s6.1', 't5'))
)
WHERE id = (
  SELECT t.id FROM public.roadmap_tasks t
  JOIN public.roadmap_sprints s ON s.id = t.sprint_id
  JOIN public.roadmap_phases p ON p.id = s.phase_id
  WHERE p.key = 'phase-6b' AND s.key = 's6b.3' AND t.key = 't1'
);
UPDATE public.roadmap_tasks SET blocked_by = ARRAY(
  SELECT t2.id FROM public.roadmap_tasks t2
  JOIN public.roadmap_sprints s2 ON s2.id = t2.sprint_id
  WHERE (s2.key, t2.key) IN (('s6.3', 't1'), ('s6b.1', 't2'))
)
WHERE id = (
  SELECT t.id FROM public.roadmap_tasks t
  JOIN public.roadmap_sprints s ON s.id = t.sprint_id
  JOIN public.roadmap_phases p ON p.id = s.phase_id
  WHERE p.key = 'phase-6b' AND s.key = 's6b.3' AND t.key = 't2'
);
UPDATE public.roadmap_tasks SET blocked_by = ARRAY(
  SELECT t2.id FROM public.roadmap_tasks t2
  JOIN public.roadmap_sprints s2 ON s2.id = t2.sprint_id
  WHERE (s2.key, t2.key) IN (('s6b.1', 't1'), ('s6b.2', 't1'))
)
WHERE id = (
  SELECT t.id FROM public.roadmap_tasks t
  JOIN public.roadmap_sprints s ON s.id = t.sprint_id
  JOIN public.roadmap_phases p ON p.id = s.phase_id
  WHERE p.key = 'phase-6b' AND s.key = 's6b.3' AND t.key = 't3'
);
UPDATE public.roadmap_tasks SET blocked_by = ARRAY(
  SELECT t2.id FROM public.roadmap_tasks t2
  JOIN public.roadmap_sprints s2 ON s2.id = t2.sprint_id
  WHERE (s2.key, t2.key) IN (('s6b.2', 't4'), ('s5.2', 't5'))
)
WHERE id = (
  SELECT t.id FROM public.roadmap_tasks t
  JOIN public.roadmap_sprints s ON s.id = t.sprint_id
  JOIN public.roadmap_phases p ON p.id = s.phase_id
  WHERE p.key = 'phase-6b' AND s.key = 's6b.3' AND t.key = 't4'
);

COMMIT;
