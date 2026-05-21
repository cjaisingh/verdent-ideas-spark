import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { parseOutOfScope } from "../_shared/out-of-scope.ts";
import { checkOutOfScopeStale } from "../sentinel-tick/checks.ts";

Deno.test("parseOutOfScope: H2 'Out of scope' with dash bullets", () => {
  const md = `## Goal\nDo the thing.\n\n## Out of scope\n- UI badge\n- Backfill historical plans\n- Cross-project ingest\n`;
  assertEquals(parseOutOfScope(md), [
    "UI badge",
    "Backfill historical plans",
    "Cross-project ingest",
  ]);
});

Deno.test("parseOutOfScope: heading variants and bullet styles", () => {
  for (const heading of [
    "### Not in scope",
    "## Deferred",
    "## Won't do",
    "## Won't ship",
    "### Out of Scope (for this PR)",
  ]) {
    const md = `${heading}\n* item one\n1. item two\n+ item three`;
    assertEquals(parseOutOfScope(md), ["item one", "item two", "item three"], heading);
  }
});

Deno.test("parseOutOfScope: stops at next heading of equal level", () => {
  const md = `## Out of scope\n- keep\n## Definition of done\n- skip`;
  assertEquals(parseOutOfScope(md), ["keep"]);
});

Deno.test("parseOutOfScope: no out-of-scope section returns []", () => {
  const md = `## Goal\n- only this\n## Steps\n- and this`;
  assertEquals(parseOutOfScope(md), []);
});

Deno.test("checkOutOfScopeStale: groups by source_ref, ignores fresh rows", () => {
  const now = new Date("2026-05-21T00:00:00Z");
  const old1 = new Date(now.getTime() - 20 * 24 * 3600_000).toISOString();
  const old2 = new Date(now.getTime() - 16 * 24 * 3600_000).toISOString();
  const fresh = new Date(now.getTime() - 2 * 24 * 3600_000).toISOString();
  const out = checkOutOfScopeStale(now, [
    { id: "a", short_num: 1, title: "x", source: "plan_footer", source_ref: "plan:p1", created_at: old1 },
    { id: "b", short_num: 2, title: "y", source: "plan_footer", source_ref: "plan:p1", created_at: old2 },
    { id: "c", short_num: 3, title: "z", source: "session_summary", source_ref: "session:s1", created_at: old1 },
    { id: "d", short_num: 4, title: "fresh", source: "plan_footer", source_ref: "plan:p1", created_at: fresh },
  ]);
  assertEquals(out.length, 2);
  const planFinding = out.find((f) => (f.subject_ref as { source_ref: string }).source_ref === "plan:p1");
  assertEquals(planFinding?.severity, "medium");
  assertEquals((planFinding?.subject_ref as { count: number }).count, 2);
});

Deno.test("checkOutOfScopeStale: empty when all rows are fresh", () => {
  const now = new Date();
  const fresh = new Date(now.getTime() - 3 * 24 * 3600_000).toISOString();
  assertEquals(
    checkOutOfScopeStale(now, [
      { id: "a", short_num: 1, title: "x", source: "plan_footer", source_ref: "plan:p1", created_at: fresh },
    ]),
    [],
  );
});
