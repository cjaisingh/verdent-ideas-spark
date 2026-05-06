// Records a test-run summary. Called by GitHub Actions nightly workflow.
// Auth: requires x-service-token header (cron / CI use only).
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-service-token",
};

Deno.serve(async (req) => {
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
  return json({ ok: true });
});

function int(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  const n = typeof v === "number" ? v : parseInt(String(v), 10);
  return Number.isFinite(n) ? n : null;
}
function json(p: unknown, s = 200) {
  return new Response(JSON.stringify(p), { status: s, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}
