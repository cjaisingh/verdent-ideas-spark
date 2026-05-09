// Structured logging middleware for AWIP edge functions.
//
// Wrap your handler:
//   import { withLogger } from "../_shared/logger.ts";
//   Deno.serve(withLogger("my-fn", async (req, ctx) => { ... return new Response(...) }));
//
// Each request:
//   - gets/inherits an x-request-id
//   - is recorded in public.edge_request_logs with status + latency_ms + classified error
//   - propagates the request-id back via the response header
//
// The middleware swallows logging errors — it must never break the wrapped handler.

import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.57.0";

export type LogContext = {
  requestId: string;
  startedAt: number;
  functionName: string;
  meta: Record<string, unknown>;
  // Allow handlers to attach extra structured data that ends up in `meta`.
  attach: (k: string, v: unknown) => void;
};

export type Handler = (req: Request, ctx: LogContext) => Promise<Response> | Response;

const SERVICE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

let _client: SupabaseClient | null = null;
function client(): SupabaseClient | null {
  if (!SERVICE_URL || !SERVICE_KEY) return null;
  if (!_client) _client = createClient(SERVICE_URL, SERVICE_KEY, { auth: { persistSession: false } });
  return _client;
}

function genRequestId(): string {
  return (crypto as Crypto).randomUUID().replace(/-/g, "").slice(0, 16);
}

// Cheap, deterministic, non-reversible hash of a user id for analytics without leaking the id itself.
async function hashUser(userId: string | null): Promise<string | null> {
  if (!userId) return null;
  try {
    const buf = new TextEncoder().encode(`awip:${userId}`);
    const digest = await crypto.subtle.digest("SHA-256", buf);
    const bytes = new Uint8Array(digest).slice(0, 8);
    return Array.from(bytes).map((b) => b.toString(16).padStart(2, "0")).join("");
  } catch {
    return null;
  }
}

// Best-effort extract of the auth user id from the JWT in Authorization header. We do NOT verify;
// it's used only to derive a hash for analytics. Auth/permissions are still enforced by RLS / has_role.
function extractUserId(req: Request): string | null {
  const auth = req.headers.get("authorization") || req.headers.get("Authorization");
  if (!auth?.startsWith("Bearer ")) return null;
  const token = auth.slice(7);
  const parts = token.split(".");
  if (parts.length < 2) return null;
  try {
    const json = JSON.parse(atob(parts[1].replace(/-/g, "+").replace(/_/g, "/")));
    return typeof json?.sub === "string" ? json.sub : null;
  } catch {
    return null;
  }
}

// Classify common errors so dashboards can group them without parsing free-text messages.
export function classifyError(status: number, msg?: string | null): string | null {
  if (status < 400) return null;
  const m = (msg ?? "").toLowerCase();
  if (status === 401 || /unauthor|invalid (jwt|token)|missing token/.test(m)) return "auth";
  if (status === 403 || /forbidden|not authorized|has_role/.test(m)) return "forbidden";
  if (status === 404 || /not[_ ]found/.test(m)) return "not_found";
  if (status === 429 || /rate[_ ]limit|too many/.test(m)) return "rate_limit";
  if (status >= 500 && /timeout|timed out/.test(m)) return "timeout";
  if (status >= 500 && /fetch|network/.test(m)) return "upstream";
  if (status >= 500) return "server_error";
  if (status >= 400) return "client_error";
  return null;
}

export function withLogger(functionName: string, handler: Handler): (req: Request) => Promise<Response> {
  return async (req: Request): Promise<Response> => {
    const requestId = req.headers.get("x-request-id") || genRequestId();
    const startedAt = performance.now();
    const meta: Record<string, unknown> = {};
    const ctx: LogContext = {
      requestId,
      startedAt,
      functionName,
      meta,
      attach: (k, v) => { meta[k] = v; },
    };

    let resp: Response;
    let errMessage: string | null = null;
    try {
      resp = await handler(req, ctx);
    } catch (e) {
      errMessage = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
      resp = new Response(JSON.stringify({ error: errMessage, request_id: requestId }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      });
    }

    // Always echo the request id back to callers.
    const headers = new Headers(resp.headers);
    headers.set("x-request-id", requestId);
    const wrapped = new Response(resp.body, { status: resp.status, statusText: resp.statusText, headers });

    // Fire-and-forget log insert — must not delay the response or surface errors.
    queueMicrotask(async () => {
      try {
        const sb = client();
        if (!sb) return;
        const url = new URL(req.url);
        const userIdHash = await hashUser(extractUserId(req));
        await sb.from("edge_request_logs").insert({
          request_id: requestId,
          function_name: functionName,
          method: req.method,
          path: url.pathname + (url.search || ""),
          status: resp.status,
          latency_ms: Math.round(performance.now() - startedAt),
          user_id_hash: userIdHash,
          classified_error: classifyError(resp.status, errMessage),
          error_message: errMessage,
          meta,
        });
      } catch {/* never throw from logger */}
    });

    return wrapped;
  };
}
