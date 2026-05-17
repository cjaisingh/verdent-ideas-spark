// Worker reports failure on a claimed ai_job. Requeues or marks failed.
// Auth: x-service-token.
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

Deno.serve(withLogger("ai-jobs-fail", async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  if (!SERVICE_TOKEN || req.headers.get("x-service-token") !== SERVICE_TOKEN) {
    return json({ error: "unauthorized" }, 401);
  }
  const body = await req.json().catch(() => ({}));
  const jobId = String(body?.job_id ?? "");
  const error = String(body?.error ?? "unknown");
  if (!jobId) return json({ error: "job_id_required" }, 400);

  const sb = createClient(SUPABASE_URL, SERVICE_ROLE);
  const { data: job } = await sb.from("ai_jobs")
    .select("id, status, attempts, max_retries, claimed_by").eq("id", jobId).maybeSingle();
  if (!job) return json({ error: "job_not_found" }, 404);
  if (job.status !== "claimed") return json({ error: "job_not_claimed", status: job.status }, 409);

  await sb.from("ai_job_results").insert({
    job_id: jobId, attempt: job.attempts ?? 1, worker_id: job.claimed_by, error,
  });

  const exhausted = (job.attempts ?? 0) >= (job.max_retries ?? 3);
  await sb.from("ai_jobs").update({
    status: exhausted ? "failed" : "queued",
    claimed_by: null,
    claimed_at: null,
    heartbeat_at: null,
    last_error: error.slice(0, 1000),
  }).eq("id", jobId);

  return json({ job_id: jobId, status: exhausted ? "failed" : "queued" });
}));
