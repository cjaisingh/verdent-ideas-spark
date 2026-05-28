// Unit tests for the shared recordOutOfScope writer. Uses an in-memory stub
// SupabaseClient so the test suite stays hermetic (no live DB).
//
// Covers:
//   - normalisation + dedup of incoming bullets
//   - idempotency: a Postgres 23505 unique-violation must move the title to
//     `skipped`, not throw
//   - subject_id derivation: same source_ref → same UUID across runs
//   - session_summary source path (proves the writer is source-agnostic, which
//     is the contract session-summary-log relies on)

import { assertEquals, assert } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { recordOutOfScope } from "./out-of-scope.ts";

type Row = Record<string, unknown>;

function makeStub(opts: { failTitles?: Set<string> } = {}) {
  const inserted: Row[] = [];
  const seen = new Set<string>(); // (source, source_ref, title) keys already "stored"

  const client = {
    from(_table: string) {
      return {
        insert(row: Row) {
          const key = `${row.source}|${row.source_ref}|${row.title}`;
          const shouldFail = opts.failTitles?.has(String(row.title));
          const isDup = seen.has(key);
          return {
            select(_sel: string) {
              return {
                single() {
                  if (shouldFail || isDup) {
                    return Promise.resolve({
                      data: null,
                      error: { code: "23505", message: "unique_violation" },
                    });
                  }
                  seen.add(key);
                  inserted.push(row);
                  return Promise.resolve({
                    data: { id: `row-${inserted.length}`, title: row.title },
                    error: null,
                  });
                },
              };
            },
          };
        },
      };
    },
  };

  // deno-lint-ignore no-explicit-any
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { sb: client as any, inserted, seen };
}

Deno.test("recordOutOfScope: dedups + normalises and writes all unique rows", async () => {
  const { sb, inserted } = makeStub();
  const res = await recordOutOfScope(sb, {
    items: ["  UI badge ", "UI badge", "Backfill", "  "],
    source: "plan_footer",
    source_ref: "plan:p1",
  });
  assertEquals(res.parsed_count, 2);
  assertEquals(res.created.length, 2);
  assertEquals(res.skipped.length, 0);
  assertEquals(inserted.map((r) => r.title), ["UI badge", "Backfill"]);
  assertEquals(inserted[0].source, "plan_footer");
  assertEquals(inserted[0].source_ref, "plan:p1");
  assertEquals(inserted[0].status, "open");
  assertEquals(inserted[0].night_eligible, false);
});

Deno.test("recordOutOfScope: re-posting same source_ref skips via 23505 path", async () => {
  const { sb } = makeStub();
  const first = await recordOutOfScope(sb, {
    items: ["A", "B", "C"],
    source: "plan_footer",
    source_ref: "plan:p2",
  });
  assertEquals(first.created.length, 3);

  const second = await recordOutOfScope(sb, {
    items: ["A", "B", "C"],
    source: "plan_footer",
    source_ref: "plan:p2",
  });
  assertEquals(second.parsed_count, 3);
  assertEquals(second.created.length, 0);
  assertEquals(second.skipped.length, 3);
});

Deno.test("recordOutOfScope: session_summary source path stores correct subject_type", async () => {
  const { sb, inserted } = makeStub();
  const res = await recordOutOfScope(sb, {
    items: ["pending UI"],
    source: "session_summary",
    source_ref: "session:s1",
  });
  assertEquals(res.created.length, 1);
  assertEquals(inserted[0].source, "session_summary");
  assertEquals(inserted[0].subject_type, "session_summary");
  assertEquals(inserted[0].source_ref, "session:s1");
});

Deno.test("recordOutOfScope: subject_id is stable across calls with same source_ref", async () => {
  const { sb: sb1, inserted: ins1 } = makeStub();
  const { sb: sb2, inserted: ins2 } = makeStub();
  await recordOutOfScope(sb1, { items: ["x"], source: "plan_footer", source_ref: "plan:stable" });
  await recordOutOfScope(sb2, { items: ["x"], source: "plan_footer", source_ref: "plan:stable" });
  assertEquals(ins1[0].subject_id, ins2[0].subject_id);
  assert(typeof ins1[0].subject_id === "string" && (ins1[0].subject_id as string).length === 36);
});

Deno.test("recordOutOfScope: non-23505 errors bubble up", async () => {
  // Stub that returns a non-unique error
  const sb = {
    from() {
      return {
        insert() {
          return {
            select() {
              return {
                single: () =>
                  Promise.resolve({ data: null, error: { code: "42501", message: "rls" } }),
              };
            },
          };
        },
      };
    },
  };
  let threw = false;
  try {
    // deno-lint-ignore no-explicit-any
    await recordOutOfScope(sb as any, {
      items: ["x"],
      source: "plan_footer",
      source_ref: "plan:err",
    });
  } catch {
    threw = true;
  }
  assert(threw, "non-23505 error must throw");
});
