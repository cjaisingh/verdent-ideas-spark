// overnight-recommender
// Runs at 21:30 UTC (25 min before overnight-prequeue). For each non-terminal
// roadmap_phase that has ≥1 signoff and is NOT already flagged run_overnight,
// score it as a candidate for tonight and upsert into overnight_recommendations
// (unique on scheduled_for, phase_id). Pure SQL — no AI calls.
//
// Auth: x-service-token (cron) OR operator JWT (manual refresh).
// Logs to automation_runs (job=overnight-recommender).

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

const JOB = "overnight-recommender";
const TERMINAL = ["shipped", "done", "cancelled"];
const TASK_TERMINAL = ["done", "shipped", "wont_do", "cancelled"];

const json = (payload: unknown, status = 200) =>
  new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

Deno.serve(withLogger("overnight-recommender", async (req) => {
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
  const weekAgoIso = new Date(Date.now() - 7 * 86_400_000).toISOString();
  const threeDaysAgoIso = new Date(Date.now() - 3 * 86_400_000).toISOString();

  try {
    // 1. All phases
    const { data: phases, error: phasesErr } = await sb
      .from("roadmap_phases")
      .select("id, key, title, status, run_overnight");
    if (phasesErr) throw phasesErr;

    const candidates = (phases ?? []).filter((p: any) =>
      !TERMINAL.includes(String(p.status).toLowerCase())
      && !p.run_overnight
    );

    if (candidates.length === 0) {
      const detail = { scanned: phases?.length ?? 0, candidates: 0, written: 0, scheduled_for: tomorrow };
      await sb.from("automation_runs").insert({
        job: JOB, trigger, status: "ok", status_code: 200,
        message: "no candidates", detail, duration_ms: Date.now() - startedAt,
      });
      return json({ ok: true, ...detail, recommendations: [] });
    }

    const phaseIds = candidates.map((p: any) => p.id);

    // 2. Signoff counts per phase
    const { data: signoffs } = await sb
      .from("roadmap_phase_signoffs")
      .select("phase_id")
      .in("phase_id", phaseIds);
    const signoffSet = new Set((signoffs ?? []).map((s: any) => s.phase_id));

    // 3. Already queued/running for tomorrow
    const { data: queued } = await sb
      .from("roadmap_phase_overnight_runs")
      .select("phase_id")
      .in("phase_id", phaseIds)
      .in("status", ["queued", "running"])
      .eq("scheduled_for", tomorrow);
    const queuedSet = new Set((queued ?? []).map((r: any) => r.phase_id));

    // 4. Last successful run per phase
    const { data: recentRuns } = await sb
      .from("roadmap_phase_overnight_runs")
      .select("phase_id, finished_at, status")
      .in("phase_id", phaseIds)
      .eq("status", "done")
      .gte("finished_at", weekAgoIso);
    const recentDone = new Map<string, string>();
    for (const r of (recentRuns ?? []) as any[]) {
      const cur = recentDone.get(r.phase_id);
      if (!cur || cur < r.finished_at) recentDone.set(r.phase_id, r.finished_at);
    }

    // 5. Sprints + open tasks per phase
    const { data: sprints } = await sb
      .from("roadmap_sprints")
      .select("id, phase_id")
      .in("phase_id", phaseIds);
    const sprintToPhase = new Map<string, string>();
    for (const s of (sprints ?? []) as any[]) sprintToPhase.set(s.id, s.phase_id);
    const sprintIds = Array.from(sprintToPhase.keys());

    const { data: tasks } = sprintIds.length > 0
      ? await sb.from("roadmap_tasks").select("id, sprint_id, status").in("sprint_id", sprintIds)
      : { data: [] };
    const openTasksByPhase = new Map<string, string[]>();
    for (const t of (tasks ?? []) as any[]) {
      if (TASK_TERMINAL.includes(String(t.status).toLowerCase())) continue;
      const phaseId = sprintToPhase.get(t.sprint_id);
      if (!phaseId) continue;
      if (!openTasksByPhase.has(phaseId)) openTasksByPhase.set(phaseId, []);
      openTasksByPhase.get(phaseId)!.push(t.id);
    }

    // 6. Risk lookup — discussion_actions linked to those tasks
    const allTaskIds = Array.from(openTasksByPhase.values()).flat();
    const { data: actions } = allTaskIds.length > 0
      ? await sb.from("discussion_actions")
          .select("subject_id, risk, night_override_reason, status")
          .eq("subject_type", "task")
          .eq("status", "open")
          .in("subject_id", allTaskIds)
      : { data: [] };
    const taskRisk = new Map<string, { critical: number; highBlocked: number }>();
    for (const a of (actions ?? []) as any[]) {
      const cur = taskRisk.get(a.subject_id) ?? { critical: 0, highBlocked: 0 };
      if (a.risk === "critical") cur.critical += 1;
      else if (a.risk === "high" && !a.night_override_reason) cur.highBlocked += 1;
      taskRisk.set(a.subject_id, cur);
    }

    // 7. Score + emit
    const toUpsert: any[] = [];
    const skipped: any[] = [];

    for (const p of candidates) {
      const blockers: string[] = [];
      const reasons: string[] = [];

      if (!signoffSet.has(p.id)) blockers.push("no signoff");
      if (queuedSet.has(p.id)) blockers.push("already queued for tomorrow");

      const lastDone = recentDone.get(p.id);
      if (lastDone && lastDone > threeDaysAgoIso) blockers.push("ran in last 3 days");

      const openTasks = openTasksByPhase.get(p.id) ?? [];
      let critCount = 0, highBlocked = 0;
      for (const tid of openTasks) {
        const r = taskRisk.get(tid);
        if (!r) continue;
        critCount += r.critical;
        highBlocked += r.highBlocked;
      }
      if (critCount > 0) blockers.push(`${critCount} critical-risk action(s) open`);
      if (highBlocked > 0) blockers.push(`${highBlocked} high-risk action(s) without night override`);

      if (blockers.length > 0) {
        skipped.push({ phase_id: p.id, phase_key: p.key, blockers });
        continue;
      }

      let score = 40;
      reasons.push("phase signed off");
      if (critCount === 0 && highBlocked === 0) {
        score += 20;
        reasons.push("no high-risk open actions");
      }
      if (!lastDone) {
        score += 20;
        reasons.push("never run overnight");
      } else if (lastDone < weekAgoIso) {
        score += 20;
        reasons.push("last run >7 days ago");
      }
      if (openTasks.length >= 3) {
        score += 20;
        reasons.push(`${openTasks.length} open tasks`);
      }

      toUpsert.push({
        scheduled_for: tomorrow,
        phase_id: p.id,
        phase_key: p.key,
        score,
        reasons,
        blockers: [],
        status: "open",
      });
    }

    let written = 0;
    if (toUpsert.length > 0) {
      const { error: upErr, data: upData } = await sb
        .from("overnight_recommendations")
        .upsert(toUpsert, { onConflict: "scheduled_for,phase_id", ignoreDuplicates: false })
        .select("id");
      if (upErr) throw upErr;
      written = upData?.length ?? 0;
    }

    const detail = {
      scanned: phases?.length ?? 0,
      candidates: candidates.length,
      written,
      skipped: skipped.length,
      scheduled_for: tomorrow,
      skipped_detail: skipped.slice(0, 20),
    };
    await sb.from("automation_runs").insert({
      job: JOB, trigger, status: "ok", status_code: 200,
      message: `${JOB} ok — ${written} recs, ${skipped.length} skipped`,
      detail, duration_ms: Date.now() - startedAt,
    });
    return json({ ok: true, ...detail, recommendations: toUpsert });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await sb.from("automation_runs").insert({
      job: JOB, trigger, status: "error", status_code: 500,
      message: msg, detail: { error: msg }, duration_ms: Date.now() - startedAt,
    });
    return json({ error: msg }, 500);
  }
}));
