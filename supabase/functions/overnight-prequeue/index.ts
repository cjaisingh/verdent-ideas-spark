// Pre-shift queuer: runs at 21:55 UTC, scans roadmap_phases.run_overnight=true
// (and not in a terminal status, and not past run_overnight_until) and inserts
// one queued row into roadmap_phase_overnight_runs per phase that doesn't
// already have a queued/running run for the same scheduled_for date.
//
// Auth: x-service-token (cron) OR operator JWT (manual trigger from /admin).
// Logs to automation_runs and dispatches auth_failed alerts.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { dispatchAlert } from "../_shared/alerts.ts";
import { withLogger } from "../_shared/logger.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-service-token",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const SERVICE_TOKEN = Deno.env.get("AWIP_SERVICE_TOKEN");

const json = (payload: unknown, status = 200) =>
  new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

const JOB = "overnight-prequeue";
const TERMINAL = ["shipped", "done", "cancelled"];

Deno.serve(withLogger("overnight-prequeue", async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  const startedAt = Date.now();

  const provided = req.headers.get("x-service-token");
  const auth = req.headers.get("authorization") ?? "";
  const triggeredByCron = !!SERVICE_TOKEN && provided === SERVICE_TOKEN;
  const trigger = triggeredByCron ? "cron" : "manual";
  const sb = createClient(SUPABASE_URL, SERVICE_ROLE);

  if (!triggeredByCron && !auth.startsWith("Bearer ")) {
    const reason = !provided
      ? "missing x-service-token header"
      : !SERVICE_TOKEN
        ? "AWIP_SERVICE_TOKEN env var not set on edge function"
        : "service token mismatch";
    const detail = { provided_present: !!provided, service_token_env_present: !!SERVICE_TOKEN };
    await sb.from("automation_runs").insert({
      job: JOB, trigger: "cron", status: "error", status_code: 401,
      message: reason, detail,
    });
    await dispatchAlert(sb, JOB, "auth_failed", `${JOB} 401 — ${reason}`, detail);
    return json({ error: "unauthorized", reason }, 401);
  }

  const today = new Date().toISOString().slice(0, 10);
  const tomorrow = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);

  try {
    // 1. Eligible phases
    const { data: phases, error: phasesErr } = await sb
      .from("roadmap_phases")
      .select("id, key, status, run_overnight_until")
      .eq("run_overnight", true);
    if (phasesErr) throw phasesErr;

    const eligible = (phases ?? []).filter((p: any) =>
      !TERMINAL.includes(String(p.status).toLowerCase())
      && (!p.run_overnight_until || p.run_overnight_until >= today)
    );

    if (eligible.length === 0) {
      const detail = { scanned: phases?.length ?? 0, eligible: 0, queued: 0 };
      await sb.from("automation_runs").insert({
        job: JOB, trigger, status: "ok", status_code: 200,
        message: "no eligible phases",
        detail, duration_ms: Date.now() - startedAt,
      });
      return json({ ok: true, ...detail });
    }

    // 2. Existing queued/running runs scheduled for tonight (skip dupes)
    const phaseIds = eligible.map((p: any) => p.id);
    const { data: existing, error: existErr } = await sb
      .from("roadmap_phase_overnight_runs")
      .select("phase_id")
      .in("phase_id", phaseIds)
      .in("status", ["queued", "running"])
      .eq("scheduled_for", tomorrow);
    if (existErr) throw existErr;
    const skip = new Set((existing ?? []).map((r: any) => r.phase_id));

    // 3. Insert one row per remaining phase
    const toInsert = eligible
      .filter((p: any) => !skip.has(p.id))
      .map((p: any) => ({
        phase_id: p.id,
        phase_key: p.key,
        requested_by: null, // system-queued
        scheduled_for: tomorrow,
        status: "queued",
      }));

    let queued = 0;
    const errors: string[] = [];
    if (toInsert.length > 0) {
      const { data: ins, error: insErr } = await sb
        .from("roadmap_phase_overnight_runs")
        .insert(toInsert)
        .select("id");
      if (insErr) {
        errors.push(insErr.message);
      } else {
        queued = ins?.length ?? 0;
      }
    }

    const detail = {
      scanned: phases?.length ?? 0,
      eligible: eligible.length,
      already_queued: skip.size,
      queued,
      errors,
      scheduled_for: tomorrow,
    };
    const status = errors.length > 0 ? "partial" : "ok";
    const status_code = errors.length > 0 ? 207 : 200;
    await sb.from("automation_runs").insert({
      job: JOB, trigger, status, status_code,
      message: `${JOB} ${status} — queued ${queued}, skipped ${skip.size}`,
      detail, duration_ms: Date.now() - startedAt,
    });
    return json({ ok: true, ...detail }, status_code);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await sb.from("automation_runs").insert({
      job: JOB, trigger, status: "error", status_code: 500,
      message: msg, detail: { error: msg }, duration_ms: Date.now() - startedAt,
    });
    return json({ error: msg }, 500);
  }
}));
