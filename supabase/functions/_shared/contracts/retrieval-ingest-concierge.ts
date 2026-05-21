// Retrieval contract for the Phase 6 `ingest_concierge` agent.
//
// Walks the operator through a new source (lease PDF, SFG20 spec, ISO doc).
// Data shape: hierarchical-doc — chunking + embedding loses the
// table-of-contents structure these documents rely on.
//
// See mem://preferences/retrieval-shapes and docs/phases-5-6-6b-research.md.
// Status: stub — contract types only. Implementation lands with sprint s6.2.

export type IngestConciergeRetrievalInput = {
  /** Document identifier in raw_records or a staged URL. */
  sourceRef: { rawRecordId?: string; url?: string };
  /** Operator's current question or the agent's planning intent. */
  query: string;
  /** Section path the agent is currently exploring (PageIndex-style). */
  sectionPath?: string[];
  /** Max sibling sections to pull alongside the target. */
  siblingFanout?: number;
};

export type IngestConciergeRetrievalOutput = {
  sections: Array<{
    path: string[];
    title: string;
    snippet: string;
    /** Page or offset reference for citation back to the source. */
    locator: string;
    /** Whether snippet was truncated to fit the token budget. */
    truncated: boolean;
  }>;
  /** Total tokens served so the caller can stop before the budget cap. */
  tokensServed: number;
};

export const INGEST_CONCIERGE_RETRIEVAL_CONTRACT = {
  shape: "hierarchical-doc",
  store: "page-index-style (pgvector NOT acceptable as primary)",
  primaryKey: "section path",
  tokenBudget: 8000,
  freshnessWindow: "as-of source ingest time (documents are immutable)",
  fallback:
    "If no table-of-contents present, fall back to prose-RAG against awip_doc_chunks with a §'no section path' badge so caller knows precision dropped.",
  declaredBy: "docs/agents/contract-checklist.md",
} as const;
