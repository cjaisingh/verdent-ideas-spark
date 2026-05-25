// Compile-time and lightweight runtime tests for the four Phase 5/6 retrieval
// contracts. Run via `supabase--test_edge_functions`.
//
// What this locks in:
//   1. Each contract `const` carries every RetrievalContractMeta key (compile).
//   2. Each <Name>Input type is `z.infer<typeof <Name>InputSchema>` (compile).
//   3. Minimal valid samples parse cleanly (runtime).
//   4. Invalid samples — empty sourceRef, sampleSize > 200, bad uuid, empty
//      descriptors, siblingWindowDays out of range — fail with a clear error.

import {
  assert,
  assertEquals,
  assertThrows,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import { z } from "https://esm.sh/zod@3.23.8";

import {
  RETRIEVAL_SHAPES,
  type RetrievalContractMeta,
} from "./retrieval-contract.ts";

import {
  INGEST_CONCIERGE_RETRIEVAL_CONTRACT,
  IngestConciergeRetrievalInputSchema,
  type IngestConciergeRetrievalInput,
} from "./retrieval-ingest-concierge.ts";

import {
  VALIDATION_AGENT_RETRIEVAL_CONTRACT,
  ValidationAgentRetrievalInputSchema,
  type ValidationAgentRetrievalInput,
} from "./retrieval-validation-agent.ts";

import {
  RESOLVER_RETRIEVAL_CONTRACT,
  ResolverRetrievalInputSchema,
  type ResolverRetrievalInput,
} from "./retrieval-resolver.ts";

import {
  CONFLICT_TRIAGE_RETRIEVAL_CONTRACT,
  ConflictTriageRetrievalInputSchema,
  type ConflictTriageRetrievalInput,
} from "./retrieval-conflict-triage.ts";

import {
  PHASE_CONTRACTS,
  getPhaseBinding,
  rejectEnvelope,
  type PhaseKey,
} from "./phase-contract-map.ts";

import { OvernightResponseEnvelopeSchema } from "./overnight-envelope.ts";

const UUID_A = "11111111-1111-4111-8111-111111111111";
const UUID_B = "22222222-2222-4222-8222-222222222222";
const UUID_C = "33333333-3333-4333-8333-333333333333";

// ---- Compile-time guard: <Name>Input ≡ z.infer<<Name>InputSchema> ---------
// If either side drifts, `assertSame` fails to typecheck.
type AssertEqual<A, B> = (<T>() => T extends A ? 1 : 2) extends
  (<T>() => T extends B ? 1 : 2) ? true : false;

function assertSame<_T extends true>(): void {}

assertSame<AssertEqual<IngestConciergeRetrievalInput, z.infer<typeof IngestConciergeRetrievalInputSchema>>>();
assertSame<AssertEqual<ValidationAgentRetrievalInput, z.infer<typeof ValidationAgentRetrievalInputSchema>>>();
assertSame<AssertEqual<ResolverRetrievalInput, z.infer<typeof ResolverRetrievalInputSchema>>>();
assertSame<AssertEqual<ConflictTriageRetrievalInput, z.infer<typeof ConflictTriageRetrievalInputSchema>>>();

// ---- Contract literal sanity ---------------------------------------------
const ALL_CONTRACTS: Array<[string, RetrievalContractMeta]> = [
  ["ingest_concierge", INGEST_CONCIERGE_RETRIEVAL_CONTRACT],
  ["validation_agent", VALIDATION_AGENT_RETRIEVAL_CONTRACT],
  ["resolver", RESOLVER_RETRIEVAL_CONTRACT],
  ["conflict_triage", CONFLICT_TRIAGE_RETRIEVAL_CONTRACT],
];

for (const [name, contract] of ALL_CONTRACTS) {
  Deno.test(`retrieval contract sanity: ${name}`, () => {
    assert(RETRIEVAL_SHAPES.includes(contract.shape), `shape "${contract.shape}" not in RETRIEVAL_SHAPES`);
    assert(contract.tokenBudget > 0, "tokenBudget must be > 0");
    assert(contract.store.length > 0, "store must be non-empty");
    assert(contract.primaryKey.length > 0, "primaryKey must be non-empty");
    assert(contract.fallback.length > 0, "fallback must be non-empty");
    assert(contract.declaredBy.length > 0, "declaredBy must be non-empty");
    assert(contract.freshnessWindow.length > 0, "freshnessWindow must be non-empty");
  });
}

// Cross-contract: shapes must be distinct (one shape per agent surface).
Deno.test("retrieval contracts: each contract declares a distinct shape", () => {
  const shapes = ALL_CONTRACTS.map(([, c]) => c.shape);
  assertEquals(new Set(shapes).size, shapes.length, `duplicate shape across contracts: ${shapes.join(", ")}`);
});

// ---- Valid input round-trips ---------------------------------------------
Deno.test("ingest_concierge: valid input parses", () => {
  const parsed = IngestConciergeRetrievalInputSchema.parse({
    sourceRef: { rawRecordId: "raw_123" },
    query: "What is the break clause?",
    sectionPath: ["3", "3.2"],
    siblingFanout: 2,
  });
  assertEquals(parsed.query, "What is the break clause?");
});

Deno.test("validation_agent: valid input parses", () => {
  const parsed = ValidationAgentRetrievalInputSchema.parse({
    sourceMappingId: UUID_A,
    stagingBatchId: UUID_B,
    columns: ["asset_code", "floor_area"],
    sampleSize: 50,
  });
  assertEquals(parsed.sampleSize, 50);
});

Deno.test("resolver: valid input parses", () => {
  const parsed = ResolverRetrievalInputSchema.parse({
    tenantId: UUID_A,
    descriptors: [{ kind: "asset_code", value: "AC-001", authoritative: true }],
    topK: 5,
  });
  assertEquals(parsed.descriptors.length, 1);
});

Deno.test("conflict_triage: valid input parses", () => {
  const parsed = ConflictTriageRetrievalInputSchema.parse({
    conflictId: UUID_C,
    includeSiblings: true,
    siblingWindowDays: 30,
  });
  assertEquals(parsed.siblingWindowDays, 30);
});

// ---- Invalid input rejected ----------------------------------------------
Deno.test("ingest_concierge: rejects empty sourceRef (no rawRecordId, no url)", () => {
  const err = assertThrows(() =>
    IngestConciergeRetrievalInputSchema.parse({
      sourceRef: {},
      query: "anything",
    })
  );
  assert(String(err).includes("sourceRef requires at least one"), `unexpected error: ${err}`);
});

Deno.test("ingest_concierge: rejects empty query", () => {
  assertThrows(() =>
    IngestConciergeRetrievalInputSchema.parse({
      sourceRef: { rawRecordId: "raw_1" },
      query: "",
    })
  );
});

Deno.test("validation_agent: rejects sampleSize > 200 with cap-aware message", () => {
  const err = assertThrows(() =>
    ValidationAgentRetrievalInputSchema.parse({
      sourceMappingId: UUID_A,
      stagingBatchId: UUID_B,
      sampleSize: 1000,
    })
  );
  assert(String(err).includes("200"), `expected 200-cap message, got: ${err}`);
});

Deno.test("validation_agent: rejects non-uuid sourceMappingId", () => {
  assertThrows(() =>
    ValidationAgentRetrievalInputSchema.parse({
      sourceMappingId: "not-a-uuid",
      stagingBatchId: UUID_B,
    })
  );
});

Deno.test("resolver: rejects non-uuid tenantId", () => {
  assertThrows(() =>
    ResolverRetrievalInputSchema.parse({
      tenantId: "not-a-uuid",
      descriptors: [{ kind: "asset_code", value: "AC-001" }],
    })
  );
});

Deno.test("resolver: rejects empty descriptors", () => {
  assertThrows(() =>
    ResolverRetrievalInputSchema.parse({
      tenantId: UUID_A,
      descriptors: [],
    })
  );
});

Deno.test("resolver: rejects unknown descriptor kind", () => {
  assertThrows(() =>
    ResolverRetrievalInputSchema.parse({
      tenantId: UUID_A,
      descriptors: [{ kind: "made_up_kind", value: "x" }],
    })
  );
});

Deno.test("conflict_triage: rejects siblingWindowDays out of range", () => {
  assertThrows(() =>
    ConflictTriageRetrievalInputSchema.parse({
      conflictId: UUID_C,
      siblingWindowDays: 9999,
    })
  );
});

Deno.test("conflict_triage: rejects non-uuid conflictId", () => {
  assertThrows(() =>
    ConflictTriageRetrievalInputSchema.parse({
      conflictId: "nope",
    })
  );
});

// ---- Phase → contract mapping --------------------------------------------
Deno.test("phase-contract-map: keys are exactly phase-5/6/6b/7", () => {
  const expected: PhaseKey[] = ["phase-5", "phase-6", "phase-6b", "phase-7"];
  assertEquals(new Set(Object.keys(PHASE_CONTRACTS)), new Set(expected));
});

Deno.test("phase-contract-map: every binding points to a known contract const", () => {
  const knownStores = new Set(ALL_CONTRACTS.map(([, c]) => c.store));
  for (const key of Object.keys(PHASE_CONTRACTS) as PhaseKey[]) {
    const binding = PHASE_CONTRACTS[key];
    assert(knownStores.has(binding.contract.store), `${key} binding contract not in ALL_CONTRACTS`);
    assert(binding.guardrails.length > 0, `${key} must declare ≥1 guardrail`);
  }
});

Deno.test("phase-contract-map: getPhaseBinding returns null for unknown key", () => {
  assertEquals(getPhaseBinding("phase-1"), null);
  assertEquals(getPhaseBinding(null), null);
  assertEquals(getPhaseBinding(""), null);
});

Deno.test("rejectEnvelope: accepts contract_acknowledged === store with known guardrail", () => {
  const b = PHASE_CONTRACTS["phase-5"];
  const reason = rejectEnvelope(b, {
    contract_acknowledged: b.contract.store,
    guardrails_respected: [b.guardrails[0]],
  });
  assertEquals(reason, null);
});

Deno.test("rejectEnvelope: rejects unknown guardrail entry", () => {
  const b = PHASE_CONTRACTS["phase-5"];
  const reason = rejectEnvelope(b, {
    contract_acknowledged: b.contract.declaredBy,
    guardrails_respected: ["made up rail"],
  });
  assert(reason && reason.includes("guardrails_respected"));
});

Deno.test("rejectEnvelope: rejects mismatched contract_acknowledged", () => {
  const b = PHASE_CONTRACTS["phase-6"];
  const reason = rejectEnvelope(b, {
    contract_acknowledged: "some other store",
    guardrails_respected: [b.guardrails[0]],
  });
  assert(reason && reason.includes("contract_acknowledged"));
});

Deno.test("OvernightResponseEnvelope: rejects missing contract_acknowledged", () => {
  const res = OvernightResponseEnvelopeSchema.safeParse({
    guardrails_respected: ["x"],
    summary: "ok",
  });
  assertEquals(res.success, false);
});

Deno.test("OvernightResponseEnvelope: parses a minimal valid envelope", () => {
  const res = OvernightResponseEnvelopeSchema.safeParse({
    contract_acknowledged: "anything",
    guardrails_respected: ["one"],
    summary: "looks ok",
  });
  assertEquals(res.success, true);
});

// ---- s6.1/t0: retrieval-shape declaration registry helpers ---------------
import {
  CONSUMER_KINDS,
  DECLARATION_STATUSES,
  isComplete,
  rowToDeclaration,
  type RetrievalContractRow,
} from "./retrieval-shape-declaration.ts";

Deno.test("declaration registry: CONSUMER_KINDS + DECLARATION_STATUSES stable", () => {
  assertEquals(CONSUMER_KINDS.length, 4);
  assertEquals(DECLARATION_STATUSES.length, 3);
});

Deno.test("declaration registry: rowToDeclaration maps snake → camel", () => {
  const row: RetrievalContractRow = {
    id: UUID_A,
    consumer: "morning-review",
    consumer_kind: "cron",
    shape: "hierarchical-doc",
    store: "postgres:public.morning_reviews",
    primary_key: "(id)",
    token_budget: 8000,
    freshness_window: "24h",
    fallback: "plain SELECT",
    declared_by: "plan:s6.1/t0",
    status: "implemented",
    notes: null,
    created_at: "2026-05-25T10:00:00Z",
    updated_at: "2026-05-25T10:00:00Z",
  };
  const d = rowToDeclaration(row);
  assertEquals(d.consumer, "morning-review");
  assertEquals(d.consumerKind, "cron");
  assertEquals(d.primaryKey, "(id)");
  assertEquals(d.tokenBudget, 8000);
  assert(isComplete(d));
});

Deno.test("declaration registry: isComplete rejects partials and bad token budget", () => {
  assertEquals(isComplete({ consumer: "x" }), false);
  assertEquals(
    isComplete({
      consumer: "x",
      consumerKind: "cron",
      shape: "prose",
      store: "s",
      primaryKey: "(id)",
      tokenBudget: 0,
      freshnessWindow: "1d",
      fallback: "f",
      declaredBy: "d",
      status: "declared",
    }),
    false,
  );
});

