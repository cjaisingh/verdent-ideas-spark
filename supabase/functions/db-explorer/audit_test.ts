import { assertEquals, assert } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { buildAuditEntry, resultCount, type AuditContext } from "./audit.ts";

const baseCtx = (over: Partial<AuditContext> = {}): AuditContext => ({
  requestId: "req-123",
  userId: "user-1",
  action: null,
  table: null,
  limit: null,
  offset: null,
  startedAt: 1_000,
  requested: null,
  ...over,
});

Deno.test("list_tables success: status 200, action+result_count, no rejection", () => {
  const data = [{ table_name: "a" }, { table_name: "b" }];
  const e = buildAuditEntry(
    baseCtx({ action: "list_tables" }),
    200,
    null,
    resultCount(data),
    undefined,
    1_005,
  );
  assertEquals(e.action, "list_tables");
  assertEquals(e.status, 200);
  assertEquals(e.result_count, 2);
  assertEquals(e.table, null);
  assertEquals(e.limit, null);
  assertEquals(e.offset, null);
  assertEquals(e.rejected, false);
  assertEquals(e.rejection_reason, null);
  assertEquals(e.requested, null);
  assertEquals(e.duration_ms, 5);
});

Deno.test("list_columns success: records table and result_count", () => {
  const cols = [{ column_name: "id" }, { column_name: "name" }, { column_name: "created_at" }];
  const e = buildAuditEntry(
    baseCtx({ action: "list_columns", table: "okr_nodes" }),
    200,
    null,
    resultCount(cols),
  );
  assertEquals(e.action, "list_columns");
  assertEquals(e.table, "okr_nodes");
  assertEquals(e.status, 200);
  assertEquals(e.result_count, 3);
  assertEquals(e.rejected, false);
});

Deno.test("preview_rows success: records table, limit, offset, result_count", () => {
  const rows = new Array(50).fill(0).map((_, i) => ({ id: i }));
  const e = buildAuditEntry(
    baseCtx({ action: "preview_rows", table: "events", limit: 50, offset: 100 }),
    200,
    null,
    resultCount(rows),
  );
  assertEquals(e.action, "preview_rows");
  assertEquals(e.table, "events");
  assertEquals(e.limit, 50);
  assertEquals(e.offset, 100);
  assertEquals(e.result_count, 50);
  assertEquals(e.status, 200);
});

Deno.test("refresh_counts success: result_count from list", () => {
  const data = [{ table_name: "x" }];
  const e = buildAuditEntry(baseCtx({ action: "refresh_counts" }), 200, null, resultCount(data));
  assertEquals(e.action, "refresh_counts");
  assertEquals(e.result_count, 1);
});

Deno.test("invalid_table_identifier: rejected with reason and requested payload", () => {
  const e = buildAuditEntry(
    baseCtx({ action: "preview_rows", table: "bad name!" }),
    400,
    "invalid_table_identifier",
    null,
    { reason: "invalid_table_identifier", requested: { action: "preview_rows", table: "bad name!" } },
  );
  assertEquals(e.status, 400);
  assertEquals(e.rejected, true);
  assertEquals(e.rejection_reason, "invalid_table_identifier");
  assertEquals(e.error_code, "invalid_table_identifier");
  assertEquals(e.result_count, null);
  assertEquals((e.requested as Record<string, unknown>).table, "bad name!");
});

Deno.test("unknown_table: 404 rejection captured", () => {
  const e = buildAuditEntry(
    baseCtx({ action: "list_columns", table: "nope" }),
    404,
    "unknown_table",
    null,
    { reason: "unknown_table", requested: { action: "list_columns", table: "nope" } },
  );
  assertEquals(e.status, 404);
  assertEquals(e.rejected, true);
  assertEquals(e.rejection_reason, "unknown_table");
});

Deno.test("rate_limited: 429 rejection captured", () => {
  const e = buildAuditEntry(
    baseCtx({ action: "preview_rows", table: "events" }),
    429,
    "rate_limited",
    null,
    { reason: "rate_limit_total", requested: { retry_after_ms: 12_000 } },
  );
  assertEquals(e.status, 429);
  assertEquals(e.rejected, true);
  assertEquals(e.rejection_reason, "rate_limit_total");
  assertEquals((e.requested as Record<string, unknown>).retry_after_ms, 12_000);
});

Deno.test("redaction: bearer tokens and sensitive keys scrubbed in requested", () => {
  const e = buildAuditEntry(
    baseCtx({
      action: "list_columns",
      requested: { action: "list_columns", authorization: "Bearer abcdef123456", note: "fine" },
    }),
    400,
    "unknown_action",
    null,
    {
      reason: "unknown_action",
      requested: { action: "x", authorization: "Bearer abcdef123456", api_key: "sk_ABCDEFGHIJKLMNOPQR" },
    },
  );
  const req = e.requested as Record<string, unknown>;
  assertEquals(req.authorization, "[REDACTED]");
  assertEquals(req.api_key, "[REDACTED]");
});

Deno.test("redaction: error_code with URL gets scrubbed", () => {
  const e = buildAuditEntry(
    baseCtx({ action: "preview_rows", table: "events" }),
    500,
    "rpc failed at https://internal.example/foo?token=abc",
    null,
  );
  assert(typeof e.error_code === "string");
  assert(!(e.error_code as string).includes("https://"));
  assert((e.error_code as string).includes("[REDACTED_URL]"));
});

Deno.test("resultCount handles arrays, objects, and null", () => {
  assertEquals(resultCount([1, 2, 3]), 3);
  assertEquals(resultCount({ a: 1, b: 2 }), 2);
  assertEquals(resultCount(null), null);
  assertEquals(resultCount("str"), null);
});

import { reloadRedactionConfig } from "./audit.ts";

Deno.test("env override: AUDIT_REDACT_KEYS adds custom sensitive key", () => {
  Deno.env.set("AUDIT_REDACT_KEYS", "token,my_custom_field");
  reloadRedactionConfig();
  try {
    const e = buildAuditEntry(
      baseCtx({ action: "list_columns" }),
      400,
      "unknown_action",
      null,
      { reason: "x", requested: { my_custom_field: "leak-me", other: "ok" } },
    );
    const req = e.requested as Record<string, unknown>;
    assertEquals(req.my_custom_field, "[REDACTED]");
    assertEquals(req.other, "ok");
  } finally {
    Deno.env.delete("AUDIT_REDACT_KEYS");
    reloadRedactionConfig();
  }
});

Deno.test("env override: AUDIT_MAX_ERROR_LEN truncates error_code", () => {
  Deno.env.set("AUDIT_MAX_ERROR_LEN", "10");
  reloadRedactionConfig();
  try {
    const e = buildAuditEntry(
      baseCtx({ action: "preview_rows" }),
      500,
      "this is a long error message",
      null,
    );
    assertEquals((e.error_code as string).length, 11); // 10 + ellipsis
  } finally {
    Deno.env.delete("AUDIT_MAX_ERROR_LEN");
    reloadRedactionConfig();
  }
});

// ─── Comprehensive redaction coverage ──────────────────────────────────────

import { redactValue, redactErrorMessage } from "./audit.ts";

Deno.test("redact: JWT in string value", () => {
  const jwt = "eyJabcdefghij.eyJklmnopqrst.signature1234567";
  assertEquals(redactValue(jwt), "[REDACTED]");
  assertEquals(redactValue({ note: jwt }), { note: "[REDACTED]" });
});

Deno.test("redact: stripe-style sk_/pk_/sbp_ keys", () => {
  for (const v of ["sk_ABCDEFGHIJKLMNOPQR", "pk_QRSTUVWXYZ0123456789", "sbp_ABCDEFGHIJKLMNOPQR"]) {
    assertEquals(redactValue(v), "[REDACTED]", `should redact ${v}`);
  }
});

Deno.test("redact: Bearer token in value", () => {
  assertEquals(redactValue("Bearer abc12345xyz"), "[REDACTED]");
});

Deno.test("redact: every default sensitive key is masked", () => {
  const sample = {
    token: "x", secret: "x", password: "x", passwd: "x",
    api_key: "x", apiKey: "x", authorization: "x",
    cookie: "x", session: "x", jwt: "x", bearer: "x",
    "x-awip-service-token": "x",
  };
  const out = redactValue(sample) as Record<string, unknown>;
  for (const k of Object.keys(sample)) {
    assertEquals(out[k], "[REDACTED]", `key ${k} should be redacted`);
  }
});

Deno.test("redact: nested object — sensitive keys masked at depth", () => {
  const out = redactValue({
    safe: "ok",
    inner: { deeper: { token: "leak", note: "fine" } },
  }) as Record<string, Record<string, Record<string, unknown>>>;
  assertEquals(out.inner.deeper.token, "[REDACTED]");
  assertEquals(out.inner.deeper.note, "fine");
});

Deno.test("redact: arrays scrubbed and capped at 20 items", () => {
  const arr = new Array(50).fill("eyJaaaaaaaaaa.eyJbbbbbbbbbbb.cccccccccccc");
  const out = redactValue(arr) as unknown[];
  assertEquals(out.length, 20);
  for (const v of out) assertEquals(v, "[REDACTED]");
});

Deno.test("redact: depth cap returns [truncated]", () => {
  Deno.env.set("AUDIT_MAX_DEPTH", "2");
  reloadRedactionConfig();
  try {
    const out = redactValue({ a: { b: { c: { d: "deep" } } } }) as Record<string, unknown>;
    // a (depth 1) -> b (depth 2) — at depth 2 returns "[truncated]"
    assertEquals(((out.a as Record<string, unknown>).b), "[truncated]");
  } finally {
    Deno.env.delete("AUDIT_MAX_DEPTH");
    reloadRedactionConfig();
  }
});

Deno.test("redact: long strings truncated to MAX_STRING_LEN with ellipsis", () => {
  const big = "a".repeat(500);
  const out = redactValue(big) as string;
  assertEquals(out.length, 201); // 200 + "…"
  assert(out.endsWith("…"));
});

Deno.test("redactErrorMessage: postgres DSN scrubbed", () => {
  const out = redactErrorMessage("connect failed at postgres://user:pw@host/db");
  assert(out!.includes("[REDACTED_DSN]"));
  assert(!out!.includes("postgres://"));
  assert(!out!.includes("pw"));
});

Deno.test("redactErrorMessage: http(s) URLs scrubbed", () => {
  const out = redactErrorMessage("rpc 500 at https://internal.example.com/secret?token=abc");
  assert(out!.includes("[REDACTED_URL]"));
  assert(!out!.includes("internal.example.com"));
});

Deno.test("redactErrorMessage: JWT-bearing message fully replaced", () => {
  const jwt = "eyJabcdefghij.eyJklmnopqrst.signature1234567";
  assertEquals(redactErrorMessage(`failed: ${jwt}`), "[REDACTED]");
});

Deno.test("redactErrorMessage: truncates to MAX_ERROR_LEN", () => {
  const out = redactErrorMessage("x".repeat(500));
  assertEquals(out!.length, 121); // default 120 + "…"
  assert(out!.endsWith("…"));
});

Deno.test("redactErrorMessage: null/empty passthrough", () => {
  assertEquals(redactErrorMessage(null), null);
  assertEquals(redactErrorMessage(undefined), null);
  assertEquals(redactErrorMessage(""), null);
});

Deno.test("buildAuditEntry: redacts requested across rejection path", () => {
  const e = buildAuditEntry(
    baseCtx({ action: "list_columns", requested: { authorization: "Bearer abc12345xyz" } }),
    400,
    "rpc failed at https://leak.example.com/x",
    null,
    {
      reason: "boom at https://other.example.com",
      requested: { token: "eyJabcdefghij.eyJklmnopqrst.signature1234567", note: "ok" },
    },
  );
  const req = e.requested as Record<string, unknown>;
  assertEquals(req.token, "[REDACTED]");
  assertEquals(req.note, "ok");
  assert((e.error_code as string).includes("[REDACTED_URL]"));
  assert((e.rejection_reason as string).includes("[REDACTED_URL]"));
});

Deno.test("buildAuditEntry: success path — no requested leakage even if context had sensitive key", () => {
  const e = buildAuditEntry(
    baseCtx({ action: "list_tables", requested: { token: "leak" } }),
    200,
    null,
    1,
  );
  // Successful (non-rejected) entries set requested to null entirely.
  assertEquals(e.requested, null);
  assertEquals(e.rejected, false);
});
