// roadmap-phase-signoff
// Called when an operator approves a "roadmap.phase_signoff" approval_queue row.
// Flips roadmap_phases.status='done' and emits a capability_events row.
//
// Auth: operator JWT or x-service-token (cron/internal).
// Body: { approval_id: string }
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-service-token",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const SERVICE_TOKEN = Deno.env.get("AWIP_SERVICE_TOKEN");

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const provided = req.headers.get("x-service-token");
  const auth = req.headers.get("authorization") ?? "";
  const triggeredBySvc = !!SERVICE_TOKEN && provided === SERVICE_TOKEN;
  if (!triggeredBySvc && !auth.startsWith("Bearer ")) return json({ error: "unauthorized" }, 401);

  let body: { approval_id?: string };
  try { body = await req.json(); } catch { return json({ error: "invalid_json" }, 400); }
  const approvalId = body.approval_id;
  if (!approvalId || typeof approvalId !== "string") return json({ error: "approval_id required" }, 400);

  const sb = createClient(SUPABASE_URL, SERVICE_ROLE);

  const { data: ap, error: apErr } = await sb
    .from("approval_queue")
    .select("id, activity, status, intent_payload, decided_at, decided_by")
    .eq("id", approvalId).maybeSingle();
  if (apErr || !ap) return json({ error: "approval_not_found" }, 404);
  if (ap.activity !== "roadmap.phase_signoff") return json({ error: "wrong_activity" }, 400);
  if (ap.status !== "approved") return json({ error: "approval_not_approved", status: ap.status }, 409);

  const phaseId = (ap.intent_payload as Record<string, unknown> | null)?.["phase_id"] as string | undefined;
  if (!phaseId) return json({ error: "phase_id missing in intent_payload" }, 400);

  // Snapshot current gate status BEFORE flipping the phase
  const { data: gateSnap } = await sb
    .from("roadmap_phase_gate_status")
    .select("*").eq("phase_id", phaseId).maybeSingle();

  const { data: phaseRow, error: upErr } = await sb
    .from("roadmap_phases").update({ status: "done" }).eq("id", phaseId)
    .select("id, key").maybeSingle();
  if (upErr || !phaseRow) return json({ error: upErr?.message ?? "phase_not_found" }, 500);

  // Resolve approver caller (operator JWT) → email label
  let approverLabel: string | null = ap.decided_by ?? null;
  let approverUserId: string | null = null;
  if (!triggeredBySvc && auth.startsWith("Bearer ")) {
    const token = auth.slice(7);
    const { data: userRes } = await sb.auth.getUser(token);
    if (userRes?.user) {
      approverUserId = userRes.user.id;
      approverLabel = userRes.user.email ?? approverLabel ?? userRes.user.id;
    }
  }

  // Idempotent on (phase_id, approval_id)
  const { error: auditErr } = await sb.from("roadmap_phase_signoffs").insert({
    phase_id: phaseId,
    phase_key: phaseRow.key,
    approval_id: approvalId,
    approver: approverLabel,
    approver_user_id: approverUserId,
    decided_at: ap.decided_at ?? new Date().toISOString(),
    gate_snapshot: gateSnap ?? {},
  });
  if (auditErr && !/duplicate|unique/i.test(auditErr.message)) {
    console.error("audit insert failed", auditErr);
  }

  await sb.from("capability_events").insert({
    capability_id: "operator_channel.roadmap",
    event_type: "phase.signed_off",
    actor: approverLabel ?? "operator",
    payload: { phase_id: phaseId, phase_key: phaseRow.key, approval_id: approvalId },
  });

  return json({ ok: true, phase_id: phaseId, phase_key: phaseRow.key });
});
