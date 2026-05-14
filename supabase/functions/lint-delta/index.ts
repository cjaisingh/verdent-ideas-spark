// lint-delta — Hermes slice 2 HTTP wrapper around _shared/delta-lint.ts.
//
// Auth: AWIP_SERVICE_TOKEN (cross-project) OR operator/admin JWT.
//
// POST body: { files: [{ path, content }], caller?: string }
// Response: { ok: boolean, results: LintResult[] }
//   ok = false if any file failed.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.0";
import { withLogger } from "../_shared/logger.ts";
import { lintDelta, type LintInput } from "../_shared/delta-lint.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-awip-service-token, x-request-id",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const SERVICE_TOKEN = Deno.env.get("AWIP_SERVICE_TOKEN") ?? "";

async function authorize(req: Request): Promise<boolean> {
  const svc = req.headers.get("x-awip-service-token");
  if (svc && SERVICE_TOKEN && svc === SERVICE_TOKEN) return true;
  const auth = req.headers.get("authorization") ?? "";
  const jwt = auth.replace(/^Bearer\s+/i, "");
  if (!jwt) return false;
  const userClient = createClient(SUPABASE_URL, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: `Bearer ${jwt}` } },
  });
  const { data, error } = await userClient.auth.getUser();
  if (error || !data.user) return false;
  const sb = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
  const { data: roles } = await sb.from("user_roles").select("role").eq("user_id", data.user.id);
  return (roles ?? []).some((r: { role: string }) => r.role === "operator" || r.role === "admin");
}

function isLintInputArray(v: unknown): v is LintInput[] {
  return Array.isArray(v) && v.every((f) =>
    f && typeof f === "object"
    && typeof (f as { path?: unknown }).path === "string"
    && typeof (f as { content?: unknown }).content === "string"
    && (f as { path: string }).path.length > 0
    && (f as { path: string }).path.length < 1024
    && (f as { content: string }).content.length < 200_000
  );
}

Deno.serve(withLogger("lint-delta", async (req, ctx) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "method_not_allowed" }), {
      status: 405, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  if (!(await authorize(req))) {
    return new Response(JSON.stringify({ error: "unauthorized" }), {
      status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  let body: { files?: unknown; caller?: unknown };
  try { body = await req.json(); } catch {
    return new Response(JSON.stringify({ error: "invalid_json" }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  if (!isLintInputArray(body.files)) {
    return new Response(JSON.stringify({
      error: "invalid_body",
      detail: "files must be an array of { path: string, content: string } (path<1024, content<200kB)",
    }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
  if (body.files.length === 0 || body.files.length > 25) {
    return new Response(JSON.stringify({ error: "invalid_body", detail: "files must contain 1..25 entries" }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const caller = typeof body.caller === "string" && body.caller.length < 64 ? body.caller : "lint-delta";
  ctx.attach("caller", caller);
  ctx.attach("file_count", body.files.length);

  const results = await lintDelta(body.files, { caller, requestId: ctx.requestId });
  const ok = results.every((r) => r.status === "ok" || r.status === "skipped");
  ctx.attach("ok", ok);
  ctx.attach("failed", results.filter((r) => r.status === "failed").length);

  return new Response(JSON.stringify({ ok, results }), {
    status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}));
