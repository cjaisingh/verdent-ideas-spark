// Poll HeyGen for any 'processing' rows and update status. Operator JWT or service token.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.0";
import { withLogger } from "../_shared/logger.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-service-token",
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...corsHeaders, "Content-Type": "application/json" } });

Deno.serve(withLogger("heygen-poll-video", async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const HEYGEN_API_KEY = Deno.env.get("HEYGEN_API_KEY");
  if (!HEYGEN_API_KEY) return json({ error: "missing_heygen_api_key" }, 500);

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const SERVICE_TOKEN = Deno.env.get("AWIP_SERVICE_TOKEN");
  const provided = req.headers.get("x-service-token");
  const auth = req.headers.get("authorization") ?? "";

  const isCron = !!SERVICE_TOKEN && provided === SERVICE_TOKEN;
  if (!isCron && !auth.startsWith("Bearer ")) return json({ error: "unauthorized" }, 401);

  const sb = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });

  const { data: rows } = await sb.from("heygen_videos")
    .select("id,heygen_video_id")
    .eq("status", "processing")
    .not("heygen_video_id", "is", null)
    .limit(50);

  let polled = 0, ready = 0, failed = 0;
  for (const row of rows ?? []) {
    polled++;
    try {
      const r = await fetch(
        `https://api.heygen.com/v1/video_status.get?video_id=${encodeURIComponent(row.heygen_video_id!)}`,
        { headers: { "X-Api-Key": HEYGEN_API_KEY } },
      );
      const j = await r.json().catch(() => ({}));
      const data = j?.data ?? {};
      const status = String(data.status ?? "");

      if (status === "completed") {
        await sb.from("heygen_videos").update({
          status: "ready",
          video_url: data.video_url ?? null,
          thumbnail_url: data.thumbnail_url ?? null,
          duration_s: typeof data.duration === "number" ? data.duration : null,
        }).eq("id", row.id);
        ready++;
      } else if (status === "failed") {
        await sb.from("heygen_videos").update({
          status: "failed",
          error: data.error?.message ?? data.error?.detail ?? "HeyGen reported failure",
        }).eq("id", row.id);
        failed++;
      }
    } catch (e) {
      console.error("poll failed for", row.id, e);
    }
  }

  return json({ ok: true, polled, ready, failed });
}));
