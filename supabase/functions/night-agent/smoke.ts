// /smoke — exercises schedule gates and writes a marked test shift + observation.
// Operator JWT is sufficient — no cron token.
import { json, type NightSettings, type SbClient } from "./config.ts";
import { localParts, inWindow } from "./time.ts";

export async function smokeTest(sb: SbClient, settings: NightSettings, url: URL) {
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
