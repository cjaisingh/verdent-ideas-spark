---
name: CSV/XLSX structured adapter (W9.1)
description: First SOURCE_ADAPTER_CONTRACT impl — ingest-csv-adapter edge fn parses CSV/XLSX from ingested-files bucket via approved source_mappings.mapping, writes raw_records + staged_records, promotes to canonical_facts or raises fact_conflicts, idempotent on (file_id, source_mapping_id)
type: feature
---
**Endpoint**: `POST /functions/v1/ingest-csv-adapter` — operator JWT or `x-service-token`.

**Inputs**: `file_id`, `source_mapping_id`, optional `default_tenant_node_id`, `pii_fields[]`, `max_rows` (≤50k), `dry_run`. Idempotency key = `csv-adapter:{file_id}:{source_mapping_id}`; replay returns `deduped:true` with original counts.

**Mapping** (`source_mappings.mapping` jsonb, validated by `CsvMappingSchema`):
- `kind: "csv" | "xlsx"`, `header_row`, optional `sheet`/`delimiter`
- `tenant_node.by: "fixed" | "column"` — descriptor matching deferred to Phase 5 resolver
- `effective_at.by: "fixed" | "column" | "received_at"`
- `facts[]`: `{ fact_type, column, parser, required, unit? }`; parsers = `string|number|integer|boolean|json|iso_date`

**Precondition trio** (per `SOURCE_ADAPTER_CONTRACT`): mapping `status='approved'` AND every cell parses AND every `pii_fields[*].basis` declared. Empty `pii_fields=[]` asserts zero PII.

**Outcomes per row**:
- pass → insert `canonical_facts` (`auto_promoted=true`), update staged_records.promoted_canonical_id, emit `row_promoted`
- live canonical exists with different `value_hash` → insert `fact_conflicts`, emit `conflict_raised` (NO silent overwrite)
- live canonical exists with same hash → link staged row, no new canonical
- precondition fails → quarantine staged row, emit `row_quarantined`

**Staged row key**: `row_no = lineNo*1000 + factIndex` (composite-key uniqueness across facts; safe because contract caps facts at 64).

**Bytea encoding**: `value_hash`/`payload_hash` sent as `\xHEX` literal via PostgREST.

**Not yet**: descriptor/fuzzy tenant_node match (Phase 5), per-row idempotency, >50k row streaming (GHA worker), CAD/FM geometry parsing.

Files: `supabase/functions/ingest-csv-adapter/index.ts`, `supabase/functions/_shared/contracts/ingest-csv-adapter.ts`, `docs/features/csv-xlsx-adapter.md`.
