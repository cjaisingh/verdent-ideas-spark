// /open — pull eligible jobs, run the 5-step QA per job, queue proposals.
import {
  json, MAX_JOBS_PER_SHIFT, SUPABASE_URL, SERVICE_TOKEN,
  type NightSettings, type SbClient,
} from "./config.ts";
import { localParts, inWindow } from "./time.ts";
import { classifyJob, inferPhaseAndSuite, worse } from "./classify.ts";

export async function openShift(sb: SbClient, settings: NightSettings) {
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
  const enabled = settings?.night_agent_enabled !== false;
  const inWin = inWindow(local.hhmm, winStart, winEnd);
  const blackoutHit = blackouts.includes(local.date);

  // Gate snapshot — persisted on the shift row so the promotion audit
  // report can show the exact pre-conditions of every promotion.
  const gatesSnapshot = {
    timezone: tz,
    window: `${winStart}-${winEnd}`,
    local_date: local.date,
    local_time: local.hhmm,
    enabled,
    in_window: inWin,
    blackout_hit: blackoutHit,
    allowed_kinds: allowedKinds,
    blackout_dates: blackouts,
  };

  if (!enabled) {
    return json({ skipped: true, reason: "night_agent_disabled", gates: gatesSnapshot });
  }
  if (blackoutHit) {
    return json({ skipped: true, reason: "blackout_date", tz, date: local.date, gates: gatesSnapshot });
  }
  if (!inWin) {
    return json({ skipped: true, reason: "outside_window", tz, local: local.hhmm, window: `${winStart}-${winEnd}`, gates: gatesSnapshot });
  }
  if (allowedKinds.length === 0) {
    return json({ skipped: true, reason: "no_allowed_kinds", gates: gatesSnapshot });
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
    summary: {
      tz,
      window: `${winStart}-${winEnd}`,
      allowed_kinds: allowedKinds,
      gates: gatesSnapshot,
      skip_reasons: [],
    },
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
  const candidatesSelected: Array<{ short_num: number | null; title: string; risk: string; phase: string; suite: string }> = [];
  const candidatesSkipped: Array<{ short_num: number | null; title: string; reason: string; risk?: string; phase?: string }> = [];
  const openedAt = new Date().toISOString();

  for (const job of candidates ?? []) {
    const { risk, reason } = classifyJob(job as any);
    if (risk === "high") {
      const reasonStr = `risk=high (${reason})`;
      skipped.push({ id: job.id, reason: reasonStr });
      candidatesSkipped.push({ short_num: job.short_num, title: job.title, reason: reasonStr, risk });
      continue;
    }

    const subjectRef = { discussion_action_id: job.id, short_num: job.short_num };
    const { phase, suite } = inferPhaseAndSuite(job.title);
    if (!allowedKinds.includes(phase)) {
      const reasonStr = `kind '${phase}' not allowed`;
      skipped.push({ id: job.id, reason: reasonStr });
      candidatesSkipped.push({ short_num: job.short_num, title: job.title, reason: reasonStr, risk, phase });
      continue;
    }
    candidatesSelected.push({ short_num: job.short_num, title: job.title, risk, phase, suite });
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
