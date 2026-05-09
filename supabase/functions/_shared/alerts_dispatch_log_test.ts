// Verifies W1 logger pipeline: dispatchAlert emits a structured
// `alerts.dispatch` console line so it surfaces in edge_request_logs
// alongside the wrapping function's request id.
import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { dispatchAlert } from "./alerts.ts";

// Minimal stub of the supabase client surface dispatchAlert touches.
function stubClient() {
  return {
    from(_t: string) {
      return {
        select() { return this; },
        eq() { return this; },
        gte() { return this; },
        limit() { return this; },
        async maybeSingle() { return { data: null, error: null }; },
        async insert(_row: unknown) { return { data: null, error: null }; },
      };
    },
  } as any;
}

Deno.test("dispatchAlert emits alerts.dispatch structured log", async () => {
  const original = console.log;
  const lines: string[] = [];
  console.log = (...args: unknown[]) => { lines.push(args.map(String).join(" ")); };
  try {
    await dispatchAlert(stubClient(), "test-job", "qa_fail", "synthetic dispatcher event for W1 verification");
  } finally {
    console.log = original;
  }
  const tagged = lines.find((l) => l.includes('"tag":"alerts.dispatch"'));
  assert(tagged, `expected an alerts.dispatch log line, got: ${JSON.stringify(lines)}`);
  const parsed = JSON.parse(tagged!);
  assertEquals(parsed.tag, "alerts.dispatch");
  assertEquals(parsed.job, "test-job");
  assertEquals(parsed.reason, "qa_fail");
  assertEquals(parsed.delivered, false);
  assert(typeof parsed.message === "string");
});
