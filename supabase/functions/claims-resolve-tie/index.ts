// W7.2 — service-path resolver for tie-break / cross-project callers.
// Operator JWT → calls public.resolve_truth via user client.
// Service token → calls public.resolve_truth_service via service-role client.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { z } from "https://esm.sh/zod@3.23.8";
import { withLogger } from "../_shared/logger.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-service-token",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), {
    status: s,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

const Body = z.object({
  entity: z.string().min(1).max(64),
  entity_id: z.string().uuid(),
  field: z.string().min(1).max(128).default("*"),
});

Deno.serve(withLogger("claims-resolve-tie", async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const ANON = Deno.env.get("SUPABASE_ANON_KEY")!;
  const SERVICE_TOKEN = Deno.env.get("AWIP_SERVICE_TOKEN");

  const provided = req.headers.get("x-service-token");
  const auth = req.headers.get("authorization") ?? "";
  const isService = !!SERVICE_TOKEN && provided === SERVICE_TOKEN;

  if (!isService) {
    if (!auth.startsWith("Bearer ")) return json({ error: "unauthorized" }, 401);
  }

  let body: unknown;
  try { body = await req.json(); } catch { return json({ error: "invalid_json" }, 400); }
  const parsed = Body.safeParse(body);
  if (!parsed.success) return json({ error: parsed.error.flatten() }, 400);
  const p = parsed.data;

  if (isService) {
    const sb = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });
    const { data, error } = await sb.rpc("resolve_truth_service", {
      _entity: p.entity, _entity_id: p.entity_id, _field: p.field,
    });
    if (error) return json({ error: error.message }, 500);
    return json({ ok: true, actor: "service", resolved: data });
  }

  const userClient = createClient(SUPABASE_URL, ANON, {
    global: { headers: { Authorization: auth } },
    auth: { persistSession: false },
  });
  const { data: u, error: ue } = await userClient.auth.getUser();
  if (ue || !u?.user) return json({ error: "unauthorized" }, 401);
  const { data, error } = await userClient.rpc("resolve_truth", {
    _entity: p.entity, _entity_id: p.entity_id, _field: p.field,
  });
  if (error) return json({ error: error.message }, error.message.includes("authorized") ? 403 : 500);
  return json({ ok: true, actor: u.user.email ?? "operator", resolved: data });
}));
