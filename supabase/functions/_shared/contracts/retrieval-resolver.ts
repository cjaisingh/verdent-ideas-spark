// Retrieval contract for the Phase 5 entity/tenant resolver.
//
// Binds incoming descriptors (asset code, name, postcode, BIM GUID) to a
// tenant_node. Data shape: graph — `tenant_nodes` + `tenant_node_aliases`
// are a DAG; flattening to text drops ancestry, which is the whole point.
//
// See mem://preferences/retrieval-shapes and docs/phases-5-6-6b-research.md.
// Status: stub — contract types only. Implementation lands with sprint s5.1.

export type ResolverDescriptor = {
  kind:
    | "asset_code"
    | "name"
    | "address"
    | "postcode"
    | "bim_ifc_guid"
    | "rics_id"
    | "os_uprn"
    | "sap_floc"
    | "other";
  value: string;
  /** Authoritative-namespace descriptors short-circuit fuzzy match. */
  authoritative?: boolean;
};

export type ResolverRetrievalInput = {
  tenantId: string;
  descriptors: ResolverDescriptor[];
  /** Optional parent hint — narrows search to subtree. */
  parentNodeId?: string;
  /** Max candidates returned for operator review when ambiguous. */
  topK?: number;
};

export type ResolverRetrievalOutput = {
  candidates: Array<{
    nodeId: string;
    ancestry: string[]; // root → leaf node IDs
    score: number;
    matchedDescriptors: ResolverDescriptor["kind"][];
    matchSource: "authoritative" | "alias_exact" | "alias_fts" | "embedding_hint";
  }>;
  /** True when an authoritative descriptor matched — caller must auto-bind. */
  authoritativeHit: boolean;
};

export const RESOLVER_RETRIEVAL_CONTRACT = {
  shape: "graph",
  store: "tenant_nodes + tenant_node_aliases (Postgres) — pgvector ONLY as last-resort hint",
  primaryKey: "tenant_node.id (tenant-scoped)",
  tokenBudget: 1000,
  freshnessWindow: "live (aliases mutate on every approval)",
  matchOrder: ["authoritative", "alias_exact", "alias_fts", "embedding_hint"] as const,
  fallback:
    "Never cross tenant_id. If zero candidates, return empty — propose-new-node is a separate operator flow, not a resolver fallback.",
  declaredBy: "docs/agents/contract-checklist.md",
} as const;
