// Shared types mirroring supabase/functions/awip-api/promotion_gates.ts return shapes.

export type GateVerdict = "pass" | "warn" | "fail";

export type GateKey =
  | "manifest_complete"
  | "inputs_outputs_declared"
  | "connectors_wired"
  | "dependencies_resolved"
  | "demand_present"
  | "qa_phase_3_passing"
  | "no_open_approvals"
  | "not_already_available";

export type GateResult = {
  key: GateKey;
  verdict: GateVerdict;
  reason: string;
  action_hint: string;
};

export type CapabilityPromotionStatus = {
  capability: { id: string; name: string | null; status: string; owning_module: string | null };
  gates: GateResult[];
  summary: { pass: number; warn: number; fail: number; promotable: boolean; ack_required: boolean };
};

export type PromotionStatusResponse = {
  summary: { total: number; promotable: number; blocked: number; already_available: number };
  capabilities: CapabilityPromotionStatus[];
};

export const GATE_LABEL: Record<GateKey, string> = {
  manifest_complete: "Manifest complete",
  inputs_outputs_declared: "Inputs & outputs declared",
  connectors_wired: "Connectors wired",
  dependencies_resolved: "Dependencies resolved",
  demand_present: "Demand present",
  qa_phase_3_passing: "Phase-3 QA passing",
  no_open_approvals: "No open approvals",
  not_already_available: "Not already available",
};
