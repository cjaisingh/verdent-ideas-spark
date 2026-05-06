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

  const SERVICE_TOKEN = Deno.env.get("AWIP_SERVICE_TOKEN")!;
  if (req.headers.get("x-service-token") !== SERVICE_TOKEN) {
    return json({ error: "unauthorized" }, 401);
  }

  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") return json({ error: "invalid_body" }, 400);

  const allowedStatus = ["passed", "failed", "errored"];
  const suite = String(body.suite ?? "").slice(0, 80);
  const status = String(body.status ?? "");
  if (!suite || !allowedStatus.includes(status)) return json({ error: "invalid_fields" }, 400);

  const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
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
  if (error) return json({ error: error.message }, 500);
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
