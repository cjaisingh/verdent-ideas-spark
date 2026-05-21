// Retrieval contract for the Phase 6 `validation_agent`.
//
// Validates staged rows before they promote to canonical_facts. Data shape:
// tabular — embedding rows as text would burn tokens to rediscover what a
// SQL WHERE clause answers in one hop.
//
// See mem://preferences/retrieval-shapes and docs/phases-5-6-6b-research.md.
// Status: stub — contract types only. Implementation lands with sprint s6.1.

export type ValidationAgentRetrievalInput = {
  /** Staging batch the agent is validating. */
  sourceMappingId: string;
  stagingBatchId: string;
  /** Optional column filter — agent narrows when chasing a specific failure. */
  columns?: string[];
  /** Row sample size; full batch only on operator request. */
  sampleSize?: number;
};

export type ValidationAgentRetrievalOutput = {
  rows: Array<Record<string, unknown>>;
  /** Per-column nullity + distinct-count stats so the LLM can reason without re-counting. */
  columnStats: Record<string, { nulls: number; distinct: number; sampleValues: unknown[] }>;
  /** Prior validation outcomes for the same source_mapping (last 50). */
  priorValidations: Array<{ at: string; outcome: "pass" | "fail"; reason?: string }>;
};

export const VALIDATION_AGENT_RETRIEVAL_CONTRACT = {
  shape: "tabular",
  store: "staged_records (direct SQL — no embeddings)",
  primaryKey: "(source_mapping_id, staging_batch_id, row_no)",
  tokenBudget: 2000,
  freshnessWindow: "live (rows mutate until promoted or quarantined)",
  fallback: "If sampleSize > 200, refuse — agent must narrow with a column filter first.",
  declaredBy: "docs/agents/contract-checklist.md",
} as const;
