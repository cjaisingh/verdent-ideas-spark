// Edge-case tests for strict /open?test=1 query-param parsing.
//
// Covers the contract documented at the top of filters.ts:
//   - Empty / whitespace CSVs collapse to "no filter" (not an error)
//   - Unknown enum values for phase / risk / verdict are rejected
//   - short_num accepts only positive integers
//   - limit must be a positive integer ≤ MAX_JOBS_PER_SHIFT
//   - Title query is length-bounded
//   - filtersApplied is normalised + deterministically sorted
//
// Each "rejects" test asserts both the failure shape and that the
// error message mentions the offending param name — that is what the
// 400 response surfaces to the operator console.

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { parseOpenTestFilters } from "./filters.ts";
import { MAX_JOBS_PER_SHIFT } from "./config.ts";

function parse(qs: string) {
  return parseOpenTestFilters(new URL(`https://x/?${qs}`));
}
function ok(qs: string) {
  const r = parse(qs);
  if (!r.ok) throw new Error(`expected ok, got: ${r.errors.join("; ")}`);
  return r.filters;
}
function err(qs: string) {
  const r = parse(qs);
  if (r.ok) throw new Error(`expected error, got ok`);
  return r.errors;
}

// ─── empty / whitespace CSVs ─────────────────────────────────────────────

Deno.test("empty CSV: ?phase= collapses to no filter", () => {
  const f = ok("phase=");
  assertEquals(f.phaseFilter.size, 0);
  assertEquals(f.filtersApplied.phase, []);
});

Deno.test("empty CSV: ?phase=,,,& collapses to no filter", () => {
  const f = ok("phase=,,,");
  assertEquals(f.phaseFilter.size, 0);
});

Deno.test("empty CSV: whitespace-only tokens collapse", () => {
  const f = ok("phase=%20,%20%20&risk=,,");
  assertEquals(f.phaseFilter.size, 0);
  assertEquals(f.riskFilter.size, 0);
});

Deno.test("empty CSV: ?short_num= collapses to no filter", () => {
  const f = ok("short_num=");
  assertEquals(f.shortNums.size, 0);
});

Deno.test("empty verdict / q collapse to defaults", () => {
  const f = ok("verdict=&q=");
  assertEquals(f.verdictFilter, "");
  assertEquals(f.titleQuery, "");
  assertEquals(f.filtersApplied.verdict, null);
  assertEquals(f.filtersApplied.q, null);
});

// ─── enum rejection ──────────────────────────────────────────────────────

Deno.test("rejects unknown phase value", () => {
  const e = err("phase=nope");
  assert(e.some((m) => m.startsWith("phase:")), e.join(" / "));
});

Deno.test("rejects unknown risk value", () => {
  const e = err("risk=critical");
  assert(e.some((m) => m.startsWith("risk:")), e.join(" / "));
});

Deno.test("rejects unknown verdict value", () => {
  const e = err("verdict=maybe");
  assert(e.some((m) => m.startsWith("verdict:")), e.join(" / "));
});

Deno.test("aggregates multiple errors in one response", () => {
  const e = err("phase=nope&risk=critical&verdict=maybe&limit=-1&short_num=foo");
  assertEquals(e.length, 5, `got: ${e.join(" / ")}`);
});

Deno.test("partial-good phase: valid kept, invalid reported", () => {
  const e = err("phase=auth,nope,jobs");
  assert(e.some((m) => m.includes("'nope'")));
});

// ─── short_num strict integer rules ──────────────────────────────────────

Deno.test("short_num: rejects non-numeric token", () => {
  assert(err("short_num=foo").some((m) => m.startsWith("short_num:")));
});

Deno.test("short_num: rejects float", () => {
  assert(err("short_num=12.5").some((m) => m.startsWith("short_num:")));
});

Deno.test("short_num: rejects negative", () => {
  assert(err("short_num=-3").some((m) => m.startsWith("short_num:")));
});

Deno.test("short_num: rejects zero", () => {
  const e = err("short_num=0");
  assert(e.some((m) => m.includes("> 0")), e.join(" / "));
});

Deno.test("short_num: rejects scientific notation", () => {
  assert(err("short_num=1e3").some((m) => m.startsWith("short_num:")));
});

Deno.test("short_num: accepts mixed CSV of valid positive ints", () => {
  const f = ok("short_num=1,42,7");
  assertEquals([...f.shortNums].sort((a, b) => a - b), [1, 7, 42]);
  // filtersApplied is sorted ascending — locks in deterministic shape.
  assertEquals(f.filtersApplied.short_num, [1, 7, 42]);
});

Deno.test("short_num: dedupes across repeated params", () => {
  const f = ok("short_num=5,5&short_num=5");
  assertEquals([...f.shortNums], [5]);
});

Deno.test("short_num: rejects > 50 values", () => {
  const many = Array.from({ length: 51 }, (_, i) => i + 1).join(",");
  const e = err(`short_num=${many}`);
  assert(e.some((m) => m.includes("too many")), e.join(" / "));
});

// ─── limit bounds ────────────────────────────────────────────────────────

Deno.test("limit: omitted → MAX_JOBS_PER_SHIFT", () => {
  assertEquals(ok("").limit, MAX_JOBS_PER_SHIFT);
});

Deno.test("limit: rejects 0", () => {
  assert(err("limit=0").some((m) => m.startsWith("limit:")));
});

Deno.test("limit: rejects negative", () => {
  assert(err("limit=-1").some((m) => m.startsWith("limit:")));
});

Deno.test("limit: rejects float", () => {
  assert(err("limit=10.5").some((m) => m.startsWith("limit:")));
});

Deno.test("limit: rejects non-numeric", () => {
  assert(err("limit=abc").some((m) => m.startsWith("limit:")));
});

Deno.test("limit: rejects > MAX_JOBS_PER_SHIFT", () => {
  const e = err(`limit=${MAX_JOBS_PER_SHIFT + 1}`);
  assert(e.some((m) => m.includes(`≤ ${MAX_JOBS_PER_SHIFT}`)), e.join(" / "));
});

Deno.test("limit: accepts boundary value MAX_JOBS_PER_SHIFT", () => {
  assertEquals(ok(`limit=${MAX_JOBS_PER_SHIFT}`).limit, MAX_JOBS_PER_SHIFT);
});

Deno.test("limit: accepts 1", () => {
  assertEquals(ok("limit=1").limit, 1);
});

Deno.test("limit: trims whitespace before parsing", () => {
  assertEquals(ok("limit=%20%2010%20").limit, 10);
});

// ─── title query ─────────────────────────────────────────────────────────

Deno.test("q: trims and lowercases", () => {
  assertEquals(ok("q=%20%20Login%20Bug%20").titleQuery, "login bug");
});

Deno.test("q: rejects > 100 chars", () => {
  const long = "a".repeat(101);
  assert(err(`q=${long}`).some((m) => m.startsWith("q:")));
});

Deno.test("q: accepts boundary 100 chars", () => {
  const exact = "a".repeat(100);
  assertEquals(ok(`q=${exact}`).titleQuery, exact);
});

// ─── filtersApplied normalisation ────────────────────────────────────────

Deno.test("filtersApplied: arrays sorted deterministically", () => {
  const f = ok("phase=jobs,auth&risk=high,low&short_num=9,3,5");
  assertEquals(f.filtersApplied.phase, ["auth", "jobs"]);
  assertEquals(f.filtersApplied.risk, ["high", "low"]);
  assertEquals(f.filtersApplied.short_num, [3, 5, 9]);
});

Deno.test("filtersApplied: verdict normalised to lowercase, q lowercased", () => {
  const f = ok("verdict=SKIP&q=Foo");
  assertEquals(f.filtersApplied.verdict, "skip");
  assertEquals(f.filtersApplied.q, "foo");
});
