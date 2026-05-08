// Pure unit tests for the promotion gate evaluator. No network required.
//
// Run: deno test supabase/functions/awip-api/promotion_gates_test.ts

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  evaluateCapability,
  refineConnectorsGate,
  type CapabilityRow,
  type EvaluationInput,
} from "./promotion_gates.ts";

const baseCap = (over: Partial<CapabilityRow> = {}): CapabilityRow => ({
  id: "cap.test",
  name: "Test capability",
  description: "A capability for tests",
  status: "experimental",
  version: "1.0.0",
  owning_module: "test_module",
  inputs_required: [{ kind: "sensor_feed" }],
  outputs_provided: [{ metric: "x" }],
  ...over,
});

const baseInput = (capOver: Partial<CapabilityRow> = {}, over: Partial<EvaluationInput> = {}): EvaluationInput => ({
  capability: baseCap(capOver),
  events: [
    { event_type: "registered", created_at: "2025-01-01T00:00:00Z" },
    { event_type: "connector_attached", created_at: "2025-01-02T00:00:00Z" },
  ],
  approvals: [],
  qaChecksPhase3: [{ criterion: "qa-1", status: "pass", phase_key: "phase-3" }],
  okrRequiredCapabilityIds: new Set(["cap.test"]),
  ...over,
});

Deno.test("fully ready capability is promotable", () => {
  const r = evaluateCapability(baseInput());
  assertEquals(r.summary.fail, 0);
  assert(r.summary.promotable);
});

Deno.test("missing manifest fields fail", () => {
  const r = evaluateCapability(baseInput({ description: "" }));
  const g = r.gates.find((x) => x.key === "manifest_complete")!;
  assertEquals(g.verdict, "fail");
  assert(!r.summary.promotable);
});

Deno.test("scaffold version produces warn (not fail)", () => {
  const r = evaluateCapability(baseInput({ version: "0.1.0" }));
  const g = r.gates.find((x) => x.key === "manifest_complete")!;
  assertEquals(g.verdict, "warn");
  assert(r.summary.promotable, "warn alone should not block");
  assert(r.summary.ack_required);
});

Deno.test("empty inputs/outputs fail", () => {
  const r = evaluateCapability(baseInput({ inputs_required: [], outputs_provided: [] }));
  const g = r.gates.find((x) => x.key === "inputs_outputs_declared")!;
  assertEquals(g.verdict, "fail");
});

Deno.test("external inputs without connectors fails", () => {
  const r = evaluateCapability(baseInput({}, {
    events: [{ event_type: "registered", created_at: "2025-01-01T00:00:00Z" }],
  }));
  const g = r.gates.find((x) => x.key === "connectors_wired")!;
  assertEquals(g.verdict, "fail");
});

Deno.test("no external inputs => connectors gate passes", () => {
  const r = evaluateCapability(baseInput({ inputs_required: [{ metric: "x" }] }, {
    events: [{ event_type: "registered", created_at: "2025-01-01T00:00:00Z" }],
  }));
  const g = r.gates.find((x) => x.key === "connectors_wired")!;
  assertEquals(g.verdict, "pass");
});

Deno.test("live resolution warning => warn until acked", () => {
  const events = [
    { event_type: "registered", created_at: "2025-01-01T00:00:00Z" },
    { event_type: "connector_attached", created_at: "2025-01-02T00:00:00Z" },
    { event_type: "resolution_warning", created_at: "2025-01-03T00:00:00Z" },
  ];
  const warn = evaluateCapability(baseInput({}, { events }));
  assertEquals(warn.gates.find((x) => x.key === "dependencies_resolved")!.verdict, "warn");

  const acked = evaluateCapability(baseInput({}, {
    events: [...events, { event_type: "warnings_acknowledged", created_at: "2025-01-04T00:00:00Z" }],
  }));
  assertEquals(acked.gates.find((x) => x.key === "dependencies_resolved")!.verdict, "pass");
});

Deno.test("old warning predating last registration is ignored", () => {
  const events = [
    { event_type: "resolution_warning", created_at: "2024-12-01T00:00:00Z" },
    { event_type: "registered", created_at: "2025-01-01T00:00:00Z" },
    { event_type: "connector_attached", created_at: "2025-01-02T00:00:00Z" },
  ];
  const r = evaluateCapability(baseInput({}, { events }));
  assertEquals(r.gates.find((x) => x.key === "dependencies_resolved")!.verdict, "pass");
});

Deno.test("missing OKR demand => warn", () => {
  const r = evaluateCapability(baseInput({}, { okrRequiredCapabilityIds: new Set() }));
  assertEquals(r.gates.find((x) => x.key === "demand_present")!.verdict, "warn");
  assert(r.summary.promotable, "warn alone should not block promotion");
});

Deno.test("failing qa check blocks", () => {
  const r = evaluateCapability(baseInput({}, {
    qaChecksPhase3: [{ criterion: "qa-1", status: "unknown", phase_key: "phase-3" }],
  }));
  assertEquals(r.gates.find((x) => x.key === "qa_phase_3_passing")!.verdict, "fail");
});

Deno.test("pending approval blocks", () => {
  const r = evaluateCapability(baseInput({}, {
    approvals: [{ id: "a1", status: "pending", capability_id: "cap.test" }],
  }));
  assertEquals(r.gates.find((x) => x.key === "no_open_approvals")!.verdict, "fail");
});

Deno.test("already available => not_already_available fails", () => {
  const r = evaluateCapability(baseInput({ status: "available" }));
  assertEquals(r.gates.find((x) => x.key === "not_already_available")!.verdict, "fail");
  assert(!r.summary.promotable);
});

Deno.test("refineConnectorsGate flips verdict and recomputes summary", () => {
  const input = baseInput({}, {
    events: [{ event_type: "registered", created_at: "2025-01-01T00:00:00Z" }],
  });
  const r = evaluateCapability(input);
  assertEquals(r.gates.find((x) => x.key === "connectors_wired")!.verdict, "fail");
  refineConnectorsGate(r, input.capability, 2);
  assertEquals(r.gates.find((x) => x.key === "connectors_wired")!.verdict, "pass");
  assertEquals(r.summary.fail, 0);
  assert(r.summary.promotable);
});
