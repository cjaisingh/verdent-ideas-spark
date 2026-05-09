// Cron-driven monitor: scans recent automation_runs for repeated 401
// "unauthorized" errors per job. When a job exceeds the operator-configured
// threshold inside the configured rolling window, dispatchAlert() fires an
// `auth_failed` alert (webhook + alert_log). Built-in dedupe in dispatchAlert
// prevents spam across cron ticks.
//
// Auth: requires x-awip-service-token = AWIP_SERVICE_TOKEN (cron-only).
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { dispatchAlert } from "../_shared/alerts.ts";
import { withLogger } from "../_shared/logger.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-awip-service-token",
};

const JOB = "automation-auth-monitor";

async function recordRun(
  sb: ReturnType<typeof createClient>,
  status: string,
  status_code: number,
  message: string,
  detail: Record<string, unknown>,
  duration_ms: number,
) {
  try {
    await sb.from("automation_runs").insert({
      job: JOB, trigger: "cron", status, status_code, duration_ms, message, detail,
    });
  } catch (e) { console.error("automation_runs insert failed", e); }
}

Deno.serve(withLogger("automation-auth-monitor", async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const started = Date.now();
  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const AWIP_SERVICE_TOKEN = Deno.env.get("AWIP_SERVICE_TOKEN");

  const provided = req.headers.get("x-awip-service-token");
  if (!AWIP_SERVICE_TOKEN || provided !== AWIP_SERVICE_TOKEN) {
    return new Response(JSON.stringify({ error: "unauthorized" }), {
      status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const sb = createClient(SUPABASE_URL, SERVICE_KEY);

  try {
    const { data: settings } = await sb.from("alert_settings")
      .select("alert_on_auth_failed, auth_failed_threshold, auth_failed_window_minutes, enabled")
      .eq("id", true).maybeSingle();

    const threshold = Math.max(1, Number(settings?.auth_failed_threshold ?? 3));
    const windowMin = Math.max(1, Number(settings?.auth_failed_window_minutes ?? 15));
    const since = new Date(Date.now() - windowMin * 60_000).toISOString();

    const { data: rows, error } = await sb.from("automation_runs")
      .select("job, status_code, message, created_at")
      .eq("status_code", 401)
      .gte("created_at", since)
      .neq("job", JOB) // ignore our own self-protection 401s
      .limit(2000);

    if (error) throw error;

    const counts = new Map<string, { n: number; sample: string | null; last: string }>();
    for (const r of rows ?? []) {
      const e = counts.get(r.job) ?? { n: 0, sample: null, last: r.created_at };
      e.n += 1;
      if (!e.sample && r.message) e.sample = String(r.message).slice(0, 200);
      if (r.created_at > e.last) e.last = r.created_at;
      counts.set(r.job, e);
    }

    const triggered: { job: string; count: number }[] = [];
    for (const [job, info] of counts) {
      if (info.n >= threshold) {
        triggered.push({ job, count: info.n });
        await dispatchAlert(sb, job, "auth_failed",
          `${info.n} unauthorized (401) responses in the last ${windowMin}m for ${job}. Likely missing or stale service token.`,
          {
            count_401: info.n,
            window_minutes: windowMin,
            threshold,
            last_seen: info.last,
            sample_message: info.sample,
            fix_url: "/admin#cron-secret-integrity",
          },
        );
      }
    }

    const detail = {
      window_minutes: windowMin,
      threshold,
      jobs_scanned: counts.size,
      jobs_alerted: triggered.length,
      triggered,
    };
    await recordRun(sb, "ok", 200, `scanned ${rows?.length ?? 0} 401s; alerted ${triggered.length} job(s)`, detail, Date.now() - started);
    return new Response(JSON.stringify({ ok: true, ...detail }), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await recordRun(sb, "error", 500, msg, { error: msg }, Date.now() - started);
    return new Response(JSON.stringify({ error: msg }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
}));
