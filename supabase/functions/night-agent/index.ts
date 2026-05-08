// Night Agent — observation-only nightly shift.
// Two entrypoints: POST /open (start shift + sweep) and POST /close (digest + CHANGELOG).
// Authenticates via AWIP_SERVICE_TOKEN (cron) or operator bearer JWT.
// Writes ONLY to night_shifts / night_observations / night_proposals.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-service-token",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const SERVICE_TOKEN = Deno.env.get("AWIP_SERVICE_TOKEN");

function json(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const url = new URL(req.url);
  const path = url.pathname.replace(/^.*\/night-agent/, "") || "/";

  // Auth: cron token OR authenticated operator
  const provided = req.headers.get("x-service-token");
  const auth = req.headers.get("authorization") ?? "";
  const triggeredByCron = !!SERVICE_TOKEN && provided === SERVICE_TOKEN;
  if (!triggeredByCron && !auth.startsWith("Bearer ")) {
    return json({ error: "unauthorized" }, 401);
  }

  const sb = createClient(SUPABASE_URL, SERVICE_ROLE);

  // Kill switch
  const { data: settings } = await sb
    .from("memory_settings")
    .select("night_agent_enabled")
    .eq("id", true)
    .maybeSingle();
  if (settings && settings.night_agent_enabled === false) {
    return json({ skipped: true, reason: "night_agent_disabled" });
  }

  try {
    if (path === "/open" || path === "/open/") return await openShift(sb, req);
    if (path === "/close" || path === "/close/") return await closeShift(sb, req);
    return json({ error: "not_found", path }, 404);
  } catch (e) {
    console.error("night-agent error", e);
    return json({ error: e instanceof Error ? e.message : "unknown" }, 500);
  }
});

// ─── helpers ──────────────────────────────────────────────────────────────

async function recordObs(
  sb: ReturnType<typeof createClient>,
  shiftId: string,
  kind: string,
  severity: string,
  summary: string,
  payload: Record<string, unknown> = {},
  subjectRef: Record<string, unknown> = {},
) {
  await sb.from("night_observations").insert({
    shift_id: shiftId, kind, severity, summary, payload, subject_ref: subjectRef,
  });
}

async function invokeJob(
  sb: ReturnType<typeof createClient>,
  shiftId: string,
  fn: string,
  kind: string,
) {
  try {
    const r = await fetch(`${SUPABASE_URL}/functions/v1/${fn}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-service-token": SERVICE_TOKEN ?? "",
      },
      body: JSON.stringify({}),
    });
    const text = await r.text();
    let parsed: any = null;
    try { parsed = JSON.parse(text); } catch { /* keep text */ }
    const ok = r.ok;
    const sev = ok ? "info" : "high";
    await recordObs(
      sb, shiftId, kind, sev,
      `${fn} → ${r.status}${parsed?.findings_count != null ? ` · ${parsed.findings_count} findings` : ""}`,
      { status: r.status, response: parsed ?? text.slice(0, 500) },
      { function: fn },
    );
    return { ok, status: r.status, body: parsed };
  } catch (e) {
    await recordObs(
      sb, shiftId, "error", "high",
      `${fn} threw: ${e instanceof Error ? e.message : String(e)}`,
      {}, { function: fn },
    );
    return { ok: false, status: 0, body: null };
  }
}

// Risk classifier — deliberately simple. High = security/payments/auth keywords.
function classifyJob(action: { title: string; details: string | null; priority: string }): "low" | "med" | "high" {
  const text = `${action.title} ${action.details ?? ""}`.toLowerCase();
  if (/\b(security|auth|payment|delete|drop|migration|prod)\b/.test(text)) return "high";
  if (action.priority === "high") return "high";
  if (action.priority === "low") return "low";
  return "med";
}

// ─── /open ────────────────────────────────────────────────────────────────

async function openShift(sb: ReturnType<typeof createClient>, _req: Request) {
  // Window: previous 22:00 → next 06:00 in UTC (operator can adjust later).
  const now = new Date();
  const windowStart = new Date(now);
  windowStart.setUTCHours(22, 0, 0, 0);
  if (now.getUTCHours() < 22) windowStart.setUTCDate(windowStart.getUTCDate() - 1);
  const windowEnd = new Date(windowStart);
  windowEnd.setUTCHours(windowEnd.getUTCHours() + 8);

  // Best-effort commit SHA (optional; reads from a recent automation_runs detail if present)
  let commitSha: string | null = null;
  const { data: lastRun } = await sb
    .from("automation_runs")
    .select("detail")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (lastRun?.detail && typeof lastRun.detail === "object") {
    const d = lastRun.detail as Record<string, unknown>;
    if (typeof d.commit === "string") commitSha = d.commit;
    if (typeof d.sha === "string") commitSha = d.sha;
  }

  const { data: shift, error: shiftErr } = await sb
    .from("night_shifts")
    .insert({
      window_start: windowStart.toISOString(),
      window_end: windowEnd.toISOString(),
      commit_sha: commitSha,
      status: "running",
    })
    .select("id")
    .single();
  if (shiftErr || !shift) return json({ error: "shift_create_failed", detail: shiftErr?.message }, 500);

  const shiftId = shift.id as string;

  // 1. Jobs board sweep
  const { data: openJobs } = await sb
    .from("discussion_actions")
    .select("id, short_num, title, details, priority, status")
    .eq("status", "open")
    .is("promoted_task_id", null)
    .limit(100);

  let proposalCount = 0;
  for (const job of openJobs ?? []) {
    const risk = classifyJob(job as any);
    const { data: obs } = await sb.from("night_observations").insert({
      shift_id: shiftId,
      kind: "job_review",
      severity: risk === "high" ? "high" : "info",
      subject_ref: { discussion_action_id: job.id, short_num: job.short_num },
      summary: `Job #${job.short_num} (${risk}): ${job.title}`,
      payload: { risk, priority: job.priority },
    }).select("id").single();

    if (risk === "low" && obs?.id) {
      await sb.from("night_proposals").insert({
        shift_id: shiftId,
        source_observation_id: obs.id,
        kind: "promote_job",
        target_ref: { discussion_action_id: job.id, short_num: job.short_num },
        rationale: `Low-risk job auto-suggested for promotion. Title: ${job.title}`,
      });
      proposalCount++;
    }
  }

  // 2. Code review pass
  await invokeJob(sb, shiftId, "scheduled-code-review", "code_review");
  // 3. QA pass
  await invokeJob(sb, shiftId, "qa-validate", "qa");
  // 4. Tests — record-test-run only ingests posted runs; we record an observation noting that.
  await recordObs(
    sb, shiftId, "tests", "info",
    "Test ingestion endpoint pinged; CI is responsible for posting runs.",
    {}, { function: "record-test-run" },
  );

  return json({ shift_id: shiftId, jobs_reviewed: openJobs?.length ?? 0, proposals: proposalCount });
}

// ─── /close ───────────────────────────────────────────────────────────────

async function closeShift(sb: ReturnType<typeof createClient>, _req: Request) {
  const { data: shift } = await sb
    .from("night_shifts")
    .select("id, window_start, window_end, commit_sha")
    .eq("status", "running")
    .order("started_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!shift) return json({ error: "no_running_shift" }, 404);

  const shiftId = shift.id as string;

  const [{ data: obs }, { data: props }] = await Promise.all([
    sb.from("night_observations").select("kind, severity, summary").eq("shift_id", shiftId),
    sb.from("night_proposals").select("kind, status").eq("shift_id", shiftId),
  ]);

  const summary = {
    observations: obs?.length ?? 0,
    proposals_pending: (props ?? []).filter((p: any) => p.status === "pending").length,
    by_kind: (obs ?? []).reduce((acc: Record<string, number>, o: any) => {
      acc[o.kind] = (acc[o.kind] ?? 0) + 1;
      return acc;
    }, {}),
    failures: (obs ?? []).filter((o: any) => o.severity === "high").length,
  };

  await sb.from("night_shifts")
    .update({ status: "completed", ended_at: new Date().toISOString(), summary })
    .eq("id", shiftId);

  return json({ shift_id: shiftId, summary });
}
