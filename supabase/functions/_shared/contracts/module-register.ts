// Typed contract for POST /capabilities/register.
// See docs/agents/contract-checklist.md for the rules behind this shape.

export type CapabilityStatus = "planned" | "experimental" | "available" | "deprecated";

export type RegisterCapabilityInput = {
  id: string;                     // stable content-address (e.g. "desk_utilisation_measurement")
  name: string;
  description?: string | null;
  status: CapabilityStatus;
  version: string;                // semver-ish; required so version_bumped event can fire
  owning_module: string;          // must match the calling token's scope (or be omitted for legacy global token)
  inputs_required?: Array<Record<string, unknown>>;
  outputs_provided?: Array<Record<string, unknown>>;
  idempotency_key: string;        // mandatory, 1-200 printable ASCII no whitespace; also accepted via Idempotency-Key header
};

const ID_RE = /^[a-z][a-z0-9_]{2,79}$/;
const VERSION_RE = /^\d+\.\d+\.\d+(?:[-+][A-Za-z0-9._-]+)?$/;
const STATUSES: readonly CapabilityStatus[] = ["planned", "experimental", "available", "deprecated"];

export function validateRegisterInput(raw: unknown): { ok: true; value: RegisterCapabilityInput } | { ok: false; error: string } {
  if (!raw || typeof raw !== "object") return { ok: false, error: "body must be an object" };
  const b = raw as Record<string, unknown>;
  if (typeof b.id !== "string" || !ID_RE.test(b.id)) return { ok: false, error: "id must match [a-z][a-z0-9_]{2,79}" };
  if (typeof b.name !== "string" || b.name.length < 1) return { ok: false, error: "name required" };
  if (typeof b.status !== "string" || !STATUSES.includes(b.status as CapabilityStatus)) {
    return { ok: false, error: `status must be one of ${STATUSES.join(",")}` };
  }
  if (typeof b.version !== "string" || !VERSION_RE.test(b.version)) return { ok: false, error: "version must be semver (e.g. 0.1.0)" };
  if (typeof b.owning_module !== "string" || b.owning_module.length < 1) return { ok: false, error: "owning_module required" };
  if (b.idempotency_key !== undefined && (typeof b.idempotency_key !== "string" || !/^[!-~]{1,200}$/.test(b.idempotency_key))) {
    return { ok: false, error: "idempotency_key must be 1-200 printable ASCII, no whitespace" };
  }
  return {
    ok: true,
    value: {
      id: b.id,
      name: b.name,
      description: (b.description as string | null | undefined) ?? null,
      status: b.status as CapabilityStatus,
      version: b.version,
      owning_module: b.owning_module,
      inputs_required: Array.isArray(b.inputs_required) ? b.inputs_required as Array<Record<string, unknown>> : [],
      outputs_provided: Array.isArray(b.outputs_provided) ? b.outputs_provided as Array<Record<string, unknown>> : [],
      idempotency_key: (b.idempotency_key as string) ?? "",
    },
  };
}

export const REGISTER_CONTRACT = {
  canonicalQuestion: "Should this capability declaration be persisted and what event(s) should fire?",
  mandatoryEvidence: ["id", "name", "status", "version", "owning_module"] as const,
  optionalEvidence: ["description", "inputs_required", "outputs_provided"] as const,
  escalationRule: "Reject if token scope owning_module != payload owning_module. Emit 409 if idempotency-key collides with different body.",
  auditTable: "capability_events",
  truthEntity: "Capability",
} as const;
