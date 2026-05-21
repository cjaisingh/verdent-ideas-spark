// Retrieval contract for the Phase 6 `ingest_concierge` agent.
//
// Walks the operator through a new source (lease PDF, SFG20 spec, ISO doc).
// Data shape: hierarchical-doc — chunking + embedding loses the
// table-of-contents structure these documents rely on.
//
// See mem://preferences/retrieval-shapes and docs/phases-5-6-6b-research.md.
// Status: stub — contract types only. Implementation lands with sprint s6.2.

import { z } from "https://esm.sh/zod@3.23.8";
import type { RetrievalContractMeta } from "./retrieval-contract.ts";

export const IngestConciergeRetrievalInputSchema = z
  .object({
    sourceRef: z
      .object({
        rawRecordId: z.string().min(1).optional(),
        url: z.string().url().optional(),
      })
      .refine((v) => Boolean(v.rawRecordId || v.url), {
        message: "sourceRef requires at least one of rawRecordId or url",
      }),
    query: z.string().min(1, "query must be non-empty"),
    sectionPath: z.array(z.string().min(1)).optional(),
    siblingFanout: z.number().int().min(0).max(10).optional(),
  })
  .strict();

export type IngestConciergeRetrievalInput = z.infer<
  typeof IngestConciergeRetrievalInputSchema
>;

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
} as const satisfies RetrievalContractMeta;
