// Worker heartbeat for a claimed ai_job. Auth: x-service-token.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { withLogger } from "../_shared/logger.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-service-token",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const SERVICE_TOKEN = Deno.env.get("AWIP_SERVICE_TOKEN");

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status, headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(withLogger("ai-jobs-heartbeat", async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  if (!SERVICE_TOKEN || req.headers.get("x-service-token") !== SERVICE_TOKEN) {
    return json({ error: "unauthorized" }, 401);
  }
  const body = await req.json().catch(() => ({}));
  const jobId = String(body?.job_id ?? "");
  const workerName = String(body?.worker_name ?? "");
  if (!jobId) return json({ error: "job_id_required" }, 400);

  const sb = createClient(SUPABASE_URL, SERVICE_ROLE);
  if (workerName) {
    await sb.from("ai_workers").update({ last_seen_at: new Date().toISOString() }).eq("name", workerName);
  }
  const { data, error } = await sb.from("ai_jobs")
    .update({ heartbeat_at: new Date().toISOString() })
    .eq("id", jobId).eq("status", "claimed")
    .select("id").maybeSingle();
  if (error) return json({ error: "update_failed", detail: error.message }, 500);
  return json({ ok: !!data, job_id: jobId });
}));
