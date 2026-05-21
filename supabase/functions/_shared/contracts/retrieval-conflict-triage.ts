// Retrieval contract for the Phase 6/6b conflict-triage agent.
//
// Reads `fact_conflicts` + `conflict_rules` to propose a resolution or
// bulk-pattern grouping. Data shape: relational — same-mapping siblings and
// the rule table matter more than semantic similarity.
//
// See mem://preferences/retrieval-shapes and docs/phases-5-6-6b-research.md.
// Status: stub — contract types only. Implementation lands with sprint s6.1.

export type ConflictTriageRetrievalInput = {
  conflictId: string;
  /** Pull siblings from the same source_mapping for bulk-pattern detection. */
  includeSiblings?: boolean;
  /** Window for sibling pull, in days. */
  siblingWindowDays?: number;
};

export type ConflictTriageRetrievalOutput = {
  conflict: {
    id: string;
    factType: string;
    tenantNodeId: string;
    incomingValue: unknown;
    existingValue: unknown;
    sourceMappingId: string;
  };
  siblings: Array<{
    id: string;
    incomingValue: unknown;
    existingValue: unknown;
    /** Hash bucket so the caller can spot bulk patterns without an LLM round-trip. */
    valuePairHash: string;
  }>;
  applicableRules: Array<{
    id: string;
    precedence: number;
    description: string;
    matchPattern: Record<string, unknown>;
  }>;
};

export const CONFLICT_TRIAGE_RETRIEVAL_CONTRACT = {
  shape: "relational",
  store: "fact_conflicts + conflict_rules (Postgres) joined on tenant_node + fact_type",
  primaryKey: "fact_conflicts.id",
  tokenBudget: 4000,
  freshnessWindow: "live (conflicts churn fast during a re-ingest)",
  fallback:
    "If siblings > 200, return the first 200 by recency and set a `truncated=true` flag — the caller must escalate to the bulk-pattern UI rather than asking the LLM to chew through 1000 rows.",
  declaredBy: "docs/agents/contract-checklist.md",
} as const;
