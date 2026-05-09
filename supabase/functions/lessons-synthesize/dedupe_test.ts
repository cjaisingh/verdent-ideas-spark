import { assertEquals, assert } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { dedupeKey, normaliseLesson, dedupeLessons } from "./dedupe.ts";

Deno.test("dedupeKey is stable and slugified", () => {
  assertEquals(dedupeKey("Reliability", "Always retry on 5xx"), "reliability::always-retry-on-5xx");
  assertEquals(dedupeKey("RELIABILITY", "ALWAYS RETRY ON 5XX!!!"), "reliability::always-retry-on-5xx");
});

Deno.test("normaliseLesson maps severity aliases and strips junk", () => {
  const n = normaliseLesson({
    category: "ops", severity: "MED", title: " Title ", recommendation: "do thing",
    evidence: [{ source: "x", id: "1" }],
  });
  assert(n);
  assertEquals(n!.severity, "medium");
  assertEquals(n!.title, "Title");
  assertEquals(n!.dedupe_key, "ops::title");
});

Deno.test("normaliseLesson rejects rows missing title or recommendation", () => {
  assertEquals(normaliseLesson({ category: "x", title: "", recommendation: "y" }), null);
  assertEquals(normaliseLesson({ category: "x", title: "y", recommendation: "" }), null);
});

Deno.test("normaliseLesson defaults severity to medium when unknown", () => {
  const n = normaliseLesson({ category: "x", severity: "weird", title: "t", recommendation: "r" });
  assertEquals(n!.severity, "medium");
});

Deno.test("dedupeLessons keeps first occurrence of identical lessons", () => {
  const out = dedupeLessons([
    { category: "ops", title: "Same", recommendation: "first", severity: "low" },
    { category: "OPS", title: "same", recommendation: "second", severity: "high" },
    { category: "perf", title: "Other", recommendation: "third", severity: "medium" },
  ]);
  assertEquals(out.length, 2);
  assertEquals(out[0].recommendation, "first");
  assertEquals(out[0].severity, "low");
});

Deno.test("evidence is capped at 20 entries", () => {
  const evidence = Array.from({ length: 50 }, (_, i) => ({ source: "s", id: String(i) }));
  const n = normaliseLesson({ category: "x", title: "t", recommendation: "r", evidence });
  assertEquals(n!.evidence.length, 20);
});
