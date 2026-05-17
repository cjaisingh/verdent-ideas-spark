// Enqueue an AI job for the local Ollama worker to pick up.
// Auth: operator JWT only.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { withLogger } from "../_shared/logger.ts";
import { AI_JOB_KINDS, validateInput, type AiJobKind } from "../_shared/contracts/ai-jobs.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, idempotency-key",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status, headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(withLogger("ai-jobs-enqueue", async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  const auth = req.headers.get("Authorization") ?? "";
  if (!auth.startsWith("Bearer ")) return json({ error: "unauthorized" }, 401);

  const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: auth } },
  });
  const { data: u } = await userClient.auth.getUser();
  if (!u?.user) return json({ error: "unauthorized" }, 401);
  const { data: hasOp } = await userClient.rpc("has_role", { _user_id: u.user.id, _role: "operator" });
  if (!hasOp) return json({ error: "operator_role_required" }, 403);

  const body = await req.json().catch(() => ({}));
  const kind = String(body?.kind ?? "") as AiJobKind;
  if (!AI_JOB_KINDS.includes(kind)) return json({ error: "invalid_kind", allowed: AI_JOB_KINDS }, 400);

  let parsedInput: unknown;
  try {
    parsedInput = validateInput(kind, body?.input ?? {});
  } catch (e) {
    return json({ error: "invalid_input", detail: (e as Error).message }, 400);
  }

  const idemKey =
    req.headers.get("idempotency-key") ??
    (typeof body?.idempotency_key === "string" ? body.idempotency_key : null);

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE);

  if (idemKey) {
    const { data: existing } = await admin
      .from("ai_jobs").select("id, status").eq("idempotency_key", idemKey).maybeSingle();
    if (existing) return json({ id: existing.id, status: existing.status, idempotent: true });
  }

  const { data: row, error } = await admin.from("ai_jobs").insert({
    kind,
    input_json: parsedInput,
    requested_model: body?.requested_model ?? null,
    required_model_tags: Array.isArray(body?.required_model_tags) ? body.required_model_tags : [],
    priority: Number.isFinite(body?.priority) ? Number(body.priority) : 100,
    idempotency_key: idemKey,
    created_by: u.user.id,
  }).select("id, status").single();

  if (error) return json({ error: "insert_failed", detail: error.message }, 500);
  return json({ id: row.id, status: row.status });
}));
