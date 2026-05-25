// Unit tests for the tasks_done resolver used by session-summary-log.
//
// Covers the failure modes that produced "UUID parse failed" before:
//   - bare task_id strings that are NOT UUIDs (natural keys like "s5.1/t3")
//   - mixed UUID + key + bogus payloads (partial-write semantics)
//   - empty / whitespace task_ids
//   - keys that are not present in roadmap_tasks (unresolved bucket)
//   - duplicates within a single payload (caller-side passthrough; DB upsert
//     dedups on (session_id, task_id) — we just assert we don't drop rows
//     here so the upsert path sees both)
//   - fallback duration when ended_at/started_at differ but duration_ms omitted

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  buildWorkLogRows,
  collectKeysToResolve,
  normaliseTasks,
  UUID_RE,
} from "./tasks-done-resolver.ts";

const UUID_A = "11111111-1111-4111-8111-111111111111";
const UUID_B = "22222222-2222-4222-8222-222222222222";
const UUID_C = "33333333-3333-4333-8333-333333333333";
const SESSION = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const STARTED = "2026-05-25T08:00:00Z";
const ENDED = "2026-05-25T08:30:00Z";

Deno.test("normaliseTasks: drops empty/whitespace task_ids and trims", () => {
  const out = normaliseTasks([
    "  s5.1/t3  ",
    "",
    "   ",
    { task_id: "  s6.1/t0  " },
    { task_id: "" },
    // @ts-expect-error — runtime guard against non-string task_id
    { task_id: 42 },
    // @ts-expect-error — null entry
    null,
  ]);
  assertEquals(out.map((t) => t.task_id), ["s5.1/t3", "s6.1/t0"]);
});

Deno.test("collectKeysToResolve: returns unique non-UUID values only", () => {
  const out = collectKeysToResolve(
    normaliseTasks(["s5.1/t3", UUID_A, "s5.1/t3", "s6.1/t0", UUID_B]),
  );
  assertEquals(new Set(out), new Set(["s5.1/t3", "s6.1/t0"]));
});

Deno.test("UUID_RE: accepts valid v4-style and rejects natural keys", () => {
  assert(UUID_RE.test(UUID_A));
  assert(!UUID_RE.test("s5.1/t3"));
  assert(!UUID_RE.test("not-a-uuid"));
  assert(!UUID_RE.test(""));
});

Deno.test("buildWorkLogRows: partial-write — mixes resolved UUIDs, resolved keys, unresolved keys", () => {
  const keyMap = new Map<string, string>([
    ["s5.1/t3", UUID_B],
    // "s5.1/t5" intentionally missing
  ]);
  const built = buildWorkLogRows({
    tasks: [
      UUID_A,                                  // direct UUID
      "s5.1/t3",                               // resolves via keyMap
      "s5.1/t5",                               // unresolved → bucket
      { task_id: "not-a-task", summary: "x" }, // unresolved → bucket
      { task_id: UUID_C, tokens_total: 1234 }, // direct UUID with metadata
    ],
    keyMap,
    session_id: SESSION,
    startedAt: STARTED,
    endedAt: ENDED,
    agent: "lovable",
    outcome: "fallback summary",
  });

  assertEquals(built.rows.length, 3);
  assertEquals(built.unresolved.sort(), ["not-a-task", "s5.1/t5"]);

  const ids = built.rows.map((r) => r.task_id);
  assertEquals(ids, [UUID_A, UUID_B, UUID_C]);

  // Per-row carry-through
  assertEquals(built.rows[0].author, "lovable");
  assertEquals(built.rows[0].source, "session_summary");
  assertEquals(built.rows[0].summary, "fallback summary");
  assertEquals(built.rows[2].tokens_total, 1234);
});

Deno.test("buildWorkLogRows: empty tasks_done → no rows, no unresolved", () => {
  const built = buildWorkLogRows({
    tasks: [],
    keyMap: new Map(),
    session_id: SESSION,
    startedAt: STARTED,
    endedAt: ENDED,
    agent: "lovable",
  });
  assertEquals(built.rows, []);
  assertEquals(built.unresolved, []);
});

Deno.test("buildWorkLogRows: all unresolved → empty rows, full unresolved list", () => {
  const built = buildWorkLogRows({
    tasks: ["ghost-a", "ghost-b", { task_id: "ghost-c" }],
    keyMap: new Map(),
    session_id: SESSION,
    startedAt: STARTED,
    endedAt: ENDED,
    agent: "lovable",
  });
  assertEquals(built.rows, []);
  assertEquals(built.unresolved.sort(), ["ghost-a", "ghost-b", "ghost-c"]);
});

Deno.test("buildWorkLogRows: fallback duration derived from started/ended when omitted", () => {
  const built = buildWorkLogRows({
    tasks: [{ task_id: UUID_A }],
    keyMap: new Map(),
    session_id: SESSION,
    startedAt: STARTED,
    endedAt: ENDED,
    agent: "lovable",
  });
  assertEquals(built.rows[0].duration_ms, 30 * 60 * 1000);
});

Deno.test("buildWorkLogRows: explicit duration_ms wins over fallback", () => {
  const built = buildWorkLogRows({
    tasks: [{ task_id: UUID_A, duration_ms: 4242 }],
    keyMap: new Map(),
    session_id: SESSION,
    startedAt: STARTED,
    endedAt: ENDED,
    agent: "lovable",
  });
  assertEquals(built.rows[0].duration_ms, 4242);
});

Deno.test("buildWorkLogRows: duplicate task_ids in the payload pass through (DB upsert dedups)", () => {
  // Caller-side we DO NOT pre-dedup — the (session_id, task_id) unique index
  // and `ignoreDuplicates: true` upsert handle that. We just confirm we don't
  // silently drop here, so the count the caller logs matches what it sent.
  const built = buildWorkLogRows({
    tasks: [UUID_A, UUID_A, { task_id: UUID_A, tokens_total: 99 }],
    keyMap: new Map(),
    session_id: SESSION,
    startedAt: STARTED,
    endedAt: ENDED,
    agent: "lovable",
  });
  assertEquals(built.rows.length, 3);
});

Deno.test("buildWorkLogRows: token + metadata fields default to null when absent", () => {
  const built = buildWorkLogRows({
    tasks: [{ task_id: UUID_A }],
    keyMap: new Map(),
    session_id: SESSION,
    startedAt: STARTED,
    endedAt: ENDED,
    agent: "claude-code",
  });
  const r = built.rows[0];
  assertEquals(r.tokens_in, null);
  assertEquals(r.tokens_out, null);
  assertEquals(r.tokens_total, null);
  assertEquals(r.model, null);
  assertEquals(r.model_provider, null);
  assertEquals(r.issues, null);
  assertEquals(r.fixes, null);
  assertEquals(r.author, "claude-code");
});
