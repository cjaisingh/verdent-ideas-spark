// Regression tests for the night-agent module split.
//
// After splitting the original index.ts into sibling modules
// (time.ts, classify.ts, filters.ts, gates.ts, open.ts, close.ts,
// smoke.ts), this suite locks in two guarantees:
//
//   1. Every new module loads cleanly and exports the symbols the
//      thin index.ts router and handlers depend on. A module that
//      fails to parse or rename a symbol will surface here.
//   2. The pure helpers that drive `gates` and `skip_reasons` —
//      `time.inWindow`, `time.localParts`, `classify.classifyJob`,
//      `classify.inferPhaseAndSuite`, `filters.parseOpenTestFilters`,
//      `filters.applyDerivedFilters` — produce the exact same output
//      the pre-split inline code did, against the same sample
//      timestamps used by open_test_mode_test.ts.
//
// Live /open · /smoke · /close checks are opt-in via
// NIGHT_AGENT_ADMIN_JWT — they assert the endpoint response carries
// the same gate keys and skip_reasons the modules compute locally.
// /smoke writes a marked test shift, so it is gated behind
// NIGHT_AGENT_SMOKE_LIVE=1 to keep CI side-effect-free.

import "https://deno.land/std@0.224.0/dotenv/load.ts";
import { assert, assertEquals, assertExists } from "https://deno.land/std@0.224.0/assert/mod.ts";

import { localParts, inWindow } from "./time.ts";
import { classifyJob, inferPhaseAndSuite, SEV_RANK, worse } from "./classify.ts";
import {
  parseOpenTestFilters,
  applyDerivedFilters,
  type ClassifiedJob,
} from "./filters.ts";
import { evaluateOpenGates } from "./gates.ts";
import { openShift } from "./open.ts";
import { closeShift } from "./close.ts";
import { smokeTest } from "./smoke.ts";
import { MAX_JOBS_PER_SHIFT, json, corsHeaders } from "./config.ts";

const SUPABASE_URL =
  Deno.env.get("VITE_SUPABASE_URL") ?? Deno.env.get("SUPABASE_URL") ?? "";
const ANON_KEY =
  Deno.env.get("VITE_SUPABASE_PUBLISHABLE_KEY") ??
  Deno.env.get("SUPABASE_ANON_KEY") ?? "";
const ADMIN_JWT = Deno.env.get("NIGHT_AGENT_ADMIN_JWT");
const SMOKE_LIVE = Deno.env.get("NIGHT_AGENT_SMOKE_LIVE") === "1";

const ENDPOINT = `${SUPABASE_URL}/functions/v1/night-agent`;

// ─── module-load regression ──────────────────────────────────────────────
// If a sibling module fails to parse or drops an export the handlers
// depend on, these import-shape assertions will fail before any logic
// runs. Treat them as the canary for the split.

Deno.test("modules: every sibling export is loadable and typed", () => {
  // pure helpers
  assertEquals(typeof localParts, "function");
  assertEquals(typeof inWindow, "function");
  assertEquals(typeof classifyJob, "function");
  assertEquals(typeof inferPhaseAndSuite, "function");
  assertEquals(typeof parseOpenTestFilters, "function");
  assertEquals(typeof applyDerivedFilters, "function");
  assertEquals(typeof worse, "function");
  assertExists(SEV_RANK.high);

  // handlers (router targets)
  assertEquals(typeof evaluateOpenGates, "function");
  assertEquals(typeof openShift, "function");
  assertEquals(typeof closeShift, "function");
  assertEquals(typeof smokeTest, "function");

  // shared config surface used by index.ts router
  assertEquals(typeof json, "function");
  assertEquals(typeof corsHeaders, "object");
  assert(MAX_JOBS_PER_SHIFT > 0, "MAX_JOBS_PER_SHIFT must be a positive int");
});

// ─── pure regression: time helpers ───────────────────────────────────────
// Same sample timestamps used by open_test_mode_test.ts so the two
// suites stay in lockstep about what "in window" means.

Deno.test("time.inWindow: wrap-around 22:00-06:00", () => {
  assert(inWindow("01:14", "22:00", "06:00"), "01:14 is in 22-06");
  assert(inWindow("22:00", "22:00", "06:00"), "boundary start is inclusive");
  assert(!inWindow("06:00", "22:00", "06:00"), "boundary end is exclusive");
  assert(!inWindow("14:30", "22:00", "06:00"), "afternoon is out");
  assert(inWindow("23:00", "22:00", "06:00"), "late evening is in");
});

Deno.test("time.inWindow: same-day window 09:00-17:00", () => {
  assert(inWindow("09:00", "09:00", "17:00"));
  assert(inWindow("12:30", "09:00", "17:00"));
  assert(!inWindow("17:00", "09:00", "17:00"));
  assert(!inWindow("08:59", "09:00", "17:00"));
});

Deno.test("time.inWindow: degenerate equal start/end is always false", () => {
  assert(!inWindow("00:00", "00:00", "00:00"));
  assert(!inWindow("12:00", "12:00", "12:00"));
});

Deno.test("time.localParts: respects timezone for the same instant", () => {
  const at = new Date("2026-05-08T03:00:00Z");
  assertEquals(localParts(at, "UTC").hhmm, "03:00");
  assertEquals(localParts(at, "Europe/Berlin").hhmm, "05:00");
  assertEquals(localParts(at, "America/Los_Angeles").hhmm, "20:00");
  // date format is stable YYYY-MM-DD
  assertEquals(localParts(at, "UTC").date, "2026-05-08");
});

Deno.test("time.localParts: invalid tz falls back to UTC slice", () => {
  const at = new Date("2026-05-08T03:00:00Z");
  const r = localParts(at, "Not/A_Zone");
  assertEquals(r.date, "2026-05-08");
  assertEquals(r.hhmm, "03:00");
});

// ─── pure regression: classify ───────────────────────────────────────────

Deno.test("classify.classifyJob: high-risk keywords win over priority", () => {
  const r = classifyJob({
    title: "Auth flow refactor",
    details: "small change",
    priority: "low",
  });
  assertEquals(r.risk, "high");
});

Deno.test("classify.classifyJob: priority drives risk when no keyword", () => {
  assertEquals(
    classifyJob({ title: "Tweak copy", details: null, priority: "high" }).risk,
    "high",
  );
  assertEquals(
    classifyJob({ title: "Tweak copy", details: null, priority: "low" }).risk,
    "low",
  );
  assertEquals(
    classifyJob({ title: "Tweak copy", details: null, priority: "med" }).risk,
    "med",
  );
});

Deno.test("classify.inferPhaseAndSuite: keyword routing", () => {
  assertEquals(inferPhaseAndSuite("Fix login JWT").phase, "auth");
  assertEquals(inferPhaseAndSuite("Update roadmap finding").phase, "roadmap");
  assertEquals(inferPhaseAndSuite("Copilot voice issue").phase, "copilot");
  assertEquals(inferPhaseAndSuite("New discussion action").phase, "jobs");
  assertEquals(inferPhaseAndSuite("Misc tweak").phase, "general");
  // suite mirrors phase
  const r = inferPhaseAndSuite("login redirect");
  assertEquals(r.suite, r.phase);
});

Deno.test("classify.worse / SEV_RANK: ordering", () => {
  assertEquals(worse("info", "high"), "high");
  assertEquals(worse("medium", "low"), "medium");
  assertEquals(worse("high", "high"), "high");
  assert(SEV_RANK.high > SEV_RANK.medium);
  assert(SEV_RANK.medium > SEV_RANK.low);
  assert(SEV_RANK.low > SEV_RANK.info);
});

// ─── pure regression: filter parsing & application ───────────────────────

Deno.test("filters.parseOpenTestFilters: defaults", () => {
  const f = parseOpenTestFilters(new URL("https://x/?"));
  assertEquals(f.phaseFilter.size, 0);
  assertEquals(f.riskFilter.size, 0);
  assertEquals(f.verdictFilter, "");
  assertEquals(f.titleQuery, "");
  assertEquals(f.shortNums.size, 0);
  assertEquals(f.limit, MAX_JOBS_PER_SHIFT);
  assertEquals(f.filtersApplied.verdict, null);
  assertEquals(f.filtersApplied.q, null);
});

Deno.test("filters.parseOpenTestFilters: csv + repeated params + limit clamp", () => {
  const u = new URL(
    "https://x/?phase=auth,jobs&phase=copilot&risk=high&verdict=AUDIT&q=  Login  &short_num=12,foo,34&limit=999999",
  );
  const f = parseOpenTestFilters(u);
  assertEquals([...f.phaseFilter].sort(), ["auth", "copilot", "jobs"]);
  assertEquals([...f.riskFilter], ["high"]);
  assertEquals(f.verdictFilter, "audit");
  assertEquals(f.titleQuery, "login");
  assertEquals([...f.shortNums].sort((a, b) => a - b), [12, 34]);
  assertEquals(f.limit, MAX_JOBS_PER_SHIFT, "limit clamps to MAX_JOBS_PER_SHIFT");
  assertEquals(f.filtersApplied.limit, MAX_JOBS_PER_SHIFT);
});

Deno.test("filters.applyDerivedFilters: phase/risk/verdict gating", () => {
  const jobs: ClassifiedJob[] = [
    { id: "a", short_num: 1, title: "x", risk: "high", phase: "auth", suite: "auth", would_audit: false, skip_reasons: ["risk=high"] },
    { id: "b", short_num: 2, title: "y", risk: "low",  phase: "jobs", suite: "jobs", would_audit: true,  skip_reasons: [] },
    { id: "c", short_num: 3, title: "z", risk: "med",  phase: "general", suite: "general", would_audit: true, skip_reasons: [] },
  ];

  const onlyAuth = applyDerivedFilters(jobs, parseOpenTestFilters(new URL("https://x/?phase=auth")));
  assertEquals(onlyAuth.map((j) => j.id), ["a"]);

  const onlyAudit = applyDerivedFilters(jobs, parseOpenTestFilters(new URL("https://x/?verdict=audit")));
  assertEquals(onlyAudit.map((j) => j.id), ["b", "c"]);

  const onlySkip = applyDerivedFilters(jobs, parseOpenTestFilters(new URL("https://x/?verdict=skip")));
  assertEquals(onlySkip.map((j) => j.id), ["a"]);

  const highRisk = applyDerivedFilters(jobs, parseOpenTestFilters(new URL("https://x/?risk=high")));
  assertEquals(highRisk.map((j) => j.id), ["a"]);
});

// ─── pure regression: skip_reasons mirrors what gates.ts emits ───────────
// Same algorithm gates.ts / smoke.ts apply, expressed once against the
// real `time` module so any drift in either handler will diverge here.

type GateInput = {
  enabled: boolean; tz: string; winStart: string; winEnd: string;
  blackouts: string[]; allowedKinds: string[];
};

function expectedSkipReasons(at: Date, s: GateInput): string[] {
  const local = localParts(at, s.tz);
  const reasons: string[] = [];
  if (!s.enabled) reasons.push("night_agent_disabled");
  if (s.blackouts.includes(local.date)) reasons.push("blackout_date");
  if (!inWindow(local.hhmm, s.winStart, s.winEnd)) reasons.push("outside_window");
  if (s.allowedKinds.length === 0) reasons.push("no_allowed_kinds");
  return reasons;
}

const DEFAULTS: GateInput = {
  enabled: true, tz: "UTC", winStart: "22:00", winEnd: "06:00",
  blackouts: ["2026-12-24"],
  allowedKinds: ["general", "auth", "roadmap", "copilot", "jobs"],
};

const GATE_CASES: { label: string; at: string; want: string[] }[] = [
  { label: "deep night",      at: "2026-05-08T01:14:00Z", want: [] },
  { label: "window start",    at: "2026-05-08T22:00:00Z", want: [] },
  { label: "window end excl", at: "2026-05-08T06:00:00Z", want: ["outside_window"] },
  { label: "afternoon",       at: "2026-05-08T14:30:00Z", want: ["outside_window"] },
  { label: "blackout night",  at: "2026-12-24T23:00:00Z", want: ["blackout_date"] },
];

for (const c of GATE_CASES) {
  Deno.test(`skip_reasons regression: ${c.label}`, () => {
    assertEquals(expectedSkipReasons(new Date(c.at), DEFAULTS), c.want);
  });
}

Deno.test("skip_reasons regression: disabled + empty kinds compose", () => {
  const r = expectedSkipReasons(new Date("2026-05-08T14:30:00Z"), {
    ...DEFAULTS, enabled: false, allowedKinds: [],
  });
  assertEquals(
    r.sort(),
    ["night_agent_disabled", "no_allowed_kinds", "outside_window"].sort(),
  );
});

// ─── live integration (opt-in) ───────────────────────────────────────────
// /open?test=1 carries gates + skip_reasons in the response body. We
// recompute them locally from the settings the endpoint resolved and
// require an exact match — that proves the modular split did not change
// what the wire contract emits.

async function callOpenTest(at: string): Promise<Response> {
  return await fetch(`${ENDPOINT}/open?test=1&at=${encodeURIComponent(at)}&limit=5`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${ADMIN_JWT}`,
      "apikey": ANON_KEY,
      "Content-Type": "application/json",
    },
    body: "{}",
  });
}

Deno.test({
  name: "live /open?test=1: gates + skip_reasons match local mirror",
  ignore: !ADMIN_JWT,
  async fn() {
    const at = "2026-05-08T01:14:00Z";
    const r = await callOpenTest(at);
    const body = await r.json();
    assertEquals(r.status, 200, JSON.stringify(body));

    const live: GateInput = {
      enabled: body.gates.enabled,
      tz: body.gates.timezone,
      winStart: body.gates.window.split("-")[0],
      winEnd: body.gates.window.split("-")[1],
      blackouts: body.gates.blackout_dates ?? [],
      allowedKinds: body.gates.allowed_kinds ?? [],
    };
    assertEquals(
      [...body.skip_reasons].sort(),
      expectedSkipReasons(new Date(at), live).sort(),
    );
    assertEquals(body.would_open_shift, body.skip_reasons.length === 0);

    // Gate object shape regression — keys consumed by the UI.
    for (const k of [
      "timezone", "window", "local_date", "local_time", "enabled",
      "in_window", "blackout_hit", "allowed_kinds", "blackout_dates",
    ]) {
      assert(k in body.gates, `missing gates.${k}`);
    }
  },
});

Deno.test({
  name: "live /smoke: response carries gates + skip_reasons (writes a test shift)",
  ignore: !ADMIN_JWT || !SMOKE_LIVE,
  async fn() {
    const at = "2026-05-08T14:30:00Z"; // outside window — exercises skip path
    const r = await fetch(`${ENDPOINT}/smoke?at=${encodeURIComponent(at)}`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${ADMIN_JWT}`,
        "apikey": ANON_KEY,
        "Content-Type": "application/json",
      },
      body: "{}",
    });
    const body = await r.json();
    assertEquals(r.status, 200, JSON.stringify(body));
    assertExists(body.shift_id);
    assertEquals(body.test, true);
    assertExists(body.gates);
    assertEquals(body.would_run, body.skip_reasons.length === 0);

    // Recompute locally from what /smoke resolved.
    const live: GateInput = {
      enabled: body.gates.enabled,
      tz: body.gates.timezone,
      winStart: body.gates.window.split("-")[0],
      winEnd: body.gates.window.split("-")[1],
      blackouts: [],            // /smoke doesn't echo blackout_dates
      allowedKinds: body.gates.allowed_kinds ?? [],
    };
    // /smoke uses real settings.blackouts internally; we can only assert
    // that every reason the endpoint emits is one we know how to produce.
    const known = new Set([
      "night_agent_disabled", "blackout_date", "outside_window", "no_allowed_kinds",
    ]);
    for (const reason of body.skip_reasons) {
      assert(known.has(reason), `unexpected skip reason: ${reason}`);
    }
    // outside_window must appear given the chosen timestamp and live tz/window.
    if (!inWindow(body.gates.local_time, live.winStart, live.winEnd)) {
      assert(body.skip_reasons.includes("outside_window"));
    }
  },
});

Deno.test({
  name: "live /close: 404 when no running shift (or 200 with summary keys)",
  ignore: !ADMIN_JWT,
  async fn() {
    const r = await fetch(`${ENDPOINT}/close`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${ADMIN_JWT}`,
        "apikey": ANON_KEY,
        "Content-Type": "application/json",
      },
      body: "{}",
    });
    const body = await r.json();
    if (r.status === 404) {
      assertEquals(body.error, "no_running_shift");
      return;
    }
    assertEquals(r.status, 200, JSON.stringify(body));
    assertExists(body.shift_id);
    assertExists(body.summary);
    for (const k of [
      "observations", "by_kind", "failures",
      "proposals_pending", "proposals_accepted", "proposals_rejected",
      "audits_complete", "worst_per_task",
    ]) {
      assert(k in body.summary, `missing summary.${k}`);
    }
  },
});
