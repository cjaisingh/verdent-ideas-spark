// Weekly QA validation: walks qa_checks, runs probes for mechanical ones,
// leaves judgement-type checks for the operator (status='unknown' until ticked).
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { withLogger } from "../_shared/logger.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-service-token",
};

type Probe = (sb: ReturnType<typeof createClient>) => Promise<{ status: "pass" | "fail" | "unknown"; note: string }>;

// Probes are pure SQL counts so we never need to evaluate user input.
const PROBES: Record<string, Probe> = {
  // Phase 1: every API call logged
  "api_calls_logged_recent": async (sb) => {
    const since = new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString();
    const { count } = await sb.from("api_call_logs").select("id", { count: "exact", head: true }).gte("created_at", since);
    return { status: (count ?? 0) > 0 ? "pass" : "unknown", note: `${count ?? 0} API call logs in the last 7 days` };
  },
  // Phase 2: AI sessions leave a trail.
  // Passes if EITHER roadmap_work_log (per-task turn log) OR session_summaries
  // (end-of-session recap from session-summary-log) has activity in the last 7d.
  // session_summaries became the de-facto session trail after the session-lifecycle
  // contract landed; keeping roadmap_work_log in the OR so per-task logging still counts.
  "work_log_recent": async (sb) => {
    const since = new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString();
    const [wl, ss] = await Promise.all([
      sb.from("roadmap_work_log").select("id", { count: "exact", head: true }).gte("created_at", since),
      sb.from("session_summaries").select("id", { count: "exact", head: true }).gte("created_at", since),
    ]);
    const wlCount = wl.count ?? 0;
    const ssCount = ss.count ?? 0;
    const total = wlCount + ssCount;
    return {
      status: total > 0 ? "pass" : "fail",
      note: `${total} session trail entries in the last 7 days (work_log=${wlCount}, session_summaries=${ssCount})`,
    };
  },
  // Phase 2: every phase has a summary visible
  "all_phases_have_summary": async (sb) => {
    const { data } = await sb.from("roadmap_phases").select("key, summary");
    const missing = (data ?? []).filter((p: any) => !p.summary).map((p: any) => p.key);
    return missing.length
      ? { status: "fail", note: `phases missing summary: ${missing.join(", ")}` }
      : { status: "pass", note: "all phases have a summary" };
  },
};

Deno.serve(withLogger("qa-validate", async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const SERVICE_TOKEN = Deno.env.get("AWIP_SERVICE_TOKEN");
  const provided = req.headers.get("x-service-token");
  const auth = req.headers.get("authorization") ?? "";
  const triggeredByCron = !!SERVICE_TOKEN && provided === SERVICE_TOKEN;
  const trigger = triggeredByCron ? "cron" : "manual";
  const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const startedAt = Date.now();
  const recordRun = async (status: string, status_code: number, message: string, detail: Record<string, unknown> = {}) => {
    try {
      await sb.from("automation_runs").insert({
        job: "qa-validate", trigger, status, status_code,
        duration_ms: Date.now() - startedAt, message, detail,
      });
    } catch (e) { console.error("automation_runs insert failed", e); }
  };

  if (!triggeredByCron && !auth.startsWith("Bearer ")) {
    await recordRun("error", 401, !SERVICE_TOKEN
      ? "AWIP_SERVICE_TOKEN secret is missing in Lovable Cloud — cron cannot authenticate."
      : "Missing service token and no Authorization header.");
    return json({ error: "unauthorized" }, 401);
  }

  const { data: checks, error } = await sb.from("qa_checks").select("id, kind, probe");
  if (error) {
    await recordRun("error", 500, `qa_checks query failed: ${error.message}`);
    return json({ error: error.message }, 500);
  }

  let updated = 0;
  const failures: string[] = [];
  for (const c of checks ?? []) {
    if (c.kind !== "probe" || !c.probe) continue;
    const probe = PROBES[c.probe];
    if (!probe) continue;
    try {
      const r = await probe(sb);
      await sb.from("qa_checks").update({
        status: r.status, note: r.note, last_checked_at: new Date().toISOString(),
      }).eq("id", c.id);
      updated++;
    } catch (e) {
      console.error("probe error", c.probe, e);
      failures.push(`${c.probe}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  const totalChecks = (checks ?? []).length;

  // Count probes that ended in fail status to alert.
  const { data: probeFails } = await sb.from("qa_checks")
    .select("criterion, phase_key, note").eq("kind", "probe").eq("status", "fail");
  const failedProbes = probeFails ?? [];

  await recordRun(failures.length ? "partial" : "ok", failures.length ? 207 : 200,
    `${updated} probes updated${failures.length ? ` · ${failures.length} failed` : ""}`,
    { probes_run: updated, total_checks: totalChecks, failures });

  if (failures.length > 0) {
    await dispatchAlert(sb, "qa-validate", "qa_fail",
      `${failures.length} probe execution error(s) during QA run`,
      { errors: failures.slice(0, 10) });
  } else if (failedProbes.length > 0) {
    await dispatchAlert(sb, "qa-validate", "qa_fail",
      `${failedProbes.length} QA probe(s) currently failing`,
      { failing: failedProbes.slice(0, 10) });
  }

  return json({ ok: true, probes_run: updated, checked: updated, count: updated });
}));

function json(p: unknown, s = 200) {
  return new Response(JSON.stringify(p), { status: s, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

async function dispatchAlert(
  sb: ReturnType<typeof createClient>,
  job: string, reason: string, message: string, payload: Record<string, unknown> = {},
) {
  try {
    const { data: settings } = await sb.from("alert_settings").select("*").eq("id", true).maybeSingle();
    if (!settings || !settings.enabled || !settings.webhook_url) return;
    const flagMap: Record<string, string> = {
      review_error: "alert_on_review_error", high_finding: "alert_on_high_finding",
      test_fail: "alert_on_test_fail", qa_fail: "alert_on_qa_fail",
    };
    const flag = flagMap[reason];
    if (flag && (settings as any)[flag] === false) return;
    const dedupeMin = Math.max(0, Number(settings.dedupe_minutes ?? 0));
    if (dedupeMin > 0) {
      const since = new Date(Date.now() - dedupeMin * 60_000).toISOString();
      const { data: recent } = await sb.from("alert_log")
        .select("id").eq("job", job).eq("reason", reason).eq("delivered", true)
        .gte("created_at", since).limit(1);
      if (recent && recent.length > 0) return;
    }
    const body = JSON.stringify({
      text: `🚨 ${job} · ${reason}\n${message}`,
      job, reason, message, payload, ts: new Date().toISOString(),
    });
    let delivered = false; let status_code: number | null = null; let error: string | null = null;
    try {
      const r = await fetch(settings.webhook_url, { method: "POST", headers: { "Content-Type": "application/json" }, body });
      status_code = r.status; delivered = r.ok;
      if (!r.ok) error = (await r.text()).slice(0, 300);
    } catch (e) { error = e instanceof Error ? e.message : String(e); }
    await sb.from("alert_log").insert({ job, reason, message, delivered, status_code, error, payload });
  } catch (e) { console.error("dispatchAlert failed", e); }
}
