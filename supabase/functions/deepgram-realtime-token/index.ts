// Mints a short-lived Deepgram token for browser-side realtime STT WebSocket.
// Auth: operator JWT.
//
// Every error response includes a stable `code` field for client/log triage:
//   CONFIG_MISSING_KEY      - DEEPGRAM_API_KEY not set in Cloud secrets
//   AUTH_MISSING            - request had no Authorization header
//   AUTH_INVALID            - JWT could not be resolved to a user
//   AUTH_NOT_OPERATOR       - user is authenticated but lacks operator role
//   DG_KEY_FORBIDDEN        - master key lacks Member+ role (cannot call /v1/auth/grant)
//   DG_KEY_UNAUTHORIZED     - master key revoked or wrong env value
//   DG_RATE_LIMITED         - Deepgram returned 429
//   DG_UPSTREAM_ERROR       - Deepgram 5xx or other unexpected status
//   DG_BAD_RESPONSE         - Deepgram returned 200 but no token in body
//   INTERNAL                - unhandled exception in the function
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

type ErrCode =
  | "CONFIG_MISSING_KEY"
  | "AUTH_MISSING"
  | "AUTH_INVALID"
  | "AUTH_NOT_OPERATOR"
  | "DG_KEY_FORBIDDEN"
  | "DG_KEY_UNAUTHORIZED"
  | "DG_RATE_LIMITED"
  | "DG_UPSTREAM_ERROR"
  | "DG_BAD_RESPONSE"
  | "INTERNAL";

function classifyDeepgram(status: number, body: string): ErrCode {
  if (status === 401) return "DG_KEY_UNAUTHORIZED";
  if (status === 403) return "DG_KEY_FORBIDDEN";
  if (status === 429) return "DG_RATE_LIMITED";
  // Deepgram sometimes returns 400 with err_code FORBIDDEN/INSUFFICIENT_PERMISSIONS
  if (/INSUFFICIENT_PERMISSIONS|FORBIDDEN/i.test(body)) return "DG_KEY_FORBIDDEN";
  return "DG_UPSTREAM_ERROR";
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const reqId = crypto.randomUUID();
  const t0 = Date.now();
  const slog = (event: string, fields: Record<string, unknown> = {}) =>
    console.log(JSON.stringify({ level: "info", fn: "deepgram-realtime-token", reqId, event, ms: Date.now() - t0, ...fields }));
  const slogErr = (event: string, fields: Record<string, unknown> = {}) =>
    console.error(JSON.stringify({ level: "error", fn: "deepgram-realtime-token", reqId, event, ms: Date.now() - t0, ...fields }));

  const fail = (code: ErrCode, status: number, message: string, extra: Record<string, unknown> = {}) => {
    slogErr("response_error", { code, status, message, ...extra });
    return json({ code, error: message, reqId, ...extra }, status);
  };

  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    // Prefer DB-stored secret (admin-rotatable), fall back to env var.
    let DEEPGRAM_API_KEY = Deno.env.get("DEEPGRAM_API_KEY") ?? "";
    let keySource: "db" | "env" | "none" = DEEPGRAM_API_KEY ? "env" : "none";
    try {
      const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
      const { data: row } = await admin
        .from("app_secrets").select("value").eq("key", "DEEPGRAM_API_KEY").maybeSingle();
      if (row?.value) { DEEPGRAM_API_KEY = row.value; keySource = "db"; }
    } catch (e) { slogErr("db_secret_read_failed", { message: e instanceof Error ? e.message : String(e) }); }

    slog("incoming", { method: req.method, hasKey: !!DEEPGRAM_API_KEY, keySource, keyPrefix: DEEPGRAM_API_KEY?.slice(0, 6) });
    if (!DEEPGRAM_API_KEY) return fail("CONFIG_MISSING_KEY", 500, "DEEPGRAM_API_KEY not configured");

    const authHeader = req.headers.get("Authorization") ?? "";
    if (!authHeader) return fail("AUTH_MISSING", 401, "missing authorization");

    const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userRes, error: userErr } = await userClient.auth.getUser();
    if (userErr) slogErr("auth_get_user_error", { message: userErr.message });
    const user = userRes?.user;
    if (!user) return fail("AUTH_INVALID", 401, "not authenticated");

    const { data: hasOp, error: roleErr } = await userClient.rpc("has_role", {
      _user_id: user.id,
      _role: "operator",
    });
    if (roleErr) slogErr("has_role_error", { message: roleErr.message });
    slog("auth_ok", { userId: user.id, hasOp: !!hasOp });
    if (!hasOp) return fail("AUTH_NOT_OPERATOR", 403, "operator role required");

    slog("dg_grant_call");
    const grantRes = await fetch("https://api.deepgram.com/v1/auth/grant", {
      method: "POST",
      headers: {
        Authorization: `Token ${DEEPGRAM_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ ttl_seconds: 60 }),
    });
    const respHeaders: Record<string, string> = {};
    grantRes.headers.forEach((v, k) => { respHeaders[k] = v; });
    const bodyText = await grantRes.text();
    slog("dg_grant_response", { status: grantRes.status, dg_request_id: respHeaders["dg-request-id"], body_preview: bodyText.slice(0, 300) });

    if (!grantRes.ok) {
      const code = classifyDeepgram(grantRes.status, bodyText);
      const upstreamStatus = grantRes.status >= 500 ? 502 : 502;
      return fail(code, upstreamStatus, "deepgram /v1/auth/grant failed", {
        deepgram_status: grantRes.status,
        deepgram_body: bodyText,
        dg_request_id: respHeaders["dg-request-id"],
        hint: code === "DG_KEY_FORBIDDEN"
          ? "Master key lacks Member+ role. Create a new key with Member role in console.deepgram.com → API Keys and update DEEPGRAM_API_KEY."
          : code === "DG_KEY_UNAUTHORIZED"
          ? "Master key is revoked or wrong env value. Rotate DEEPGRAM_API_KEY."
          : code === "DG_RATE_LIMITED"
          ? "Deepgram is rate-limiting this account. Retry shortly."
          : "Unexpected upstream error from Deepgram.",
      });
    }

    let grantJson: { access_token?: string; key?: string; expires_in?: number } = {};
    try { grantJson = JSON.parse(bodyText); } catch (e) { slogErr("dg_parse_error", { message: e instanceof Error ? e.message : String(e) }); }
    const token = grantJson.access_token ?? grantJson.key;
    if (!token) {
      return fail("DG_BAD_RESPONSE", 502, "deepgram returned no token", { deepgram_body: bodyText });
    }
    const expiresIn = grantJson.expires_in ?? 60;
    const expiry = Math.floor(Date.now() / 1000) + expiresIn;
    slog("ok", { expiry, expires_in: expiresIn, tokenPrefix: String(token).slice(0, 8) });
    return json({ key: token, expires_at: expiry, expires_in: expiresIn, reqId });
  } catch (e) {
    return fail("INTERNAL", 500, e instanceof Error ? e.message : "unknown error", {
      stack: e instanceof Error ? e.stack?.split("\n").slice(0, 5) : undefined,
    });
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
