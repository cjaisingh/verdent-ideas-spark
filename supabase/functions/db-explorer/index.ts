// Operator-only DB Explorer proxy.
// Verifies the caller has the `operator` role using their JWT, then invokes
// the locked-down SECURITY DEFINER RPCs (db_list_tables / db_list_columns /
// db_preview_rows) using the service role. The RPCs themselves have EXECUTE
// revoked from anon/authenticated, so this edge function is the only path.
//
// Hardening:
// - Strict allow-list of actions
// - Table identifier validated against a regex AND verified against the live
//   list of public tables before any RPC call (prevents arbitrary identifier
//   injection / probing of non-public schemas).
// - Preview limit/offset clamped to safe ranges.
// - Per-request body size cap.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-request-id",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Expose-Headers": "x-request-id",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const ANON = Deno.env.get("SUPABASE_ANON_KEY")!;
const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const ALLOWED_ACTIONS = new Set([
  "list_tables",
  "list_columns",
  "preview_rows",
  "list_all_columns",
  "refresh_counts",
]);

// Postgres unquoted identifier: letter/underscore start, then letters/digits/underscore.
// Length cap matches Postgres NAMEDATALEN-1 (63).
const IDENT_RE = /^[a-z_][a-z0-9_]{0,62}$/i;

// Hard caps for previews.
const MAX_PREVIEW_LIMIT = 200;
const MAX_PREVIEW_OFFSET = 100_000;

// Body size cap (defense in depth; clients only send tiny JSON).
const MAX_BODY_BYTES = 4 * 1024;

const json = (status: number, body: unknown, requestId?: string) =>
  new Response(
    JSON.stringify(
      requestId && body && typeof body === "object" ? { ...(body as object), request_id: requestId } : body,
    ),
    {
      status,
      headers: {
        ...cors,
        "Content-Type": "application/json",
        ...(requestId ? { "x-request-id": requestId } : {}),
      },
    },
  );

// Structured audit log emitted to edge function logs as a single JSON line.
// Captures: action, table, limit/offset, result size, status code, user id,
// duration, request id, and any error code. Designed to be greppable in the
// Supabase logs UI when investigating suspicious access patterns.
interface AuditEntry {
  ts: string;
  request_id: string;
  user_id: string | null;
  action: string | null;
  table: string | null;
  limit: number | null;
  offset: number | null;
  status: number;
  result_count: number | null;
  duration_ms: number;
  error_code: string | null;
  rejected: boolean;
  rejection_reason: string | null;
  requested: Record<string, unknown> | null;
}
function audit(e: AuditEntry) {
  // Single-line JSON keeps it easy to filter in the logs UI.
  console.log("audit " + JSON.stringify({ kind: "db_explorer_audit", ...e }));
}
function resultCount(data: unknown): number | null {
  if (Array.isArray(data)) return data.length;
  if (data && typeof data === "object") return Object.keys(data).length;
  return null;
}

// In-memory cache of the public table list per cold-start (cheap safety net;
// every preview/columns call still confirms the name is in the live set).
let tableCache: { at: number; names: Set<string> } | null = null;
const TABLE_CACHE_TTL_MS = 30_000;

async function loadTableNames(svc: ReturnType<typeof createClient>): Promise<Set<string>> {
  if (tableCache && Date.now() - tableCache.at < TABLE_CACHE_TTL_MS) {
    return tableCache.names;
  }
  const { data, error } = await svc.rpc("db_list_tables");
  if (error) throw new Error(error.message);
  const names = new Set<string>(((data as Array<{ table_name: string }>) ?? []).map((r) => r.table_name));
  tableCache = { at: Date.now(), names };
  return names;
}

async function assertValidTable(
  svc: ReturnType<typeof createClient>,
  table: unknown,
): Promise<{ ok: true; name: string } | { ok: false; status: number; error: string }> {
  if (typeof table !== "string" || !IDENT_RE.test(table)) {
    return { ok: false, status: 400, error: "invalid_table_identifier" };
  }
  const names = await loadTableNames(svc);
  if (!names.has(table)) {
    return { ok: false, status: 404, error: "unknown_table" };
  }
  return { ok: true, name: table };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });

  const startedAt = Date.now();
  const requestId = req.headers.get("x-request-id") ?? crypto.randomUUID();
  let userId: string | null = null;
  let auditAction: string | null = null;
  let auditTable: string | null = null;
  let auditLimit: number | null = null;
  let auditOffset: number | null = null;
  let requested: Record<string, unknown> | null = null;

  const finish = (
    status: number,
    payload: unknown,
    errorCode: string | null,
    resultCnt: number | null,
    rejection?: { reason: string; requested?: Record<string, unknown> | null },
  ) => {
    const rejected = !!rejection || status >= 400;
    audit({
      ts: new Date().toISOString(),
      request_id: requestId,
      user_id: userId,
      action: auditAction,
      table: auditTable,
      limit: auditLimit,
      offset: auditOffset,
      status,
      result_count: resultCnt,
      duration_ms: Date.now() - startedAt,
      error_code: errorCode,
      rejected,
      rejection_reason: rejection?.reason ?? (rejected ? errorCode : null),
      requested: rejection?.requested ?? (rejected ? requested : null),
    });
    return json(status, payload);
  };

  if (req.method !== "POST") {
    return finish(405, { error: "method_not_allowed" }, "method_not_allowed", null, {
      reason: `method_not_allowed:${req.method}`,
      requested: { method: req.method },
    });
  }

  const auth = req.headers.get("Authorization") ?? "";
  if (!auth.startsWith("Bearer ")) {
    return finish(401, { error: "missing_bearer" }, "missing_bearer", null, {
      reason: "missing_bearer",
      requested: { has_auth_header: !!req.headers.get("Authorization") },
    });
  }

  const userClient = createClient(SUPABASE_URL, ANON, {
    global: { headers: { Authorization: auth } },
  });
  const { data: userRes, error: userErr } = await userClient.auth.getUser();
  if (userErr || !userRes?.user) {
    return finish(401, { error: "invalid_token" }, "invalid_token", null, {
      reason: userErr?.message ?? "invalid_token",
    });
  }
  userId = userRes.user.id;

  const { data: isOp, error: roleErr } = await userClient.rpc("has_role", {
    _user_id: userRes.user.id,
    _role: "operator",
  } as never);
  if (roleErr || !isOp) {
    return finish(403, { error: "operator_required" }, "operator_required", null, {
      reason: roleErr?.message ?? "operator_role_missing",
    });
  }

  let raw: string;
  try {
    raw = await req.text();
  } catch {
    return finish(400, { error: "invalid_body" }, "invalid_body", null, { reason: "body_read_failed" });
  }
  if (raw.length > MAX_BODY_BYTES) {
    return finish(413, { error: "body_too_large" }, "body_too_large", null, {
      reason: "body_too_large",
      requested: { body_bytes: raw.length, max_bytes: MAX_BODY_BYTES },
    });
  }

  let body: { action?: string; table?: string; limit?: number; offset?: number };
  try {
    body = raw ? JSON.parse(raw) : {};
  } catch {
    return finish(400, { error: "invalid_json" }, "invalid_json", null, {
      reason: "invalid_json",
      requested: { body_preview: raw.slice(0, 200) },
    });
  }
  requested = body as Record<string, unknown>;

  const action = body.action;
  if (typeof action !== "string" || !ALLOWED_ACTIONS.has(action)) {
    return finish(400, { error: "unknown_action" }, "unknown_action", null, {
      reason: "unknown_action",
      requested: { action: body.action ?? null },
    });
  }
  auditAction = action;
  if (typeof body.table === "string") auditTable = body.table;

  const svc = createClient(SUPABASE_URL, SERVICE, {
    auth: { persistSession: false },
  });

  try {
    switch (action) {
      case "list_tables": {
        const { data, error } = await svc.rpc("db_list_tables");
        if (error) return finish(500, { error: error.message }, "rpc_error", null);
        tableCache = {
          at: Date.now(),
          names: new Set(((data as Array<{ table_name: string }>) ?? []).map((r) => r.table_name)),
        };
        return finish(200, { data }, null, resultCount(data));
      }
      case "list_all_columns": {
        const { data, error } = await svc.rpc("db_list_all_columns");
        if (error) return finish(500, { error: error.message }, "rpc_error", null);
        return finish(200, { data }, null, resultCount(data));
      }
      case "list_columns": {
        const check = await assertValidTable(svc, body.table);
        if (!check.ok) {
          return finish(check.status, { error: check.error }, check.error, null, {
            reason: check.error,
            requested: { action, table: body.table ?? null },
          });
        }
        auditTable = check.name;
        const { data, error } = await svc.rpc("db_list_columns", { _table: check.name } as never);
        if (error) return finish(500, { error: error.message }, "rpc_error", null);
        return finish(200, { data }, null, resultCount(data));
      }
      case "preview_rows": {
        const check = await assertValidTable(svc, body.table);
        if (!check.ok) {
          return finish(check.status, { error: check.error }, check.error, null, {
            reason: check.error,
            requested: { action, table: body.table ?? null, limit: body.limit ?? null, offset: body.offset ?? null },
          });
        }
        auditTable = check.name;

        const rawLimit = Number.isFinite(body.limit as number) ? Math.floor(body.limit as number) : 50;
        const rawOffset = Number.isFinite(body.offset as number) ? Math.floor(body.offset as number) : 0;
        const limit = Math.min(Math.max(rawLimit, 1), MAX_PREVIEW_LIMIT);
        const offset = Math.min(Math.max(rawOffset, 0), MAX_PREVIEW_OFFSET);
        auditLimit = limit;
        auditOffset = offset;

        const { data, error } = await svc.rpc("db_preview_rows", {
          _table: check.name,
          _limit: limit,
          _offset: offset,
        } as never);
        if (error) return finish(500, { error: error.message }, "rpc_error", null);
        return finish(200, { data, limit, offset }, null, resultCount(data));
      }
      case "refresh_counts": {
        const { error: aErr } = await svc.rpc("db_analyze_public");
        if (aErr) return finish(500, { error: aErr.message }, "rpc_error", null);
        const { data, error } = await svc.rpc("db_list_tables");
        if (error) return finish(500, { error: error.message }, "rpc_error", null);
        tableCache = {
          at: Date.now(),
          names: new Set(((data as Array<{ table_name: string }>) ?? []).map((r) => r.table_name)),
        };
        return finish(200, { data }, null, resultCount(data));
      }
    }
  } catch (e) {
    return finish(500, { error: (e as Error).message ?? "internal_error" }, "internal_error", null);
  }

  return finish(400, { error: "unknown_action" }, "unknown_action", null);
});
