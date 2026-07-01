// W9.1 — Structured CSV / XLSX adapter contract.
//
// First concrete implementation of `SOURCE_ADAPTER_CONTRACT`. Converts a
// previously-uploaded structured file (already in `ingested_files`) into
// `staged_records` and, when the precondition trio holds, promotes rows to
// `canonical_facts`. Conflicts go to `fact_conflicts`; everything emits to
// `ingest_events`.
//
// One adapter call = one (file_id, source_mapping_id) pair = one
// staging_batch. Same (file_id, source_mapping_id) is idempotent: the second
// call is a no-op that returns the original batch counts.
//
// Tenant-node resolution is intentionally narrow in v1:
//   - fixed: every row pinned to one tenant_node_id (passed in body or
//     declared in mapping.tenant_node.value).
//   - column: tenant_node UUID read from a named column per row.
// Fuzzy/descriptor matching is reserved for Phase 5 resolver work — until
// then unresolved nodes quarantine the row.
//
// See docs/features/csv-xlsx-adapter.md and
// supabase/functions/_shared/contracts/source-adapter.ts.

import { z } from "https://esm.sh/zod@3.23.8";
import type { LawfulBasis } from "./source-adapter.ts";

// ---------- mapping shape persisted in source_mappings.mapping ----------

export const FactParserKinds = [
  "string",
  "number",
  "integer",
  "boolean",
  "json",
  "iso_date",
] as const;
export type FactParserKind = (typeof FactParserKinds)[number];

export const CsvMappingSchema = z.object({
  kind: z.enum(["csv", "xlsx"]),
  sheet: z.string().min(1).max(64).optional(), // xlsx only; defaults to first
  header_row: z.number().int().min(1).max(50).default(1),
  delimiter: z.string().length(1).optional(),  // csv only; defaults to ","
  tenant_node: z.object({
    by: z.enum(["fixed", "column"]),
    column: z.string().min(1).max(128).optional(),
    value: z.string().uuid().optional(),
  }),
  effective_at: z.object({
    by: z.enum(["fixed", "column", "received_at"]),
    column: z.string().min(1).max(128).optional(),
    value: z.string().datetime().optional(),
  }),
  facts: z.array(
    z.object({
      fact_type: z.string().min(1).max(128),
      column: z.string().min(1).max(128),
      parser: z.enum(FactParserKinds).default("string"),
      required: z.boolean().default(true),
      // when parser=number|integer, optional unit tag persisted on value
      unit: z.string().min(1).max(32).optional(),
    }),
  ).min(1).max(64),
});
export type CsvMapping = z.infer<typeof CsvMappingSchema>;

// ---------- request body ----------

export const IngestCsvAdapterBody = z.object({
  file_id: z.string().uuid(),
  source_mapping_id: z.string().uuid(),
  // Override tenant_node.by=fixed mapping at call time (operator convenience).
  default_tenant_node_id: z.string().uuid().optional(),
  // PII declaration per source-adapter contract; empty = adapter asserts none.
  pii_fields: z.array(
    z.object({
      column: z.string().min(1).max(128),
      basis: z.enum([
        "contract",
        "legitimate_interest",
        "consent",
        "legal_obligation",
        "vital_interest",
        "public_task",
        "not_pii",
      ]),
      notes: z.string().max(500).optional(),
    }),
  ).max(64).default([]),
  // Hard ceiling on rows processed in one call. Sidecar/GHA worker should
  // chunk larger files into multiple calls.
  max_rows: z.number().int().min(1).max(50_000).default(10_000),
  dry_run: z.boolean().default(false),
  // Retry mode: when non-empty, only the listed composite row_no values
  // (rowNo*1000 + factIndex, as persisted on staged_records) are re-processed
  // against the given staging_batch_id. Requires `staging_batch_id`. Prior
  // staged_records + fact_conflicts for those row_nos are deleted first, then
  // recreated using the current mapping. Idempotency dedup is bypassed.
  retry_row_nos: z.array(z.number().int().min(1)).max(500).optional(),
  staging_batch_id: z.string().uuid().optional(),
}).refine(
  (v) => !(v.retry_row_nos && v.retry_row_nos.length > 0) || !!v.staging_batch_id,
  { message: "staging_batch_id is required when retry_row_nos is set", path: ["staging_batch_id"] },
);
export type IngestCsvAdapterBody = z.infer<typeof IngestCsvAdapterBody>;

// ---------- response ----------

export type IngestCsvAdapterQuarantinePreview = {
  row_no: number;
  fact_type: string;
  column: string;
  tenant_node_id: string | null;
  effective_at: string | null;
  raw_value: unknown;
  errors: Array<Record<string, unknown>>;
};

export type IngestCsvAdapterConflictPreview = {
  row_no: number;
  fact_type: string;
  tenant_node_id: string;
  effective_at: string;
  incoming_value: unknown;
  existing_canonical_id: string;
  existing_value_hash: string;
};

export type IngestCsvAdapterResponse = {
  staging_batch_id: string;
  raw_record_id: string;
  rows_seen: number;
  rows_staged: number;
  rows_auto_promoted: number;
  rows_quarantined: number;
  conflicts_raised: number;
  auto_promote_eligible: boolean;
  precheck_failures: Array<{
    reason: "mapping_not_approved" | "validation_failed" | "pii_without_basis";
    column?: string;
    row_no?: number;
  }>;
  // Per-row previews, capped at 50 each. Full lists live in staged_records /
  // fact_conflicts and can be downloaded via the quarantine report endpoint.
  quarantine_preview: IngestCsvAdapterQuarantinePreview[];
  conflicts_preview: IngestCsvAdapterConflictPreview[];
  deduped: boolean; // true when the (file, mapping) pair was already processed
  dry_run: boolean;
};

// ---------- helpers ----------

export function parseCellValue(
  raw: unknown,
  kind: FactParserKind,
): { ok: true; value: unknown } | { ok: false; reason: string } {
  if (raw === null || raw === undefined || raw === "") {
    return { ok: false, reason: "empty" };
  }
  const s = typeof raw === "string" ? raw.trim() : raw;
  switch (kind) {
    case "string":
      return { ok: true, value: String(s) };
    case "number": {
      const n = Number(s);
      if (!Number.isFinite(n)) return { ok: false, reason: "not_number" };
      return { ok: true, value: n };
    }
    case "integer": {
      const n = Number(s);
      if (!Number.isInteger(n)) return { ok: false, reason: "not_integer" };
      return { ok: true, value: n };
    }
    case "boolean": {
      const t = String(s).toLowerCase();
      if (["true", "1", "yes", "y"].includes(t)) return { ok: true, value: true };
      if (["false", "0", "no", "n"].includes(t)) return { ok: true, value: false };
      return { ok: false, reason: "not_boolean" };
    }
    case "json": {
      try { return { ok: true, value: JSON.parse(String(s)) }; }
      catch { return { ok: false, reason: "invalid_json" }; }
    }
    case "iso_date": {
      const d = new Date(String(s));
      if (Number.isNaN(d.getTime())) return { ok: false, reason: "not_date" };
      return { ok: true, value: d.toISOString() };
    }
  }
}

export type { LawfulBasis };

export const INGEST_CSV_ADAPTER_CONTRACT = {
  canonicalQuestion:
    "Given an approved CSV/XLSX mapping and a structured file in `ingested_files`, stage every row and promote those that satisfy the precondition trio to `canonical_facts`.",
  mandatoryEvidence: ["file_id", "source_mapping_id", "pii_fields"] as const,
  idempotencyKey: "(file_id, source_mapping_id)" as const,
  autoPromotePreconditions: [
    "source_mappings.status === 'approved'",
    "every parsed row passes its fact parser + required check",
    "every pii_fields[*].basis !== undefined (zero-PII asserted by empty array)",
  ] as const,
  emitsEvent: "ingest_events",
  hardInvariants: [
    "Row with unresolved tenant_node is quarantined, never guessed.",
    "Live canonical with different value_hash for same (tenant_node_id, fact_type, effective_at) raises a fact_conflict instead of overwriting.",
    "Re-running the same (file_id, source_mapping_id) returns the original batch with deduped=true.",
  ] as const,
  declaredBy: "docs/agents/contract-checklist.md",
} as const;
