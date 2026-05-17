// Worker pulls the next queued ai_job matching its model tags.
// Auth: x-service-token header (AWIP_SERVICE_TOKEN).
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { withLogger } from "../_shared/logger.ts";
import { buildPrompt, type AiJobKind } from "../_shared/contracts/ai-jobs.ts";

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

Deno.serve(withLogger("ai-jobs-claim", async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  const provided = req.headers.get("x-service-token");
  if (!SERVICE_TOKEN || provided !== SERVICE_TOKEN) {
    return json({ error: "unauthorized" }, 401);
  }

  const body = await req.json().catch(() => ({}));
  const workerName = String(body?.worker_name ?? "").trim();
  const modelTags: string[] = Array.isArray(body?.model_tags) ? body.model_tags : [];
  const defaultModel: string | null =
    typeof body?.default_model === "string" && body.default_model.trim()
      ? body.default_model.trim() : null;
  if (!workerName) return json({ error: "worker_name_required" }, 400);

  const sb = createClient(SUPABASE_URL, SERVICE_ROLE);

  // Upsert worker, mark seen.
  const upsertPayload: Record<string, unknown> = {
    name: workerName,
    model_tags: modelTags,
    last_seen_at: new Date().toISOString(),
  };
  if (defaultModel) upsertPayload.default_model = defaultModel;
  const { data: workerRow, error: wErr } = await sb.from("ai_workers")
    .upsert(upsertPayload, { onConflict: "name" })
    .select("id, enabled").single();
  if (wErr) return json({ error: "worker_upsert_failed", detail: wErr.message }, 500);
  if (!workerRow.enabled) return json({ error: "worker_disabled" }, 403);

  // Atomic claim via SQL: SELECT FOR UPDATE SKIP LOCKED + UPDATE.
  // Filter required_model_tags as subset of worker's tags (empty = any).
  const { data: claimed, error: cErr } = await sb.rpc("ai_jobs_claim_next", {
    _worker_id: workerRow.id,
    _worker_tags: modelTags,
  });
  if (cErr) {
    // Function doesn't exist yet → fall back to a best-effort claim in SQL via select+update.
    if (String(cErr.message).includes("ai_jobs_claim_next")) {
      // Eligible jobs
      const { data: candidates } = await sb.from("ai_jobs")
        .select("id, kind, input_json, requested_model, required_model_tags, attempts")
        .eq("status", "queued")
        .order("priority", { ascending: true })
        .order("created_at", { ascending: true })
        .limit(20);
      const eligible = (candidates ?? []).find((c: any) => {
        const need: string[] = c.required_model_tags ?? [];
        return need.every((t) => modelTags.includes(t));
      });
      if (!eligible) return new Response(null, { status: 204, headers: corsHeaders });
      const { data: upd } = await sb.from("ai_jobs")
        .update({
          status: "claimed",
          claimed_by: workerRow.id,
          claimed_at: new Date().toISOString(),
          heartbeat_at: new Date().toISOString(),
          attempts: (eligible.attempts ?? 0) + 1,
        })
        .eq("id", eligible.id).eq("status", "queued")
        .select("id, kind, input_json, requested_model").maybeSingle();
      if (!upd) return new Response(null, { status: 204, headers: corsHeaders });
      const prompt = buildPrompt(upd.kind as AiJobKind, upd.input_json);
      return json({ job: { id: upd.id, kind: upd.kind, requested_model: upd.requested_model, prompt } });
    }
    return json({ error: "claim_failed", detail: cErr.message }, 500);
  }

  if (!claimed || !claimed.id) return new Response(null, { status: 204, headers: corsHeaders });
  const prompt = buildPrompt(claimed.kind as AiJobKind, claimed.input_json);
  return json({ job: { id: claimed.id, kind: claimed.kind, requested_model: claimed.requested_model, prompt } });
}));
