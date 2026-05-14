// Cron entry — fans out to heygen-poll-video. Service token only.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.0";
import { withLogger } from "../_shared/logger.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-service-token",
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...corsHeaders, "Content-Type": "application/json" } });

Deno.serve(withLogger("scheduled-heygen-poll", async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const SERVICE_TOKEN = Deno.env.get("AWIP_SERVICE_TOKEN");
  const provided = req.headers.get("x-service-token");
  if (!SERVICE_TOKEN || provided !== SERVICE_TOKEN) return json({ error: "unauthorized" }, 401);

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const sb = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });

  // Early-exit if nothing to poll.
  const { count } = await sb.from("heygen_videos").select("id", { count: "exact", head: true }).eq("status", "processing");
  if (!count || count === 0) return json({ ok: true, skipped: true });

  const r = await fetch(`${SUPABASE_URL}/functions/v1/heygen-poll-video`, {
    method: "POST",
    headers: { "x-service-token": SERVICE_TOKEN, "Content-Type": "application/json" },
    body: "{}",
  });
  const j = await r.json().catch(() => ({}));
  return json({ ok: true, processing: count, result: j });
}));
