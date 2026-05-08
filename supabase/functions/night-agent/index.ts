// Night Agent — eligible-task audit pipeline.
// /open: pull eligible jobs, run 5-step QA per job, queue proposals with audit summary.
// /close: roll up shift digest from night_observations / night_task_audit.
// Read-only: never writes to discussion_actions or roadmap_tasks.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-service-token",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const SERVICE_TOKEN = Deno.env.get("AWIP_SERVICE_TOKEN");

const MAX_JOBS_PER_SHIFT = 50;
const SEV_RANK: Record<string, number> = { info: 0, low: 1, medium: 2, high: 3 };
const worse = (a: string, b: string) => (SEV_RANK[a] >= SEV_RANK[b] ? a : b);

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

  const provided = req.headers.get("x-service-token");
  const auth = req.headers.get("authorization") ?? "";
  const triggeredByCron = !!SERVICE_TOKEN && provided === SERVICE_TOKEN;
  if (!triggeredByCron && !auth.startsWith("Bearer ")) return json({ error: "unauthorized" }, 401);

  const sb = createClient(SUPABASE_URL, SERVICE_ROLE);

  // Admin-only test mode: dry-run /open that returns gate evaluation
  // without writing a shift, observations, or proposals. Requires an
  // operator session JWT carrying the 'admin' role — never accepts the
  // cron service token (gate verification is a human action).
  const isOpenTest =
    path.startsWith("/open/test") ||
    (path.startsWith("/open") && (url.searchParams.get("test") === "1" || url.searchParams.get("dryRun") === "1"));
  if (isOpenTest) {
    if (triggeredByCron) return json({ error: "test mode requires operator JWT, not service token" }, 403);
    const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
    const userClient = createClient(SUPABASE_URL, ANON_KEY, { global: { headers: { Authorization: auth } } });
    const token = auth.replace(/^Bearer\s+/i, "");
    const { data: claims, error: claimsErr } = await userClient.auth.getClaims(token);
    if (claimsErr || !claims?.claims?.sub) return json({ error: "unauthorized" }, 401);
    const userId = claims.claims.sub as string;
    const { data: isAdmin } = await sb.rpc("has_role", { _user_id: userId, _role: "admin" });
    if (!isAdmin) return json({ error: "forbidden: admin role required" }, 403);

    const { data: settings } = await sb
      .from("memory_settings")
      .select("night_agent_enabled, night_timezone, night_window_start, night_window_end, night_blackout_dates, night_allowed_kinds")
      .eq("id", true).maybeSingle();
    return await evaluateOpenGates(sb, settings ?? null, url, userId);
  }

  const { data: settings } = await sb
    .from("memory_settings")
    .select("night_agent_enabled, night_timezone, night_window_start, night_window_end, night_blackout_dates, night_allowed_kinds")
    .eq("id", true).maybeSingle();
  if (settings && settings.night_agent_enabled === false) {
    return json({ skipped: true, reason: "night_agent_disabled" });
  }

  try {
    if (path.startsWith("/open")) return await openShift(sb, settings ?? null);
    if (path.startsWith("/close")) return await closeShift(sb);
    if (path.startsWith("/smoke")) return await smokeTest(sb, settings ?? null, url);
    return json({ error: "not_found", path }, 404);
  } catch (e) {
    console.error("night-agent", e);
    return json({ error: e instanceof Error ? e.message : "unknown" }, 500);
  }
});

// ─── classifier ───────────────────────────────────────────────────────────

function classifyJob(j: { title: string; details: string | null; priority: string }) {
  const text = `${j.title} ${j.details ?? ""}`.toLowerCase();
  if (/\b(security|auth|payment|delete|drop|migration|prod)\b/.test(text)) {
    return { risk: "high" as const, reason: "keyword match (security/auth/payment/delete/migration/prod)" };
  }
  if (j.priority === "high") return { risk: "high" as const, reason: "priority=high" };
  if (j.priority === "low") return { risk: "low" as const, reason: "priority=low" };
  return { risk: "med" as const, reason: "default" };
}

// Inferred phase + suite hints. Cheap keyword match; falls back to 'general'.
function inferPhaseAndSuite(title: string) {
  const t = title.toLowerCase();
  let phase = "general";
  if (/\b(auth|login|jwt|role)\b/.test(t)) phase = "auth";
  else if (/\b(roadmap|finding|risk)\b/.test(t)) phase = "roadmap";
  else if (/\b(copilot|voice|telegram)\b/.test(t)) phase = "copilot";
  else if (/\b(jobs?|discussion|action)\b/.test(t)) phase = "jobs";
  return { phase, suite: phase };
}

// ─── /open ────────────────────────────────────────────────────────────────

type NightSettings = {
  night_timezone?: string | null;
  night_window_start?: string | null;
  night_window_end?: string | null;
  night_blackout_dates?: unknown;
  night_allowed_kinds?: unknown;
} | null;

// Returns HH:MM and YYYY-MM-DD in the configured zone, falling back to UTC.
function localParts(now: Date, tz: string) {
  try {
    const fmt = new Intl.DateTimeFormat("en-CA", {
      timeZone: tz, hour12: false,
      year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit",
    }).formatToParts(now);
    const get = (k: string) => fmt.find((p) => p.type === k)?.value ?? "";
    return {
      date: `${get("year")}-${get("month")}-${get("day")}`,
      hhmm: `${get("hour")}:${get("minute")}`,
    };
  } catch {
    return {
      date: now.toISOString().slice(0, 10),
      hhmm: now.toISOString().slice(11, 16),
    };
  }
}

function inWindow(hhmm: string, start: string, end: string) {
  if (start === end) return false;
  return start < end ? (hhmm >= start && hhmm < end) : (hhmm >= start || hhmm < end);
}

async function openShift(sb: ReturnType<typeof createClient>, settings: NightSettings) {
  const tz = (settings?.night_timezone as string) || "UTC";
  const winStart = (settings?.night_window_start as string) || "22:00";
  const winEnd = (settings?.night_window_end as string) || "06:00";
  const blackouts = Array.isArray(settings?.night_blackout_dates)
    ? (settings!.night_blackout_dates as unknown[]).map(String)
    : [];
  const allowedKinds = Array.isArray(settings?.night_allowed_kinds)
    ? (settings!.night_allowed_kinds as unknown[]).map(String)
    : ["general", "auth", "roadmap", "copilot", "jobs"];

  const now = new Date();
  const local = localParts(now, tz);

  if (blackouts.includes(local.date)) {
    return json({ skipped: true, reason: "blackout_date", tz, date: local.date });
  }
  if (!inWindow(local.hhmm, winStart, winEnd)) {
    return json({ skipped: true, reason: "outside_window", tz, local: local.hhmm, window: `${winStart}-${winEnd}` });
  }
  if (allowedKinds.length === 0) {
    return json({ skipped: true, reason: "no_allowed_kinds" });
  }

  // Window timestamps recorded against the wall clock; tz remembered in summary.
  const windowStart = new Date(now);
  windowStart.setUTCHours(22, 0, 0, 0);
  if (now.getUTCHours() < 22) windowStart.setUTCDate(windowStart.getUTCDate() - 1);
  const windowEnd = new Date(windowStart);
  windowEnd.setUTCHours(windowEnd.getUTCHours() + 8);

  const { data: shift, error: shiftErr } = await sb.from("night_shifts").insert({
    window_start: windowStart.toISOString(),
    window_end: windowEnd.toISOString(),
    status: "running",
    summary: { tz, window: `${winStart}-${winEnd}`, allowed_kinds: allowedKinds },
  }).select("id").single();
  if (shiftErr || !shift) return json({ error: "shift_create_failed", detail: shiftErr?.message }, 500);
  const shiftId = shift.id as string;

  // Step 0: global QA once per shift
  let globalQa: { ok: boolean; status: number; checked: number | null } = { ok: false, status: 0, checked: null };
  try {
    const r = await fetch(`${SUPABASE_URL}/functions/v1/qa-validate`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-service-token": SERVICE_TOKEN ?? "" },
      body: "{}",
    });
    const body = await r.json().catch(() => ({}));
    globalQa = { ok: r.ok, status: r.status, checked: body?.checked ?? body?.count ?? null };
  } catch (e) {
    await sb.from("night_observations").insert({
      shift_id: shiftId, kind: "error", severity: "high",
      summary: `global qa-validate threw: ${e instanceof Error ? e.message : String(e)}`,
    });
  }

  // Eligible jobs: night_eligible + open + not promoted
  const { data: candidates } = await sb
    .from("discussion_actions")
    .select("id, short_num, title, details, priority, status, promoted_task_id, night_eligible")
    .eq("status", "open")
    .eq("night_eligible", true)
    .is("promoted_task_id", null)
    .limit(MAX_JOBS_PER_SHIFT);

  let auditedCount = 0;
  let proposalsQueued = 0;
  const skipped: Array<{ id: string; reason: string }> = [];

  for (const job of candidates ?? []) {
    const { risk, reason } = classifyJob(job as any);
    if (risk === "high") {
      skipped.push({ id: job.id, reason: `risk=high (${reason})` });
      continue;
    }

    const subjectRef = { discussion_action_id: job.id, short_num: job.short_num };
    const { phase, suite } = inferPhaseAndSuite(job.title);
    if (!allowedKinds.includes(phase)) {
      skipped.push({ id: job.id, reason: `kind '${phase}' not allowed` });
      continue;
    }
    let worst = "info";

    // 1. pulled
    await sb.from("night_observations").insert({
      shift_id: shiftId, kind: "job_review", severity: "info",
      subject_ref: subjectRef,
      summary: `pulled #${job.short_num}: ${job.title}`,
      payload: { risk, reason, phase, suite, eligible: true },
    });

    // 2. global_qa
    {
      const sev = globalQa.ok ? "info" : "high";
      worst = worse(worst, sev);
      await sb.from("night_observations").insert({
        shift_id: shiftId, kind: "qa", severity: sev,
        subject_ref: subjectRef,
        summary: `global_qa ${globalQa.ok ? "pass" : "fail"} (${globalQa.checked ?? "?"} checks)`,
        payload: globalQa,
      });
    }

    // 3. code_review — overlap on area keyword matches in recent findings
    {
      const { data: findings } = await sb
        .from("roadmap_review_findings")
        .select("severity, area, title")
        .order("created_at", { ascending: false })
        .limit(50);
      const matches = (findings ?? []).filter((f: any) => {
        const blob = `${f.area ?? ""} ${f.title ?? ""}`.toLowerCase();
        return blob.includes(phase);
      });
      const sev = matches.reduce((acc: string, f: any) => worse(acc, f.severity ?? "info"), "info");
      worst = worse(worst, sev);
      await sb.from("night_observations").insert({
        shift_id: shiftId, kind: "code_review", severity: sev,
        subject_ref: subjectRef,
        summary: `code_review: ${matches.length} overlapping finding(s) in '${phase}'`,
        payload: { matches: matches.slice(0, 5) },
      });
    }

    // 4. tests — latest test_runs for inferred suite
    {
      const { data: runs } = await sb
        .from("test_runs")
        .select("status, suite, created_at, failed")
        .ilike("suite", `%${suite}%`)
        .order("created_at", { ascending: false })
        .limit(1);
      const latest = runs?.[0];
      const passed = !!latest && (latest.status === "pass" || latest.status === "passed");
      const sev = !latest ? "low" : passed ? "info" : "high";
      worst = worse(worst, sev);
      await sb.from("night_observations").insert({
        shift_id: shiftId, kind: "tests", severity: sev,
        subject_ref: subjectRef,
        summary: latest ? `tests ${latest.status} (suite ~${latest.suite})` : `tests: no recent run for '${suite}'`,
        payload: { latest },
      });
    }

    // 5. qa_checks snapshot for the inferred phase
    {
      const { data: checks } = await sb
        .from("qa_checks")
        .select("status, criterion, phase_key")
        .eq("phase_key", phase);
      const statuses = (checks ?? []).map((c: any) => c.status);
      const failed = statuses.filter((s: string) => s === "fail" || s === "failed").length;
      const unknown = statuses.filter((s: string) => s === "unknown").length;
      const sev = failed > 0 ? "high" : unknown > 0 ? "low" : "info";
      worst = worse(worst, sev);
      await sb.from("night_observations").insert({
        shift_id: shiftId, kind: "qa", severity: sev,
        subject_ref: subjectRef,
        summary: `qa_checks[${phase}]: ${checks?.length ?? 0} checks, ${failed} fail, ${unknown} unknown`,
        payload: { checks: checks ?? [] },
      });
    }

    // 6. audit_complete marker
    const qaPassed = worst === "info" || worst === "low";
    await sb.from("night_observations").insert({
      shift_id: shiftId, kind: "job_review", severity: worst,
      subject_ref: subjectRef,
      summary: `audit_complete: worst=${worst} qa_passed=${qaPassed}`,
      payload: { steps: 5, worst_severity: worst, qa_passed: qaPassed },
    });
    auditedCount++;

    // 7. always-propose, audit attached
    const rationale = `Audit: 5 steps · worst=${worst} · ${qaPassed ? "qa pass" : "qa fail — review before accept"}`;
    await sb.from("night_proposals").insert({
      shift_id: shiftId,
      kind: "promote_job",
      target_ref: subjectRef,
      rationale,
      payload: { worst_severity: worst, qa_passed: qaPassed, phase, suite },
    });
    proposalsQueued++;
  }

  return json({
    shift_id: shiftId,
    candidates: candidates?.length ?? 0,
    audited: auditedCount,
    proposals: proposalsQueued,
    skipped,
    global_qa: globalQa,
  });
}

// ─── /close ───────────────────────────────────────────────────────────────

async function closeShift(sb: ReturnType<typeof createClient>) {
  const { data: shift } = await sb
    .from("night_shifts")
    .select("id")
    .eq("status", "running")
    .order("started_at", { ascending: false })
    .limit(1).maybeSingle();
  if (!shift) return json({ error: "no_running_shift" }, 404);
  const shiftId = shift.id as string;

  const [{ data: obs }, { data: props }, { data: audits }] = await Promise.all([
    sb.from("night_observations").select("kind, severity").eq("shift_id", shiftId),
    sb.from("night_proposals").select("status").eq("shift_id", shiftId),
    sb.from("night_task_audit").select("audit_complete, worst_severity").eq("shift_id", shiftId),
  ]);

  const summary = {
    observations: obs?.length ?? 0,
    by_kind: (obs ?? []).reduce((a: Record<string, number>, o: any) => {
      a[o.kind] = (a[o.kind] ?? 0) + 1; return a;
    }, {}),
    failures: (obs ?? []).filter((o: any) => o.severity === "high").length,
    proposals_pending: (props ?? []).filter((p: any) => p.status === "pending").length,
    proposals_accepted: (props ?? []).filter((p: any) => p.status === "accepted").length,
    proposals_rejected: (props ?? []).filter((p: any) => p.status === "rejected").length,
    audits_complete: (audits ?? []).filter((a: any) => a.audit_complete).length,
    worst_per_task: (audits ?? []).reduce((a: Record<string, number>, x: any) => {
      const k = x.worst_severity ?? "info"; a[k] = (a[k] ?? 0) + 1; return a;
    }, {}),
  };

  await sb.from("night_shifts")
    .update({ status: "completed", ended_at: new Date().toISOString(), summary })
    .eq("id", shiftId);

  return json({ shift_id: shiftId, summary });
}

// ─── /smoke ───────────────────────────────────────────────────────────────
// Exercises schedule gates (window/blackout/allowed-kinds) and writes a
// completed test shift + observation. Marked summary.test=true so it can be
// distinguished from real shifts. Operator JWT is sufficient — no cron token.
async function smokeTest(
  sb: ReturnType<typeof createClient>,
  settings: NightSettings,
  url: URL,
) {
  const tz = (settings?.night_timezone as string) || "UTC";
  const winStart = (settings?.night_window_start as string) || "22:00";
  const winEnd = (settings?.night_window_end as string) || "06:00";
  const blackouts = Array.isArray(settings?.night_blackout_dates)
    ? (settings!.night_blackout_dates as unknown[]).map(String)
    : [];
  const allowedKinds = Array.isArray(settings?.night_allowed_kinds)
    ? (settings!.night_allowed_kinds as unknown[]).map(String)
    : ["general", "auth", "roadmap", "copilot", "jobs"];

  // Optional ?at=ISO override lets the caller test a specific moment.
  const atParam = url.searchParams.get("at");
  const at = atParam ? new Date(atParam) : new Date();
  if (isNaN(at.getTime())) return json({ error: "invalid 'at' timestamp" }, 400);

  const local = localParts(at, tz);
  const gates = {
    timezone: tz,
    window: `${winStart}-${winEnd}`,
    local_date: local.date,
    local_time: local.hhmm,
    enabled: settings?.night_agent_enabled !== false,
    blackout_hit: blackouts.includes(local.date),
    in_window: inWindow(local.hhmm, winStart, winEnd),
    allowed_kinds: allowedKinds,
  };

  const reasons: string[] = [];
  if (!gates.enabled) reasons.push("night_agent_disabled");
  if (gates.blackout_hit) reasons.push("blackout_date");
  if (!gates.in_window) reasons.push("outside_window");
  if (allowedKinds.length === 0) reasons.push("no_allowed_kinds");
  const wouldRun = reasons.length === 0;

  // Count how many candidate jobs the real /open would have considered.
  const { count: candidateCount } = await sb
    .from("discussion_actions")
    .select("id", { count: "exact", head: true })
    .eq("status", "open")
    .eq("night_eligible", true)
    .is("promoted_task_id", null);

  const summary = {
    test: true,
    triggered_at: at.toISOString(),
    gates,
    would_run: wouldRun,
    skip_reasons: reasons,
    candidate_jobs: candidateCount ?? 0,
  };

  const { data: shift, error } = await sb.from("night_shifts").insert({
    window_start: at.toISOString(),
    window_end: at.toISOString(),
    status: "completed",
    started_at: at.toISOString(),
    ended_at: new Date().toISOString(),
    summary,
  }).select("id").single();
  if (error || !shift) return json({ error: "test_shift_create_failed", detail: error?.message }, 500);

  await sb.from("night_observations").insert({
    shift_id: shift.id,
    kind: "job_review",
    severity: wouldRun ? "info" : "low",
    summary: wouldRun
      ? `smoke_test: would run · ${candidateCount ?? 0} candidate jobs`
      : `smoke_test: would skip (${reasons.join(", ")})`,
    payload: summary,
  });

  return json({ shift_id: shift.id, ...summary });
}
