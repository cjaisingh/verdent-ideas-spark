# CSV / XLSX Structured Adapter (W9.1)

First concrete implementation of [`SOURCE_ADAPTER_CONTRACT`](../../supabase/functions/_shared/contracts/source-adapter.ts).
Turns approved-mapping CSV or XLSX files in `ingested-files` storage into
`canonical_facts` rows — the structured leg of the ingestion substrate.

## Endpoint

`POST /functions/v1/ingest-csv-adapter`

Auth: operator/admin JWT **or** `x-service-token: $AWIP_SERVICE_TOKEN`.

```jsonc
{
  "file_id": "uuid of an ingested_files row (already uploaded to ingested-files bucket)",
  "source_mapping_id": "uuid of an approved source_mappings row",
  "default_tenant_node_id": "uuid (optional, overrides mapping.tenant_node.value when by=fixed)",
  "pii_fields": [{ "column": "tenant_email", "basis": "contract" }],
  "max_rows": 10000,
  "dry_run": false
}
```

Idempotency key is `csv-adapter:{file_id}:{source_mapping_id}`. Re-running the
same call returns the original batch counts with `deduped: true`.

## Mapping shape

Persisted in `source_mappings.mapping` (jsonb) and validated by
`CsvMappingSchema` in [`ingest-csv-adapter.ts`](../../supabase/functions/_shared/contracts/ingest-csv-adapter.ts):

```jsonc
{
  "kind": "csv",                    // or "xlsx"
  "sheet": "Assets",                // xlsx only — defaults to first sheet
  "header_row": 1,
  "delimiter": ",",                 // csv only — defaults to ","
  "tenant_node": {
    "by": "fixed",                  // or "column"
    "value": "uuid",                // when by=fixed
    "column": "tenant_node_id"      // when by=column
  },
  "effective_at": {
    "by": "column",                 // or "fixed" or "received_at"
    "column": "measured_at",
    "value": "2026-01-01T00:00:00Z" // when by=fixed
  },
  "facts": [
    { "fact_type": "asset.area_m2", "column": "area_m2", "parser": "number", "unit": "m2" },
    { "fact_type": "asset.condition", "column": "condition", "parser": "string", "required": false }
  ]
}
```

Supported parsers: `string`, `number`, `integer`, `boolean`, `json`, `iso_date`.

## Auto-promote precondition trio

Per `SOURCE_ADAPTER_CONTRACT`, every row promotes to `canonical_facts` only when
**all three** hold:

1. `source_mappings.status === 'approved'`
2. Every parsed cell passes its parser + required check
3. `pii_fields[*].basis` declared (empty array = adapter asserts zero PII)

Any failure → row goes to `staged_records` with `validation_status='quarantined'`
and an entry in `precheck_failures[]`. **No silent overwrites**: if a live
canonical exists for `(tenant_node_id, fact_type, effective_at)` with a
different `value_hash`, the adapter raises a `fact_conflicts` row instead of
superseding.

## Tenant-node resolution (v1)

Only `by: fixed` and `by: column` (UUID-valued). Descriptor / fuzzy matching is
reserved for Phase 5 resolver work — until then, unresolved nodes quarantine
the row.

## XLSX handling

Uses `xlsx@0.18.5` (npm via esm.sh) with `sheet_to_json({ header: 1 })`. Date
cells are coerced through `iso_date` parser. Workbooks larger than `max_rows`
are rejected with HTTP 413 — chunk via the GHA worker.

## Events emitted

Every row writes to `ingest_events`:

| event_type        | when                                              |
|-------------------|---------------------------------------------------|
| `row_quarantined` | validation failed                                 |
| `row_promoted`    | new canonical_fact inserted                       |
| `conflict_raised` | live canonical exists with different value_hash   |

## What this adapter does NOT do (yet)

- Descriptor-based tenant-node lookup → Phase 5 resolver
- Per-row idempotency replay (whole-batch only) → W9.2
- Streaming for >50k row files → GHA bulk worker
- CAD/FM geometry parsing → metadata-only adapter slot (W9.2)
