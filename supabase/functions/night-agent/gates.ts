// Admin-only test-mode handler — read-only gate evaluation for /open?test=1.
import { json, MAX_JOBS_PER_SHIFT, type NightSettings, type SbClient } from "./config.ts";
import { localParts, inWindow } from "./time.ts";
import { classifyJob, inferPhaseAndSuite } from "./classify.ts";
import { parseOpenTestFilters, applyDerivedFilters, type ClassifiedJob } from "./filters.ts";

export async function evaluateOpenGates(
  sb: SbClient,
  settings: NightSettings,
  url: URL,
  actorId: string,
  actorEmail?: string,
  req?: Request,
) {
  const tz = (settings?.night_timezone as string) || "UTC";
  const winStart = (settings?.night_window_start as string) || "22:00";
  const winEnd = (settings?.night_window_end as string) || "06:00";
  const blackouts = Array.isArray(settings?.night_blackout_dates)
    ? (settings!.night_blackout_dates as unknown[]).map(String) : [];
  const allowedKinds = Array.isArray(settings?.night_allowed_kinds)
    ? (settings!.night_allowed_kinds as unknown[]).map(String)
    : ["general", "auth", "roadmap", "copilot", "jobs"];

  const atParam = url.searchParams.get("at");
  const at = atParam ? new Date(atParam) : new Date();
  if (isNaN(at.getTime())) return json({ error: "invalid 'at' timestamp" }, 400);

  const local = localParts(at, tz);
  const enabled = settings?.night_agent_enabled !== false;
  const inWin = inWindow(local.hhmm, winStart, winEnd);
  const blackoutHit = blackouts.includes(local.date);

  const skipReasons: string[] = [];
  if (!enabled) skipReasons.push("night_agent_disabled");
  if (blackoutHit) skipReasons.push("blackout_date");
  if (!inWin) skipReasons.push("outside_window");
  if (allowedKinds.length === 0) skipReasons.push("no_allowed_kinds");
  const wouldOpenShift = skipReasons.length === 0;

  const f = parseOpenTestFilters(url);

  let dbq = sb
    .from("discussion_actions")
    .select("id, short_num, title, details, priority")
    .eq("status", "open")
    .eq("night_eligible", true)
    .is("promoted_task_id", null);
  if (f.titleQuery) dbq = dbq.ilike("title", `%${f.titleQuery}%`);
  if (f.shortNums.size > 0) dbq = dbq.in("short_num", Array.from(f.shortNums));
  // Pull a generous slice, then apply phase/risk/verdict in-memory (those
  // are derived fields not present in the table).
  const { data: candidates } = await dbq.limit(MAX_JOBS_PER_SHIFT);

  const classified: ClassifiedJob[] = (candidates ?? []).map((j: any) => {
    const cls = classifyJob(j);
    const { phase, suite } = inferPhaseAndSuite(j.title);
    const reasons: string[] = [];
    if (cls.risk === "high") reasons.push(`risk=high (${cls.reason})`);
    if (!allowedKinds.includes(phase)) reasons.push(`kind '${phase}' not allowed`);
    return {
      id: j.id, short_num: j.short_num, title: j.title,
      risk: cls.risk, phase, suite,
      would_audit: reasons.length === 0,
      skip_reasons: reasons,
    };
  });

  const filtered = applyDerivedFilters(classified, f);
  const jobPreview = filtered.slice(0, f.limit);

  const result = {
    test_mode: true,
    actor_id: actorId,
    triggered_at: at.toISOString(),
    gates: {
      timezone: tz, window: `${winStart}-${winEnd}`,
      local_date: local.date, local_time: local.hhmm,
      enabled, in_window: inWin, blackout_hit: blackoutHit,
      allowed_kinds: allowedKinds, blackout_dates: blackouts,
    },
    would_open_shift: wouldOpenShift,
    skip_reasons: skipReasons,
    filters_applied: f.filtersApplied,
    candidates_total: classified.length,
    candidates_after_filter: filtered.length,
    candidates_returned: jobPreview.length,
    would_audit: jobPreview.filter((j) => j.would_audit).length,
    would_skip: jobPreview.filter((j) => !j.would_audit).length,
    jobs: jobPreview,
    note: "read-only · no shift, observation, or proposal was written",
  };

  // Audit trail: record every admin gate-verification call (service-role
  // insert bypasses the operator-only RLS policy on memory_audit_log).
  const userAgent = req?.headers.get("user-agent") ?? null;
  const { error: auditErr } = await sb.from("memory_audit_log").insert({
    scope: "night_agent_test",
    entry_key: at.toISOString(),
    action: wouldOpenShift ? "verified_would_run" : "verified_would_skip",
    actor: actorEmail ?? actorId,
    new_value: {
      actor_id: actorId,
      actor_email: actorEmail ?? null,
      at_override: url.searchParams.get("at"),
      gates: result.gates,
      would_open_shift: wouldOpenShift,
      skip_reasons: skipReasons,
      candidates_total: result.candidates_total,
      candidates_after_filter: result.candidates_after_filter,
      candidates_returned: result.candidates_returned,
      would_audit: result.would_audit,
      would_skip: result.would_skip,
      filters_applied: f.filtersApplied,
      user_agent: userAgent,
    },
    note: `admin gate verification via /night-agent/open?test=1`,
  });
  if (auditErr) console.error("night-agent test audit insert failed", auditErr);

  return json(result);
}
