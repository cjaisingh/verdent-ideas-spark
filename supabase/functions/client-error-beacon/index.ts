// Captures browser-side network failures that never reach an edge function
// (CORS preflight aborts, transient TLS, page navigation tear-downs, etc.).
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { withLogger } from "../_shared/logger.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
};

const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...corsHeaders, "Content-Type": "application/json" } });

async function hashUser(userId: string | null): Promise<string | null> {
  if (!userId) return null;
  try {
    const buf = new TextEncoder().encode(`awip:${userId}`);
    const digest = await crypto.subtle.digest("SHA-256", buf);
    return Array.from(new Uint8Array(digest).slice(0, 8))
      .map((b) => b.toString(16).padStart(2, "0")).join("");
  } catch { return null; }
}
function userIdFromAuth(req: Request): string | null {
  const auth = req.headers.get("authorization") || "";
  if (!auth.startsWith("Bearer ")) return null;
  const parts = auth.slice(7).split(".");
  if (parts.length < 2) return null;
  try {
    const payload = JSON.parse(atob(parts[1].replace(/-/g, "+").replace(/_/g, "/")));
    return typeof payload?.sub === "string" ? payload.sub : null;
  } catch { return null; }
}

Deno.serve(withLogger("client-error-beacon", async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405);

  let body: Record<string, unknown> = {};
  try { body = await req.json(); } catch { return json({ error: "invalid json" }, 400); }

  const message = String(body.message ?? "").slice(0, 1000);
  if (!message) return json({ error: "message required" }, 400);

  const sb = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false } },
  );

  const user_id_hash = await hashUser(userIdFromAuth(req));
  await sb.from("client_error_log").insert({
    function_name: typeof body.function_name === "string" ? body.function_name.slice(0, 120) : null,
    url: typeof body.url === "string" ? body.url.slice(0, 500) : null,
    message,
    request_id: typeof body.request_id === "string" ? body.request_id.slice(0, 64) : null,
    user_agent: req.headers.get("user-agent")?.slice(0, 240) ?? null,
    user_id_hash,
    meta: (body.meta && typeof body.meta === "object") ? body.meta : {},
  });

  return json({ ok: true });
}));
