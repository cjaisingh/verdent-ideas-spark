// Shared meta-shape for every Phase 5/6 retrieval contract.
//
// Every `retrieval-*.ts` contract `const` closes with:
//   } as const satisfies RetrievalContractMeta;
// so a missing or typoed key fails typecheck before it can drift into the
// overnight runner. See mem://preferences/retrieval-shapes.

export type RetrievalShape =
  | "prose"
  | "hierarchical-doc"
  | "tabular"
  | "graph"
  | "relational"
  | "time-series";

export const RETRIEVAL_SHAPES: readonly RetrievalShape[] = [
  "prose",
  "hierarchical-doc",
  "tabular",
  "graph",
  "relational",
  "time-series",
] as const;

export type RetrievalContractMeta = {
  shape: RetrievalShape;
  store: string;
  primaryKey: string;
  tokenBudget: number;
  freshnessWindow: string;
  fallback: string;
  declaredBy: string;
};
