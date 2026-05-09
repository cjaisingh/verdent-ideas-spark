// W1 logger pipeline: verify dispatchAlert emits structured `alerts.dispatch`
// console lines across the dispatcher state matrix.
//
// State matrix covered:
//   1. webhook off            → logged only, delivered=false, status_code=null
//   2. webhook on, 200 OK     → delivered=true, status_code=200
//   3. webhook on, 500 fail   → delivered=false, status_code=500, error captured
//   4. webhook fetch throws   → delivered=false, error=network message
//   5. reason flag disabled   → never fetches, logged only
//   6. dedupe window hit      → never fetches, logged only
//   7. message truncated      → log line message capped at 200 chars
//
// We stub the supabase client + global fetch and capture console.log.
import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { dispatchAlert } from "./alerts.ts";

type Settings = Record<string, unknown> | null;
type Recent = Array<{ id: string }>;

function stubClient(opts: { settings?: Settings; recent?: Recent } = {}) {
  const inserts: any[] = [];
  const sb = {
    from(table: string) {
      if (table === "alert_settings") {
        return {
          select() { return this; },
          eq() { return this; },
          async maybeSingle() { return { data: opts.settings ?? null, error: null }; },
        };
      }
      if (table === "alert_log") {
        return {
          select() { return this; },
          eq() { return this; },
          gte() { return this; },
          limit() { return this; },
          // dedupe lookup awaits the chain itself
          then(resolve: (v: any) => void) { resolve({ data: opts.recent ?? [], error: null }); },
          async insert(row: unknown) { inserts.push(row); return { data: null, error: null }; },
        };
      }
      return { select() { return this; }, eq() { return this; }, async maybeSingle() { return { data: null }; } };
    },
  } as any;
  return { sb, inserts };
}

async function captureLog<T>(fn: () => Promise<T>): Promise<{ result: T; lines: string[] }> {
  const original = console.log;
  const lines: string[] = [];
  console.log = (...args: unknown[]) => { lines.push(args.map((a) => typeof a === "string" ? a : JSON.stringify(a)).join(" ")); };
  try { const result = await fn(); return { result, lines }; }
  finally { console.log = original; }
}

function findDispatchLine(lines: string[]) {
  const line = lines.find((l) => l.includes('"tag":"alerts.dispatch"'));
  assert(line, `no alerts.dispatch line emitted; saw ${JSON.stringify(lines)}`);
  return JSON.parse(line!);
}

function withFetch(impl: typeof fetch, fn: () => Promise<void>) {
  const orig = globalThis.fetch;
  globalThis.fetch = impl as any;
  return fn().finally(() => { globalThis.fetch = orig; });
}

Deno.test("1. webhook off → logged only", async () => {
  const { sb, inserts } = stubClient({ settings: { enabled: false } });
  const { lines } = await captureLog(() => dispatchAlert(sb, "job-a", "qa_fail", "probe failed"));
  const log = findDispatchLine(lines);
  assertEquals(log.delivered, false);
  assertEquals(log.status_code, null);
  assertEquals(log.error, null);
  assertEquals(inserts.length, 1);
  assertEquals(inserts[0].delivered, false);
});

Deno.test("2. webhook 200 → delivered=true", async () => {
  const { sb } = stubClient({ settings: { enabled: true, webhook_url: "https://hook.test/ok", dedupe_minutes: 0 } });
  const { lines } = await withFetchCapture(async () => {
    const res = await captureLog(() => dispatchAlert(sb, "job-b", "auth_failed", "401"));
    return res.lines;
  }, () => new Response("ok", { status: 200 }));
  const log = findDispatchLine(lines);
  assertEquals(log.delivered, true);
  assertEquals(log.status_code, 200);
  assertEquals(log.error, null);
});

Deno.test("3. webhook 500 → delivered=false + error captured", async () => {
  const { sb } = stubClient({ settings: { enabled: true, webhook_url: "https://hook.test/fail", dedupe_minutes: 0 } });
  const { lines } = await withFetchCapture(async () => {
    const res = await captureLog(() => dispatchAlert(sb, "job-c", "test_fail", "boom"));
    return res.lines;
  }, () => new Response("server exploded", { status: 500 }));
  const log = findDispatchLine(lines);
  assertEquals(log.delivered, false);
  assertEquals(log.status_code, 500);
  assert(typeof log.error === "string" && log.error.includes("server exploded"));
});

Deno.test("4. webhook fetch throws → error message captured", async () => {
  const { sb } = stubClient({ settings: { enabled: true, webhook_url: "https://hook.test/down", dedupe_minutes: 0 } });
  const { lines } = await withFetchCapture(async () => {
    const res = await captureLog(() => dispatchAlert(sb, "job-d", "review_error", "x"));
    return res.lines;
  }, () => { throw new Error("ECONNREFUSED"); });
  const log = findDispatchLine(lines);
  assertEquals(log.delivered, false);
  assertEquals(log.status_code, null);
  assert(log.error?.includes("ECONNREFUSED"));
});

Deno.test("5. reason flag off → no fetch, logged only", async () => {
  const { sb } = stubClient({
    settings: { enabled: true, webhook_url: "https://hook.test/x", alert_on_qa_fail: false, dedupe_minutes: 0 },
  });
  let called = 0;
  await withFetch(async () => { called++; return new Response("", { status: 200 }); }, async () => {
    const { lines } = await captureLog(() => dispatchAlert(sb, "job-e", "qa_fail", "should-not-deliver"));
    const log = findDispatchLine(lines);
    assertEquals(log.delivered, false);
    assertEquals(log.status_code, null);
  });
  assertEquals(called, 0, "fetch must NOT be called when reason flag is off");
});

Deno.test("6. dedupe window hit → no fetch, logged only", async () => {
  const { sb } = stubClient({
    settings: { enabled: true, webhook_url: "https://hook.test/d", dedupe_minutes: 30 },
    recent: [{ id: "prev" }],
  });
  let called = 0;
  await withFetch(async () => { called++; return new Response("", { status: 200 }); }, async () => {
    const { lines } = await captureLog(() => dispatchAlert(sb, "job-f", "auth_failed", "dup"));
    const log = findDispatchLine(lines);
    assertEquals(log.delivered, false);
    assertEquals(log.status_code, null);
  });
  assertEquals(called, 0, "fetch must NOT be called when dedupe matches a recent delivery");
});

Deno.test("7. long message truncated to 200 chars in log line", async () => {
  const { sb } = stubClient({ settings: { enabled: false } });
  const long = "x".repeat(500);
  const { lines } = await captureLog(() => dispatchAlert(sb, "job-g", "high_finding", long));
  const log = findDispatchLine(lines);
  assertEquals(log.message.length, 200);
});

// Helper: combines fetch stub + console capture and returns captured lines.
async function withFetchCapture(
  run: () => Promise<string[]>,
  fetchImpl: () => Response | Promise<Response>,
): Promise<string[]> {
  const orig = globalThis.fetch;
  globalThis.fetch = (async () => fetchImpl()) as any;
  try { return await run(); } finally { globalThis.fetch = orig; }
}
