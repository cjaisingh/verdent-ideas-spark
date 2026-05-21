// Source-adapter input contract for Phase 6 sprint s6.2.
//
// Every connector (CSV/XLSX, JSON, BMS batch, lease PDF, email, Telegram
// voice, future BIM/CAFM/ERP) implements this shape. Locks in the
// auto-promote precondition trio: mapping approved + validations pass +
// no PII without lawful basis.
//
// See docs/phases-5-6-6b-research.md § Phase 6 and
// mem://preferences/contract-first.
//
// Status: stub — contract types only. No runtime adapter ships this round.

export type LawfulBasis =
  | "contract"
  | "legitimate_interest"
  | "consent"
  | "legal_obligation"
  | "vital_interest"
  | "public_task"
  | "not_pii";

export type SourceAdapterInput = {
  /** Stable adapter identifier — used as the prefix of `ai_usage_log.job`. */
  adapter: string;
  /** Connection / file / webhook this batch came from. */
  source: {
    id: string;
    kind: "file" | "api" | "webhook" | "voice" | "email" | "bms_batch";
    receivedAt: string; // ISO 8601
  };
  /** Approved mapping; adapters MUST refuse if mapping.status != 'approved'. */
  sourceMappingRef: {
    id: string;
    version: number;
    status: "draft" | "approved" | "deprecated";
  };
  /** Raw envelope landed in raw_records. */
  rawRecord: {
    id: string;
    tenantId: string;
    payload: unknown;
    bytes: number;
  };
  /** Declared PII columns + lawful basis. Empty array = adapter asserts no PII. */
  piiFields: Array<{ column: string; basis: LawfulBasis; notes?: string }>;
  /** Idempotency derivation — same key + same payload hash MUST be a no-op. */
  idempotencyKey: string;
};

export type SourceAdapterOutput = {
  rowsStaged: number;
  rowsAutoPromoted: number;
  rowsQuarantined: number;
  conflictsRaised: number;
  /** True only when ALL three preconditions held for every row. */
  autoPromoteEligible: boolean;
  /** First-N reasons rows failed the precondition trio — caller surfaces these. */
  precheckFailures: Array<{
    reason: "mapping_not_approved" | "validation_failed" | "pii_without_basis";
    column?: string;
    rowNo?: number;
  }>;
};

export const SOURCE_ADAPTER_CONTRACT = {
  canonicalQuestion:
    "Given an approved source_mapping and a raw_record, how many rows can be promoted to canonical_facts without operator review?",
  mandatoryEvidence: ["sourceMappingRef", "rawRecord", "piiFields", "idempotencyKey"] as const,
  autoPromotePreconditions: [
    "sourceMappingRef.status === 'approved'",
    "validation pass for every row in batch",
    "every piiFields[*].basis !== undefined",
  ] as const,
  emitsEvent: "ingest_events",
  hardInvariants: [
    "No tenant_node guesswork — unresolved descriptors quarantine the row.",
    "No silent overwrite — value conflicts always raise a fact_conflicts row.",
    "Same idempotencyKey + same payload hash is a no-op (409 on different body).",
  ] as const,
  declaredBy: "docs/agents/contract-checklist.md",
} as const;
