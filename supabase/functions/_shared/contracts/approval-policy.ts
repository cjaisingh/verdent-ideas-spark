// W10-S2 — deterministic document approval-policy evaluator.
//
// Given a records_class's policy (mode + auto_conditions) and the parse
// signals, decides whether a freshly parsed file is auto-approved or must wait
// for an operator. Pure + unit-tested so ingest-callback (slice 2) can call it
// without embedding policy logic. Mirrors document_approval_policies (migration
// 20260717160000).

import type { RecordsClass } from "./records-class.ts";

export const APPROVAL_MODES = ["auto", "operator", "four_eyes"] as const;
export type ApprovalMode = (typeof APPROVAL_MODES)[number];

// The lifecycle states this evaluator can produce for a newly parsed file.
export type NewFileLifecycle = "auto_approved" | "pending_review";

export type AutoConditions = {
  require_clean_parse?: boolean;
  require_lawful_basis?: boolean;
};

export type ParseSignals = {
  cleanParse: boolean;    // parse finished without failure
  lawfulBasis: boolean;   // a lawful basis for holding the data is declared
};

// Reference copy of the seeds — lets callers/tests reason without a DB read.
// The DB row is authoritative at runtime.
export const DEFAULT_APPROVAL_POLICIES: Record<
  RecordsClass,
  { mode: ApprovalMode; auto_conditions: AutoConditions }
> = {
  contract:       { mode: "operator", auto_conditions: {} },
  certificate:    { mode: "operator", auto_conditions: {} },
  register:       { mode: "operator", auto_conditions: {} },
  model:          { mode: "operator", auto_conditions: {} },
  drawing:        { mode: "operator", auto_conditions: {} },
  correspondence: { mode: "auto", auto_conditions: { require_clean_parse: true, require_lawful_basis: true } },
  media:          { mode: "auto", auto_conditions: { require_clean_parse: true, require_lawful_basis: true } },
  other:          { mode: "auto", auto_conditions: { require_clean_parse: true, require_lawful_basis: true } },
};

export type PolicyDecision = {
  lifecycle: NewFileLifecycle;
  reason: string;
};

// Deterministic. operator / four_eyes always route to review. auto approves
// only when every declared condition is satisfied.
export function evaluateApprovalPolicy(
  mode: ApprovalMode,
  autoConditions: AutoConditions,
  signals: ParseSignals,
): PolicyDecision {
  if (mode !== "auto") {
    return { lifecycle: "pending_review", reason: `${mode} policy requires a reviewer` };
  }
  if (autoConditions.require_clean_parse && !signals.cleanParse) {
    return { lifecycle: "pending_review", reason: "auto policy: parse not clean" };
  }
  if (autoConditions.require_lawful_basis && !signals.lawfulBasis) {
    return { lifecycle: "pending_review", reason: "auto policy: no lawful basis declared" };
  }
  return { lifecycle: "auto_approved", reason: "auto policy conditions met" };
}
