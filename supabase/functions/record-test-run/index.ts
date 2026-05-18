// Records a test-run summary. Called by GitHub Actions nightly workflow.
// Auth: requires x-service-token header (cron / CI use only).
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { withLogger } from "../_shared/logger.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-service-token",
};

Deno.serve(withLogger("record-test-run", async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  const SERVICE_TOKEN = Deno.env.get("AWIP_SERVICE_TOKEN");
  const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const startedAt = Date.now();
  const recordRun = async (status: string, status_code: number, message: string, detail: Record<string, unknown> = {}) => {
    try {
      await sb.from("automation_runs").insert({
        job: "record-test-run", trigger: "ci", status, status_code,
        duration_ms: Date.now() - startedAt, message, detail,
      });
    } catch (e) { console.error("automation_runs insert failed", e); }
  };

  if (!SERVICE_TOKEN) {
    await recordRun("error", 500, "AWIP_SERVICE_TOKEN secret missing in Lovable Cloud — nightly cron cannot post results.");
    return json({ error: "server_misconfigured" }, 500);
  }
  if (req.headers.get("x-service-token") !== SERVICE_TOKEN) {
    await recordRun("error", 401, "Nightly CI sent wrong/missing AWIP_SERVICE_TOKEN — check the GitHub Actions secret matches Lovable Cloud.");
    return json({ error: "unauthorized" }, 401);
  }

  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") {
    await recordRun("error", 400, "invalid_body");
    return json({ error: "invalid_body" }, 400);
  }

  const allowedStatus = ["passed", "failed", "errored"];
  const suite = String(body.suite ?? "").slice(0, 80);
  const status = String(body.status ?? "");
  if (!suite || !allowedStatus.includes(status)) {
    await recordRun("error", 400, `invalid_fields suite=${suite} status=${status}`);
    return json({ error: "invalid_fields" }, 400);
  }

  const { error } = await sb.from("test_runs").insert({
    suite,
    status,
    total: int(body.total),
    passed: int(body.passed),
    failed: int(body.failed),
    skipped: int(body.skipped),
    duration_ms: int(body.duration_ms),
    commit_sha: body.commit_sha ? String(body.commit_sha).slice(0, 80) : null,
    branch: body.branch ? String(body.branch).slice(0, 120) : null,
    workflow_run_url: body.workflow_run_url ? String(body.workflow_run_url).slice(0, 500) : null,
    detail: typeof body.detail === "object" && body.detail !== null ? body.detail : {},
  });
  if (error) {
    await recordRun("error", 500, `insert failed: ${error.message}`);
    return json({ error: error.message }, 500);
  }
  await recordRun("ok", 200, `${suite} ${status} ${body.passed ?? 0}/${body.total ?? 0}`, { suite, status });

  if (status === "failed" || status === "errored") {
    await dispatchAlert(sb, "record-test-run", "test_fail",
      `${suite}: ${status} (${body.passed ?? 0}/${body.total ?? 0})`,
      { suite, status, passed: body.passed, failed: body.failed, total: body.total, workflow_run_url: body.workflow_run_url });
  }

  return json({ ok: true });
}));

function int(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  const n = typeof v === "number" ? v : parseFloat(String(v));
  if (!Number.isFinite(n)) return null;
  // Postgres integer columns reject floats — round here so CI callers
  // that send fractional ms (e.g. 356.16) don't blow up the insert.
  return Math.round(n);
}
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
    const reqBody = JSON.stringify({
      text: `🚨 ${job} · ${reason}\n${message}`,
      job, reason, message, payload, ts: new Date().toISOString(),
    });
    let delivered = false; let status_code: number | null = null; let error: string | null = null;
    try {
      const r = await fetch(settings.webhook_url, { method: "POST", headers: { "Content-Type": "application/json" }, body: reqBody });
      status_code = r.status; delivered = r.ok;
      if (!r.ok) error = (await r.text()).slice(0, 300);
    } catch (e) { error = e instanceof Error ? e.message : String(e); }
    await sb.from("alert_log").insert({ job, reason, message, delivered, status_code, error, payload });
  } catch (e) { console.error("dispatchAlert failed", e); }
}
