// Retrieval contract for the Phase 5 entity/tenant resolver.
//
// Binds incoming descriptors (asset code, name, postcode, BIM GUID) to a
// tenant_node. Data shape: graph — `tenant_nodes` + `tenant_node_aliases`
// are a DAG; flattening to text drops ancestry, which is the whole point.
//
// See mem://preferences/retrieval-shapes and docs/phases-5-6-6b-research.md.
// Status: stub — contract types only. Implementation lands with sprint s5.1.

import { z } from "https://esm.sh/zod@3.23.8";
import type { RetrievalContractMeta } from "./retrieval-contract.ts";

export const RESOLVER_DESCRIPTOR_KINDS = [
  "asset_code",
  "name",
  "address",
  "postcode",
  "bim_ifc_guid",
  "rics_id",
  "os_uprn",
  "sap_floc",
  "other",
] as const;

export const ResolverDescriptorSchema = z
  .object({
    kind: z.enum(RESOLVER_DESCRIPTOR_KINDS),
    value: z.string().min(1, "descriptor value must be non-empty"),
    authoritative: z.boolean().optional(),
  })
  .strict();

export type ResolverDescriptor = z.infer<typeof ResolverDescriptorSchema>;

export const ResolverRetrievalInputSchema = z
  .object({
    tenantId: z.string().uuid("tenantId must be a uuid"),
    descriptors: z.array(ResolverDescriptorSchema).min(1, "descriptors must be non-empty"),
    parentNodeId: z.string().uuid().optional(),
    topK: z.number().int().min(1).max(50).optional(),
  })
  .strict();

export type ResolverRetrievalInput = z.infer<typeof ResolverRetrievalInputSchema>;

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
  fallback:
    "Never cross tenant_id. If zero candidates, return empty — propose-new-node is a separate operator flow, not a resolver fallback.",
  declaredBy: "docs/agents/contract-checklist.md",
} as const satisfies RetrievalContractMeta;

// Note: matchOrder lives outside the meta type since it is contract-specific.
export const RESOLVER_MATCH_ORDER = [
  "authoritative",
  "alias_exact",
  "alias_fts",
  "embedding_hint",
] as const;
