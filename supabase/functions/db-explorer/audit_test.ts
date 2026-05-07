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
      requested: { action: "x", authorization: "Bearer abcdef123456", api_key: "sk_live_ABCDEFGHIJKLMNOP" },
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
