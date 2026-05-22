// Typed contract for POST /capabilities/:id/promote (status transitions).
// Promotion already exists in awip-api/promotion_gates.ts; this contract names the inputs/outputs
// so the new event types (status_changed, version_bumped, deprecated, owning_module_changed) emit consistently.

export type PromoteInput = {
  capability_id: string;
  to_status: "experimental" | "available" | "deprecated";
  reason: string;          // free-text rationale (operator-visible)
  evidence_ref?: string;   // optional: link to notebook entry, ADR, or run id
  ack_rationale?: string;  // existing path: required when promotion gates warn
};

export type CapabilityEventType =
  | "registered"
  | "status_changed"
  | "version_bumped"
  | "deprecated"
  | "owning_module_changed"
  | "promoted_to_available"   // legacy alias for status_changed→available
  | "warnings_acknowledged"
  | "approval_requested"
  | "approval_decided"
  | "resolution_warning";

export function validatePromoteInput(raw: unknown): { ok: true; value: PromoteInput } | { ok: false; error: string } {
  if (!raw || typeof raw !== "object") return { ok: false, error: "body must be an object" };
  const b = raw as Record<string, unknown>;
  if (typeof b.to_status !== "string" || !["experimental", "available", "deprecated"].includes(b.to_status)) {
    return { ok: false, error: "to_status must be experimental|available|deprecated" };
  }
  if (typeof b.reason !== "string" || b.reason.trim().length < 4) {
    return { ok: false, error: "reason required (>=4 chars)" };
  }
  return {
    ok: true,
    value: {
      capability_id: String(b.capability_id ?? ""),
      to_status: b.to_status as PromoteInput["to_status"],
      reason: b.reason.trim(),
      evidence_ref: typeof b.evidence_ref === "string" ? b.evidence_ref : undefined,
      ack_rationale: typeof b.ack_rationale === "string" ? b.ack_rationale : undefined,
    },
  };
}

export const PROMOTE_CONTRACT = {
  canonicalQuestion: "Can this capability transition to the requested status, and what event fires?",
  mandatoryEvidence: ["capability_id", "to_status", "reason"] as const,
  optionalEvidence: ["evidence_ref", "ack_rationale"] as const,
  escalationRule: "Gates evaluated by promotion_gates.evaluateCapability; ack_rationale required if any warn.",
  auditTable: "capability_events",
  truthEntity: "Capability",
} as const;
