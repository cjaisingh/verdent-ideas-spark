// Worker posts the completed result of an ai_job.
// Records ai_job_results + creates ai_draft_outputs for review.
// Also logs an entry into ai_usage_log with model='<ollama-model>' so the
// existing usage panels can display local spend as $0.
//
// Auth: x-service-token.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { withLogger } from "../_shared/logger.ts";
import { projectDraft, type AiJobKind } from "../_shared/contracts/ai-jobs.ts";

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

Deno.serve(withLogger("ai-jobs-complete", async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  if (!SERVICE_TOKEN || req.headers.get("x-service-token") !== SERVICE_TOKEN) {
    return json({ error: "unauthorized" }, 401);
  }

  const body = await req.json().catch(() => ({}));
  const jobId = String(body?.job_id ?? "");
  const output_text = String(body?.output_text ?? "");
  const model = body?.model ? String(body.model) : null;
  const tokens_in = Number.isFinite(body?.tokens_in) ? Number(body.tokens_in) : null;
  const tokens_out = Number.isFinite(body?.tokens_out) ? Number(body.tokens_out) : null;
  const latency_ms = Number.isFinite(body?.latency_ms) ? Number(body.latency_ms) : null;
  if (!jobId || !output_text) return json({ error: "job_id_and_output_text_required" }, 400);

  const sb = createClient(SUPABASE_URL, SERVICE_ROLE);

  const { data: job, error: jErr } = await sb.from("ai_jobs")
    .select("id, kind, input_json, claimed_by, attempts, status").eq("id", jobId).maybeSingle();
  if (jErr || !job) return json({ error: "job_not_found" }, 404);
  if (job.status !== "claimed") return json({ error: "job_not_claimed", status: job.status }, 409);

  // 1. Record attempt
  await sb.from("ai_job_results").insert({
    job_id: jobId,
    attempt: job.attempts ?? 1,
    worker_id: job.claimed_by,
    model, output_text, tokens_in, tokens_out, latency_ms,
  });

  // 2. Mark job done
  await sb.from("ai_jobs").update({
    status: "done", heartbeat_at: new Date().toISOString(),
  }).eq("id", jobId);

  // 3. Project to reviewable draft
  let projected;
  try {
    projected = projectDraft(job.kind as AiJobKind, job.input_json, output_text);
  } catch (e) {
    return json({ error: "projection_failed", detail: (e as Error).message }, 500);
  }
  const { data: draft } = await sb.from("ai_draft_outputs").insert({
    job_id: jobId,
    kind: projected.kind,
    target_ref: projected.target_ref,
    body_md: projected.body_md,
  }).select("id").single();

  // 4. ai_usage_log: best-effort, ignore errors (table may not exist in some envs).
  try {
    await sb.from("ai_usage_log").insert({
      job: "ollama-worker",
      model: model ?? "unknown",
      trigger: "worker",
      status: "ok",
      status_code: 200,
      latency_ms,
      prompt_tokens: tokens_in,
      completion_tokens: tokens_out,
      request_ref: { ai_job_id: jobId, kind: job.kind, local: true },
    });
  } catch (_) { /* ignore */ }

  return json({ job_id: jobId, draft_id: draft?.id ?? null, status: "done" });
}));
