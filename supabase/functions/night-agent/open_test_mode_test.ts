// Deno tests for the admin /open?test=1 dry-run endpoint.
//
// Two layers:
//   1. Pure gate-logic tests (always run): mirror the in-repo gate
//      math against sample timestamps and assert skip_reasons stay
//      consistent with the gate booleans.
//   2. Live integration tests (run only when NIGHT_AGENT_ADMIN_JWT
//      is set): hit the deployed endpoint with the same sample
//      timestamps via ?at=ISO and assert the endpoint's
//      gates/skip_reasons match the local mirror.
//
// The integration layer is opt-in so the suite stays green in CI
// without a real admin session. Provide a JWT to exercise the wire
// contract:
//   NIGHT_AGENT_ADMIN_JWT=eyJ... deno test supabase/functions/night-agent/open_test_mode_test.ts

import "https://deno.land/std@0.224.0/dotenv/load.ts";
import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";

const SUPABASE_URL = Deno.env.get("VITE_SUPABASE_URL") ?? Deno.env.get("SUPABASE_URL")!;
const ANON_KEY =
  Deno.env.get("VITE_SUPABASE_PUBLISHABLE_KEY") ??
  Deno.env.get("SUPABASE_ANON_KEY")!;
const ADMIN_JWT = Deno.env.get("NIGHT_AGENT_ADMIN_JWT");

const ENDPOINT = `${SUPABASE_URL}/functions/v1/night-agent/open`;

// ─── mirror of in-repo gate primitives ────────────────────────────────────
// Kept in sync with supabase/functions/night-agent/index.ts.

function localParts(now: Date, tz: string) {
  try {
    const fmt = new Intl.DateTimeFormat("en-CA", {
      timeZone: tz, hour12: false,
      year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit",
    }).formatToParts(now);
    const get = (k: string) => fmt.find((p) => p.type === k)?.value ?? "";
    return {
      date: `${get("year")}-${get("month")}-${get("day")}`,
      hhmm: `${get("hour")}:${get("minute")}`,
    };
  } catch {
    return {
      date: now.toISOString().slice(0, 10),
      hhmm: now.toISOString().slice(11, 16),
    };
  }
}

function inWindow(hhmm: string, start: string, end: string) {
  if (start === end) return false;
  return start < end ? (hhmm >= start && hhmm < end) : (hhmm >= start || hhmm < end);
}

type GateSettings = {
  enabled: boolean;
  tz: string;
  winStart: string;
  winEnd: string;
  blackouts: string[];
  allowedKinds: string[];
};

function evaluateGates(at: Date, s: GateSettings) {
  const local = localParts(at, s.tz);
  const inWin = inWindow(local.hhmm, s.winStart, s.winEnd);
  const blackoutHit = s.blackouts.includes(local.date);
  const skipReasons: string[] = [];
  if (!s.enabled) skipReasons.push("night_agent_disabled");
  if (blackoutHit) skipReasons.push("blackout_date");
  if (!inWin) skipReasons.push("outside_window");
  if (s.allowedKinds.length === 0) skipReasons.push("no_allowed_kinds");
  return {
    gates: {
      timezone: s.tz,
      window: `${s.winStart}-${s.winEnd}`,
      local_date: local.date,
      local_time: local.hhmm,
      enabled: s.enabled,
      in_window: inWin,
      blackout_hit: blackoutHit,
      allowed_kinds: s.allowedKinds,
      blackout_dates: s.blackouts,
    },
    skip_reasons: skipReasons,
    would_open_shift: skipReasons.length === 0,
  };
}

// ─── sample timestamps ────────────────────────────────────────────────────
// All ISO; covers in-window, outside-window (afternoon), the boundary,
// and a known blackout date.

const SAMPLES: { label: string; at: string; expectInWindow: boolean; expectBlackout: boolean }[] = [
  { label: "deep night (01:14 UTC)",     at: "2026-05-08T01:14:00Z", expectInWindow: true,  expectBlackout: false },
  { label: "window start 22:00 UTC",     at: "2026-05-08T22:00:00Z", expectInWindow: true,  expectBlackout: false },
  { label: "window end 06:00 UTC (excl)", at: "2026-05-08T06:00:00Z", expectInWindow: false, expectBlackout: false },
  { label: "afternoon (14:30 UTC)",      at: "2026-05-08T14:30:00Z", expectInWindow: false, expectBlackout: false },
  { label: "christmas eve 23:00 UTC",    at: "2026-12-24T23:00:00Z", expectInWindow: true,  expectBlackout: true  },
];

const DEFAULT_SETTINGS: GateSettings = {
  enabled: true,
  tz: "UTC",
  winStart: "22:00",
  winEnd: "06:00",
  blackouts: ["2026-12-24", "2026-12-31"],
  allowedKinds: ["general", "auth", "roadmap", "copilot", "jobs"],
};

// ─── pure gate-consistency tests ──────────────────────────────────────────

for (const s of SAMPLES) {
  Deno.test(`gates: ${s.label} — booleans agree with skip_reasons`, () => {
    const r = evaluateGates(new Date(s.at), DEFAULT_SETTINGS);
    assertEquals(r.gates.in_window, s.expectInWindow, "in_window expectation");
    assertEquals(r.gates.blackout_hit, s.expectBlackout, "blackout expectation");

    // Consistency: every gate that is "bad" must produce its skip reason,
    // and every skip reason must correspond to a "bad" gate.
    assertEquals(
      r.skip_reasons.includes("outside_window"),
      !r.gates.in_window,
      "outside_window iff !in_window",
    );
    assertEquals(
      r.skip_reasons.includes("blackout_date"),
      r.gates.blackout_hit,
      "blackout_date iff blackout_hit",
    );
    assertEquals(
      r.skip_reasons.includes("night_agent_disabled"),
      !r.gates.enabled,
      "night_agent_disabled iff !enabled",
    );
    assertEquals(
      r.skip_reasons.includes("no_allowed_kinds"),
      r.gates.allowed_kinds.length === 0,
      "no_allowed_kinds iff empty allowed_kinds",
    );
    assertEquals(r.would_open_shift, r.skip_reasons.length === 0);
  });
}

Deno.test("gates: night_agent_disabled forces skip even mid-window", () => {
  const r = evaluateGates(new Date("2026-05-08T01:14:00Z"), { ...DEFAULT_SETTINGS, enabled: false });
  assert(!r.would_open_shift);
  assert(r.skip_reasons.includes("night_agent_disabled"));
});

Deno.test("gates: empty allowed_kinds always blocks", () => {
  const r = evaluateGates(new Date("2026-05-08T01:14:00Z"), { ...DEFAULT_SETTINGS, allowedKinds: [] });
  assert(!r.would_open_shift);
  assert(r.skip_reasons.includes("no_allowed_kinds"));
});

Deno.test("gates: timezone shifts the local clock", () => {
  // 03:00 UTC = 05:00 Berlin (in-window) but 22:00 LA (also in-window)
  const at = new Date("2026-05-08T03:00:00Z");
  const berlin = evaluateGates(at, { ...DEFAULT_SETTINGS, tz: "Europe/Berlin" });
  const la = evaluateGates(at, { ...DEFAULT_SETTINGS, tz: "America/Los_Angeles" });
  assertEquals(berlin.gates.local_time, "05:00");
  assertEquals(la.gates.local_time, "20:00"); // outside 22-06 window
  assert(berlin.gates.in_window);
  assert(!la.gates.in_window);
  assert(la.skip_reasons.includes("outside_window"));
});

// ─── live integration tests (gated on NIGHT_AGENT_ADMIN_JWT) ──────────────

async function callTestMode(at: string): Promise<Response> {
  const url = `${ENDPOINT}?test=1&at=${encodeURIComponent(at)}&limit=5`;
  return await fetch(url, {
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
  name: "live: rejects missing auth with 401",
  ignore: !ADMIN_JWT, // still requires URL/anon to be present
  async fn() {
    const r = await fetch(`${ENDPOINT}?test=1`, {
      method: "POST",
      headers: { "apikey": ANON_KEY, "Content-Type": "application/json" },
      body: "{}",
    });
    await r.text();
    assertEquals(r.status, 401);
  },
});

Deno.test({
  name: "live: rejects cron service token with 403",
  ignore: !ADMIN_JWT,
  async fn() {
    const r = await fetch(`${ENDPOINT}?test=1`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${ANON_KEY}`,
        "apikey": ANON_KEY,
        "x-service-token": "anything-non-empty",
        "Content-Type": "application/json",
      },
      body: "{}",
    });
    await r.text();
    // Either 403 (cron token recognised then refused) or 401 (token mismatch).
    assert([401, 403].includes(r.status), `expected 401|403 got ${r.status}`);
  },
});

for (const s of SAMPLES) {
  Deno.test({
    name: `live: ${s.label} — endpoint gates match local mirror`,
    ignore: !ADMIN_JWT,
    async fn() {
      const r = await callTestMode(s.at);
      const body = await r.json();
      assertEquals(r.status, 200, `unexpected status: ${JSON.stringify(body)}`);
      assertEquals(body.test_mode, true);

      // Local truth — uses the actual settings the endpoint resolved,
      // so timezone/window/allowed_kinds drift between env and mirror
      // does not flake the test.
      const live: GateSettings = {
        enabled: body.gates.enabled,
        tz: body.gates.timezone,
        winStart: body.gates.window.split("-")[0],
        winEnd: body.gates.window.split("-")[1],
        blackouts: body.gates.blackout_dates ?? [],
        allowedKinds: body.gates.allowed_kinds ?? [],
      };
      const local = evaluateGates(new Date(s.at), live);

      assertEquals(body.gates.local_date, local.gates.local_date);
      assertEquals(body.gates.local_time, local.gates.local_time);
      assertEquals(body.gates.in_window, local.gates.in_window);
      assertEquals(body.gates.blackout_hit, local.gates.blackout_hit);
      assertEquals(
        [...body.skip_reasons].sort(),
        [...local.skip_reasons].sort(),
        "skip_reasons must match local mirror",
      );
      assertEquals(body.would_open_shift, local.would_open_shift);
      assertEquals(body.would_open_shift, body.skip_reasons.length === 0);

      // Counts must be internally consistent.
      assert(body.candidates_after_filter <= body.candidates_total);
      assert(body.candidates_returned <= body.candidates_after_filter);
      assertEquals(body.would_audit + body.would_skip, body.candidates_returned);

      // Read-only contract.
      assert(typeof body.note === "string" && body.note.includes("read-only"));
    },
  });
}

Deno.test({
  name: "live: invalid 'at' returns 400",
  ignore: !ADMIN_JWT,
  async fn() {
    const r = await fetch(`${ENDPOINT}?test=1&at=not-a-date`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${ADMIN_JWT}`,
        "apikey": ANON_KEY,
        "Content-Type": "application/json",
      },
      body: "{}",
    });
    const body = await r.json();
    assertEquals(r.status, 400);
    assert(typeof body.error === "string");
  },
});
