// Receives browser-side errors from the app's ErrorBoundary / window error handlers
// and inserts them into public.frontend_error_logs.
//
// Public endpoint by design: blank-screen errors must report even when auth is broken.
// We strip headers, cap field sizes, and rate-limit per IP at the table level by
// retention + later by Sentinel watcher.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.0";
import { withLogger } from "../_shared/logger.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-request-id",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const cap = (s: unknown, n: number): string | null => {
  if (s == null) return null;
  const str = typeof s === "string" ? s : String(s);
  return str.length > n ? str.slice(0, n) : str;
};

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

Deno.serve(withLogger("frontend-errors", async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "method not allowed" }), {
      status: 405, headers: { ...cors, "Content-Type": "application/json" },
    });
  }

  let body: Record<string, unknown> = {};
  try { body = await req.json(); } catch {/* ignore */}

  const message = cap(body.message, 2000);
  if (!message) {
    return new Response(JSON.stringify({ error: "message required" }), {
      status: 400, headers: { ...cors, "Content-Type": "application/json" },
    });
  }

  const userIdHash = await hashUser(typeof body.user_id === "string" ? body.user_id : null);
  const sb = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

  const { data, error } = await sb.from("frontend_error_logs").insert({
    request_id: cap(body.request_id, 64),
    user_id_hash: userIdHash,
    url: cap(body.url, 1000),
    user_agent: cap(req.headers.get("user-agent"), 500),
    message,
    stack: cap(body.stack, 8000),
    source: cap(body.source, 500),
    lineno: typeof body.lineno === "number" ? body.lineno : null,
    colno: typeof body.colno === "number" ? body.colno : null,
    kind: cap(body.kind, 32) ?? "error",
    meta: (typeof body.meta === "object" && body.meta) ? body.meta : {},
  }).select("id").single();

  if (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500, headers: { ...cors, "Content-Type": "application/json" },
    });
  }
  return new Response(JSON.stringify({ ok: true, id: data?.id }), {
    status: 200, headers: { ...cors, "Content-Type": "application/json" },
  });
}));
