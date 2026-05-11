// Auto-escalate any open discussion_action that the night agent has audited
// 3+ times without closing it. Bumps risk to 'high', removes night_eligible,
// and emits a sentinel_findings row so it surfaces in the morning review.
//
// Auth: x-awip-service-token (cron). Idempotent — uses sentinel dedupe_key.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { withLogger } from "../_shared/logger.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-awip-service-token",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(withLogger("night-stuck-escalator", async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const expected = Deno.env.get("AWIP_SERVICE_TOKEN") ?? "";
  const provided = req.headers.get("x-awip-service-token") ?? "";
  if (!expected || provided !== expected) {
    return json({ error: "unauthorized" }, 401);
  }

  const sb = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });

  const { data: stuck, error } = await sb
    .from("discussion_actions_stuck_in_night")
    .select("id, short_num, title, attempts, last_attempt_at");
  if (error) return json({ error: error.message }, 500);

  const escalated: Array<{ id: string; short_num: number | null; attempts: number }> = [];
  const skipped: Array<{ id: string; reason: string }> = [];

  for (const row of stuck ?? []) {
    // Update the action: high risk, drop night eligibility
    const { error: upErr } = await sb
      .from("discussion_actions")
      .update({
        risk: "high",
        night_eligible: false,
        night_override_reason: null,
      })
      .eq("id", row.id)
      .eq("status", "open");
    if (upErr) {
      skipped.push({ id: row.id, reason: upErr.message });
      continue;
    }

    // Sentinel finding (idempotent on dedupe_key)
    const dedupe = `night_stuck_3x:${row.id}`;
    await sb.from("sentinel_findings").upsert({
      kind: "night_stuck_3x",
      severity: "high",
      subject_ref: { discussion_action_id: row.id, short_num: row.short_num },
      summary: `Job #${row.short_num} stuck in night shift for ${row.attempts} attempts`,
      payload: { attempts: row.attempts, last_attempt_at: row.last_attempt_at, title: row.title },
      status: "open",
      dedupe_key: dedupe,
      last_seen_at: new Date().toISOString(),
    }, { onConflict: "dedupe_key" });

    // Audit event on the action
    await sb.from("discussion_action_events").insert({
      action_id: row.id,
      event_type: "auto_escalated",
      actor_label: "night-stuck-escalator",
      payload: { attempts: row.attempts, kind: "night_stuck_3x" },
    });

    escalated.push({ id: row.id, short_num: row.short_num, attempts: row.attempts });
  }

  return json({ checked: stuck?.length ?? 0, escalated, skipped });
}));
