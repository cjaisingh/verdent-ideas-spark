---
name: Ingest pipeline schema (s6.1/t1)
description: Phase 6 ingest backbone — seven tables + DB-enforced invariants for raw → staged → canonical with conflict detection
type: feature
---

# Ingest pipeline schema (s6.1/t1)

Seven operator-only tables forming the canonical ingest spine. Adapters (s6.2+), validation agent (s6.1/t3), and conflict triage (s6.1/t4) bind against this shape.

```text
source_mappings ──► raw_records ──► staged_records ──► canonical_facts
                                                          │
                                                          ├──► fact_conflicts ──► conflict_rules
                                                          │
                                                          └──► ingest_events (append-only)
```

## Invariants (enforced at the database, not the app)

- `canonical_facts.tenant_node_id NOT NULL` — no guessed binding.
- `canonical_facts` UPDATE blocked except `superseded_by NULL → non-null` (`tg_canonical_facts_forbid_update`). DELETE blocked (`tg_canonical_facts_forbid_delete`) except via the future DSAR `SECURITY DEFINER` path.
- Partial unique `(tenant_node_id, fact_type, effective_at) WHERE superseded_by IS NULL` — second live row impossible; forces caller to raise `fact_conflicts`.
- Approved `source_mappings` rows immutable (`tg_source_mappings_lock_approved`) — corrections create a new version.
- `ingest_events` UPDATE/DELETE blocked (`tg_ingest_events_append_only`).
- `raw_records (adapter_id, idempotency_key)` unique — adapter must produce 409 on mismatched payload hash at the app layer.

## Contract bindings

- `SOURCE_ADAPTER_CONTRACT` writes `raw_records` + `staged_records`, promotes to `canonical_facts` when all three preconditions hold, raises `fact_conflicts` otherwise.
- `VALIDATION_AGENT_RETRIEVAL_CONTRACT` queries `staged_records` keyed on `(source_mapping_id, validation_status)` — index exists.
- `CONFLICT_TRIAGE_RETRIEVAL_CONTRACT` queries `fact_conflicts` keyed on `(source_mapping_id, fact_type, value_pair_hash)` — index exists.

## Deliberately deferred (do NOT add this round)

- PII tagging precision — `raw_records.pii_declared` stays free-form jsonb until s6.1/t3.
- DSAR tombstone path — separate migration; the forbid-delete trigger is the placeholder.
- Bulk conflict pattern detector (ADR-0005) — only the `value_pair_hash` column is committed.
- Auto-promote runtime — source-adapter implementation (s6.2).
- Retention cron — `raw_records.retain_until` column is the placeholder.
- `/ingest` UI — view exists so the future page has a stable shape.
