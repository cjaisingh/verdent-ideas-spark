// s6.1/t0 — Retrieval-shape declaration registry.
//
// Every consumer surface (edge fn, cron, UI route, agent loop) that reads
// "knowledge" — prose, tabular rows, graph traversals, time-series, etc. —
// MUST have a row in `public.retrieval_contracts` declaring which of the 5
// shapes it consumes BEFORE we pick a store/vendor for it.
//
// This is the typed shadow of the table row. Used by:
//   - supabase/functions/_shared/contracts/retrieval_contracts_test.ts
//   - any new edge fn that wants to assert its declaration at boot
//
// See:
//   - mem://preferences/retrieval-shapes
//   - mem://features/retrieval-contracts-registry
//   - docs/retrieval-contracts.md
//
// Rule: declarations are git-versioned. To add/change a consumer:
//   1. INSERT/UPDATE via migration (never via UI).
//   2. CHANGELOG entry.
//   3. Update this file if a new shape or consumer_kind is introduced.

import type { RetrievalContractMeta, RetrievalShape } from "./retrieval-contract.ts";

export type ConsumerKind = "edge_fn" | "cron" | "ui_route" | "agent_loop";
export type DeclarationStatus = "declared" | "implemented" | "deprecated";

export type RetrievalShapeDeclaration = RetrievalContractMeta & {
  consumer: string;
  consumerKind: ConsumerKind;
  status: DeclarationStatus;
  notes?: string;
};

export const CONSUMER_KINDS: readonly ConsumerKind[] = [
  "edge_fn",
  "cron",
  "ui_route",
  "agent_loop",
] as const;

export const DECLARATION_STATUSES: readonly DeclarationStatus[] = [
  "declared",
  "implemented",
  "deprecated",
] as const;

// Mirror of the `retrieval_contracts` row, snake_case (DB-shaped).
export type RetrievalContractRow = {
  id: string;
  consumer: string;
  consumer_kind: ConsumerKind;
  shape: RetrievalShape;
  store: string;
  primary_key: string;
  token_budget: number;
  freshness_window: string;
  fallback: string;
  declared_by: string;
  status: DeclarationStatus;
  notes: string | null;
  created_at: string;
  updated_at: string;
};

export function rowToDeclaration(row: RetrievalContractRow): RetrievalShapeDeclaration {
  return {
    consumer: row.consumer,
    consumerKind: row.consumer_kind,
    shape: row.shape,
    store: row.store,
    primaryKey: row.primary_key,
    tokenBudget: row.token_budget,
    freshnessWindow: row.freshness_window,
    fallback: row.fallback,
    declaredBy: row.declared_by,
    status: row.status,
    notes: row.notes ?? undefined,
  };
}

export function isComplete(d: Partial<RetrievalShapeDeclaration>): d is RetrievalShapeDeclaration {
  return Boolean(
    d.consumer &&
      d.consumerKind &&
      d.shape &&
      d.store &&
      d.primaryKey &&
      typeof d.tokenBudget === "number" && d.tokenBudget > 0 &&
      d.freshnessWindow &&
      d.fallback &&
      d.declaredBy &&
      d.status,
  );
}
