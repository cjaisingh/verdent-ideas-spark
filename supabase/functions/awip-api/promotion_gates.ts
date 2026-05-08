// Pure gate evaluator for capability Phase-3 promotion.
// All inputs are plain data so the evaluator is unit-testable
// without hitting Supabase. The HTTP handler in index.ts is
// responsible for collecting these inputs from the database.

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

export type CapabilityRow = {
  id: string;
  name: string | null;
  description: string | null;
  status: string;
  version: string;
  owning_module: string | null;
  inputs_required: unknown[] | null;
  outputs_provided: unknown[] | null;
};

export type CapabilityEvent = {
  event_type: string;
  created_at: string;
  payload?: Record<string, unknown> | null;
};

export type ApprovalRow = {
  id: string;
  status: string;
  capability_id: string | null;
};

export type QaCheckRow = {
  criterion: string;
  status: string; // pass | fail | unknown
  phase_key: string;
};

export type EvaluationInput = {
  capability: CapabilityRow;
  events: CapabilityEvent[];          // for this capability, newest first or any order
  approvals: ApprovalRow[];           // pending only is fine; we filter again here
  qaChecksPhase3: QaCheckRow[];       // all phase-3 qa rows (shared across caps)
  okrRequiredCapabilityIds: Set<string>; // union from okr_measurements.required_capabilities
};

export type CapabilityPromotionStatus = {
  capability: { id: string; name: string | null; status: string; owning_module: string | null };
  gates: GateResult[];
  summary: { pass: number; warn: number; fail: number; promotable: boolean; ack_required: boolean };
};

const inputHasExternalKind = (inputs: unknown[] | null): boolean => {
  if (!inputs?.length) return false;
  return inputs.some((i) => i && typeof i === "object" && "kind" in (i as Record<string, unknown>));
};

const latestEventOf = (events: CapabilityEvent[], type: string): CapabilityEvent | null => {
  let latest: CapabilityEvent | null = null;
  for (const e of events) {
    if (e.event_type !== type) continue;
    if (!latest || new Date(e.created_at) > new Date(latest.created_at)) latest = e;
  }
  return latest;
};

const hasUnAckedWarning = (events: CapabilityEvent[]): boolean => {
  const lastRegister = latestEventOf(events, "registered");
  const lastAck = latestEventOf(events, "warnings_acknowledged");
  // Most recent ack that covers warnings
  const ackTs = lastAck ? new Date(lastAck.created_at).getTime() : 0;
  const regTs = lastRegister ? new Date(lastRegister.created_at).getTime() : 0;
  // Warning is "live" if newer than the latest registration AND newer than any ack.
  for (const e of events) {
    if (e.event_type !== "resolution_warning") continue;
    const ts = new Date(e.created_at).getTime();
    if (ts >= regTs && ts > ackTs) return true;
  }
  return false;
};

export function evaluateCapability(input: EvaluationInput): CapabilityPromotionStatus {
  const { capability, events, approvals, qaChecksPhase3, okrRequiredCapabilityIds } = input;
  const gates: GateResult[] = [];

  // not_already_available
  if (capability.status === "available" || capability.status === "deprecated") {
    gates.push({
      key: "not_already_available",
      verdict: "fail",
      reason: `Capability is already '${capability.status}'.`,
      action_hint: "No promotion needed.",
    });
  } else {
    gates.push({
      key: "not_already_available",
      verdict: "pass",
      reason: `Status is '${capability.status}'.`,
      action_hint: "",
    });
  }

  // manifest_complete
  const missing: string[] = [];
  if (!capability.name?.trim()) missing.push("name");
  if (!capability.description?.trim()) missing.push("description");
  if (!capability.owning_module?.trim()) missing.push("owning_module");
  if (!capability.version?.trim()) missing.push("version");
  const isScaffoldVersion = capability.version === "0.1.0";
  if (missing.length) {
    gates.push({
      key: "manifest_complete",
      verdict: "fail",
      reason: `Missing manifest field(s): ${missing.join(", ")}.`,
      action_hint: "Edit the source module's capabilities.json and re-register.",
    });
  } else if (isScaffoldVersion) {
    gates.push({
      key: "manifest_complete",
      verdict: "warn",
      reason: "Version is still the 0.1.0 scaffold default.",
      action_hint: "Bump version in capabilities.json before promoting.",
    });
  } else {
    gates.push({
      key: "manifest_complete",
      verdict: "pass",
      reason: "All manifest fields populated.",
      action_hint: "",
    });
  }

  // inputs_outputs_declared
  const inEmpty = !capability.inputs_required?.length;
  const outEmpty = !capability.outputs_provided?.length;
  if (inEmpty || outEmpty) {
    gates.push({
      key: "inputs_outputs_declared",
      verdict: "fail",
      reason: `${inEmpty ? "inputs_required" : ""}${inEmpty && outEmpty ? " and " : ""}${outEmpty ? "outputs_provided" : ""} empty.`,
      action_hint: "Declare inputs and outputs in the scaffold and redeploy register.",
    });
  } else {
    gates.push({
      key: "inputs_outputs_declared",
      verdict: "pass",
      reason: `${capability.inputs_required!.length} input(s), ${capability.outputs_provided!.length} output(s).`,
      action_hint: "",
    });
  }

  // connectors_wired — fail only when external inputs are declared but no connector row exists
  const lastRegister = latestEventOf(events, "registered");
  const connectorEvents = events.filter((e) => e.event_type === "connector_attached");
  const hasConnector = connectorEvents.length > 0; // best signal we have without joining capability_connectors
  // The handler will overwrite this verdict with connector-row count when it has the data.
  if (inputHasExternalKind(capability.inputs_required)) {
    if (hasConnector) {
      gates.push({
        key: "connectors_wired",
        verdict: "pass",
        reason: `${connectorEvents.length} connector event(s) recorded.`,
        action_hint: "",
      });
    } else {
      gates.push({
        key: "connectors_wired",
        verdict: "fail",
        reason: "External inputs declared but no connector wiring recorded.",
        action_hint: "Add a row in capability_connectors for the required connector(s).",
      });
    }
  } else {
    gates.push({
      key: "connectors_wired",
      verdict: "pass",
      reason: "No external connectors required.",
      action_hint: "",
    });
  }

  // dependencies_resolved
  if (hasUnAckedWarning(events)) {
    gates.push({
      key: "dependencies_resolved",
      verdict: "warn",
      reason: "One or more resolution_warning events newer than the last registration are not acknowledged.",
      action_hint: "Investigate event payload, fix the dependency, then ack warnings.",
    });
  } else {
    gates.push({
      key: "dependencies_resolved",
      verdict: "pass",
      reason: lastRegister ? "No live resolution warnings." : "No registration recorded yet.",
      action_hint: "",
    });
  }

  // demand_present (warn — never blocks outright)
  if (okrRequiredCapabilityIds.has(capability.id)) {
    gates.push({
      key: "demand_present",
      verdict: "pass",
      reason: "At least one OKR measurement requires this capability.",
      action_hint: "",
    });
  } else {
    gates.push({
      key: "demand_present",
      verdict: "warn",
      reason: "No OKR measurement currently requires this capability.",
      action_hint: "Tie an OKR measurement to it, or ack the warning if it is a utility capability.",
    });
  }

  // qa_phase_3_passing
  const failing = qaChecksPhase3.filter((q) => q.status !== "pass");
  if (failing.length) {
    gates.push({
      key: "qa_phase_3_passing",
      verdict: "fail",
      reason: `${failing.length} Phase-3 QA check(s) not passing: ${failing.map((f) => f.criterion).slice(0, 2).join("; ")}${failing.length > 2 ? "…" : ""}.`,
      action_hint: "Run probe or set judgement on the Master Plan QA panel.",
    });
  } else if (qaChecksPhase3.length === 0) {
    gates.push({
      key: "qa_phase_3_passing",
      verdict: "warn",
      reason: "No Phase-3 QA checks defined.",
      action_hint: "Add a QA check for Phase 3 success criteria.",
    });
  } else {
    gates.push({
      key: "qa_phase_3_passing",
      verdict: "pass",
      reason: `${qaChecksPhase3.length} Phase-3 QA check(s) passing.`,
      action_hint: "",
    });
  }

  // no_open_approvals
  const pending = approvals.filter((a) => a.capability_id === capability.id && a.status === "pending");
  if (pending.length) {
    gates.push({
      key: "no_open_approvals",
      verdict: "fail",
      reason: `${pending.length} pending approval(s) reference this capability.`,
      action_hint: "Decide pending approval(s) before promoting.",
    });
  } else {
    gates.push({
      key: "no_open_approvals",
      verdict: "pass",
      reason: "No pending approvals.",
      action_hint: "",
    });
  }

  let pass = 0, warn = 0, fail = 0;
  for (const g of gates) {
    if (g.verdict === "pass") pass++;
    else if (g.verdict === "warn") warn++;
    else fail++;
  }

  // For "already available" we don't want the gate's fail to block re-evaluation UI — but
  // it does prevent the Promote button (since promotion to available is the action).
  const promotable = fail === 0;
  const ack_required = warn > 0;

  return {
    capability: {
      id: capability.id,
      name: capability.name,
      status: capability.status,
      owning_module: capability.owning_module,
    },
    gates,
    summary: { pass, warn, fail, promotable, ack_required },
  };
}

// Helper used by the HTTP handler when it has live capability_connectors counts
// (more accurate than inferring from events). Mutates a gate verdict in place.
export function refineConnectorsGate(
  status: CapabilityPromotionStatus,
  capability: CapabilityRow,
  connectorRowCount: number,
): void {
  const idx = status.gates.findIndex((g) => g.key === "connectors_wired");
  if (idx === -1) return;
  if (!inputHasExternalKind(capability.inputs_required)) return; // pass already
  const old = status.gates[idx];
  if (connectorRowCount > 0) {
    status.gates[idx] = {
      key: "connectors_wired",
      verdict: "pass",
      reason: `${connectorRowCount} connector row(s) wired.`,
      action_hint: "",
    };
  } else {
    status.gates[idx] = {
      key: "connectors_wired",
      verdict: "fail",
      reason: "External inputs declared but no row in capability_connectors.",
      action_hint: "Add a row in capability_connectors for the required connector(s).",
    };
  }
  // Recompute summary if verdict changed.
  if (old.verdict !== status.gates[idx].verdict) {
    let pass = 0, warn = 0, fail = 0;
    for (const g of status.gates) {
      if (g.verdict === "pass") pass++;
      else if (g.verdict === "warn") warn++;
      else fail++;
    }
    status.summary = { pass, warn, fail, promotable: fail === 0, ack_required: warn > 0 };
  }
}
