// Pure check helpers for the Sentinel Agent.
// Each helper takes plain rows (fetched by index.ts) and returns a list of
// `FindingCandidate` objects ready to upsert into public.sentinel_findings.

export type FindingCandidate = {
  kind:
    | "cron_silence"
    | "five_xx_spike"
    | "secret_age"
    | "role_grant"
    | "job_error_rate"
    | "frontend_realtime_error"
    | "edge_function_error_rate"
    | "client_transport_error"
    | "voice_pipeline_red"
    | "night_jobs_stalled"
    | "allowlist_rejects"
    | "whats_new_drafts_stale";
  severity: "info" | "low" | "medium" | "high" | "critical";
  summary: string;
  dedupe_key: string;
  subject_ref: Record<string, unknown>;
  payload: Record<string, unknown>;
};

export type AutomationRunRow = { id?: string; job: string; created_at: string; status?: string | null };
export type EdgeLogRow = { status: number | null; created_at: string; function_name: string };
export type SecretRow = { key: string; updated_at: string };
export type RoleAuditRow = { id: string; role: string; action: string; target_user_id: string; created_at: string };

const FIVE_XX_THRESHOLD = 5; // ≥5 5xx in window → high

export function checkCronSilence(
  now: Date,
  cadenceMin: Record<string, number>,
  runs: AutomationRunRow[],
): FindingCandidate[] {
  const out: FindingCandidate[] = [];
  for (const [job, cadence] of Object.entries(cadenceMin)) {
    const latest = runs
      .filter((r) => r.job === job)
      .sort((a, b) => +new Date(b.created_at) - +new Date(a.created_at))[0];
    const silentMs = latest ? now.getTime() - +new Date(latest.created_at) : Infinity;
    const thresholdMs = cadence * 2 * 60_000;
    if (silentMs > thresholdMs) {
      const sev: FindingCandidate["severity"] =
        cadence <= 60 ? "high" : cadence <= 24 * 60 ? "medium" : "low";
      out.push({
        kind: "cron_silence",
        severity: sev,
        summary: `Cron ${job} has not run in ${
          isFinite(silentMs) ? Math.round(silentMs / 60_000) + "m" : "ever"
        } (cadence ${cadence}m).`,
        dedupe_key: `cron_silence:${job}`,
        subject_ref: { job },
        payload: { cadence_minutes: cadence, last_run_at: latest?.created_at ?? null },
      });
    }
  }
  return out;
}

export function checkFiveXxSpike(
  now: Date,
  windowMin: number,
  logs: EdgeLogRow[],
): FindingCandidate[] {
  const sinceMs = now.getTime() - windowMin * 60_000;
  const errs = logs.filter((l) => (l.status ?? 0) >= 500 && +new Date(l.created_at) >= sinceMs);
  if (errs.length < FIVE_XX_THRESHOLD) return [];
  const byFn = errs.reduce<Record<string, number>>((acc, l) => {
    acc[l.function_name] = (acc[l.function_name] ?? 0) + 1;
    return acc;
  }, {});
  const top = Object.entries(byFn).sort((a, b) => b[1] - a[1])[0];
  return [{
    kind: "five_xx_spike",
    severity: errs.length >= 20 ? "critical" : "high",
    summary: `${errs.length} 5xx responses in last ${windowMin}m (top: ${top[0]} ×${top[1]}).`,
    // Bucket dedupe by 15-min window so a spike re-flags rather than silently piling on a stale finding.
    dedupe_key: `five_xx_spike:${Math.floor(now.getTime() / (15 * 60_000))}`,
    subject_ref: { window_minutes: windowMin },
    payload: { count: errs.length, by_function: byFn },
  }];
}

export function checkSecretAge(now: Date, secrets: SecretRow[], maxDays = 90): FindingCandidate[] {
  const cutoff = now.getTime() - maxDays * 24 * 3600 * 1000;
  return secrets
    .filter((s) => +new Date(s.updated_at) < cutoff)
    .map((s) => ({
      kind: "secret_age" as const,
      severity: "low" as const,
      summary: `Secret ${s.key} has not rotated in ${
        Math.round((now.getTime() - +new Date(s.updated_at)) / (24 * 3600 * 1000))
      } days.`,
      dedupe_key: `secret_age:${s.key}`,
      subject_ref: { key: s.key },
      payload: { last_rotated_at: s.updated_at, max_days: maxDays },
    }));
}

export function checkAdminGrants(now: Date, windowMin: number, audit: RoleAuditRow[]): FindingCandidate[] {
  const sinceMs = now.getTime() - windowMin * 60_000;
  return audit
    .filter((r) =>
      +new Date(r.created_at) >= sinceMs && r.action === "granted" && r.role === "admin"
    )
    .map((r) => ({
      kind: "role_grant" as const,
      severity: "high" as const,
      summary: `Admin role granted to user ${r.target_user_id.slice(0, 8)} at ${r.created_at}.`,
      dedupe_key: `role_grant:${r.id}`,
      subject_ref: { audit_id: r.id, target_user_id: r.target_user_id },
      payload: { role: r.role, action: r.action },
    }));
}

/**
 * Job error-rate watcher — fires when one of the W2/W3/W4 jobs trips a
 * rolling error threshold. Buckets dedupe by hour so a sustained outage
 * re-flags once per hour rather than silently piling on a stale finding.
 *
 * Thresholds (per job):
 *   - >= 2 errors in last 60 minutes        → medium
 *   - >= 5 errors in last 24 hours          → high
 *   - >= 1 error AND no successes in 24h    → high
 */
export const ERROR_RATE_JOBS = ["morning-review", "sentinel-tick", "lessons-synthesize"] as const;

export function checkJobErrorRate(
  now: Date,
  runs: AutomationRunRow[],
): FindingCandidate[] {
  const out: FindingCandidate[] = [];
  const since1h = now.getTime() - 60 * 60_000;
  const since24h = now.getTime() - 24 * 3600 * 1000;
  const hourBucket = Math.floor(now.getTime() / (60 * 60_000));
  for (const job of ERROR_RATE_JOBS) {
    const jobRuns = runs.filter((r) => r.job === job);
    const last24 = jobRuns.filter((r) => +new Date(r.created_at) >= since24h);
    if (last24.length === 0) continue;
    const err24 = last24.filter((r) => r.status === "error");
    const ok24 = last24.filter((r) => r.status === "ok");
    const err1h = err24.filter((r) => +new Date(r.created_at) >= since1h);

    let sev: FindingCandidate["severity"] | null = null;
    let reason = "";
    if (err24.length >= 1 && ok24.length === 0) {
      sev = "high"; reason = `${err24.length} error(s) and 0 successes in last 24h`;
    } else if (err24.length >= 5) {
      sev = "high"; reason = `${err24.length} errors in last 24h`;
    } else if (err1h.length >= 2) {
      sev = "medium"; reason = `${err1h.length} errors in last hour`;
    }
    if (!sev) continue;

    const rate24 = last24.length ? err24.length / last24.length : 0;
    // Capture the specific automation_runs ids that triggered this finding so the
    // UI can cross-link from the finding back to the runs that caused it.
    const errSorted = [...err24].sort(
      (a, b) => +new Date(b.created_at) - +new Date(a.created_at),
    );
    const errIds24 = errSorted.map((r) => r.id).filter((x): x is string => !!x).slice(0, 25);
    const errIds1h = errSorted
      .filter((r) => +new Date(r.created_at) >= since1h)
      .map((r) => r.id).filter((x): x is string => !!x).slice(0, 25);
    out.push({
      kind: "job_error_rate",
      severity: sev,
      summary: `${job}: ${reason} (rate ${(rate24 * 100).toFixed(0)}%).`,
      dedupe_key: `job_error_rate:${job}:${hourBucket}`,
      subject_ref: {
        job,
        run_ids: errIds24,
        latest_error_run_id: errIds24[0] ?? null,
      },
      payload: {
        runs_24h: last24.length, errors_24h: err24.length,
        successes_24h: ok24.length, errors_1h: err1h.length,
        error_rate_24h: rate24,
        error_run_ids_24h: errIds24,
        error_run_ids_1h: errIds1h,
      },
    });
  }
  return out;
}

// Cadences (minutes) MUST match the real pg_cron schedule, not the
// edge-function name. Job names here are the strings written to
// `automation_runs.job` by each function.
//   weekly-qa-validate     → Fri 16:00 UTC, function logs as "qa-validate"
//   scheduled-lessons-weekly → Sun 05:00 UTC, function logs as "lessons-synthesize"
export const SENTINEL_CADENCES: Record<string, number> = {
  "qa-validate": 7 * 24 * 60,         // weekly (Fri 16:00 UTC)
  "overnight-phase-runner-15m": 15,
  "morning-review": 24 * 60,
  "sentinel-tick": 15,
  "lessons-synthesize": 7 * 24 * 60,  // weekly (Sun 05:00 UTC)
};

// Pattern matchers for realtime / channel-lifecycle bugs we've actually hit.
// Keep narrow — we want to flag class-of-bug regressions, not every JS error.
const REALTIME_ERROR_PATTERNS: RegExp[] = [
  /cannot add `?postgres_changes`? callbacks/i,
  /tried to subscribe multiple times/i,
  /CHANNEL_ERROR/,
  /channel.*already (subscribed|joined)/i,
];

export type FrontendErrorRow = {
  message: string;
  url: string | null;
  created_at: string;
  kind?: string | null;
};

export function checkFrontendRealtimeErrors(
  now: Date,
  windowMin: number,
  rows: FrontendErrorRow[],
): FindingCandidate[] {
  const sinceMs = now.getTime() - windowMin * 60_000;
  const matches = rows.filter((r) => {
    if (+new Date(r.created_at) < sinceMs) return false;
    return REALTIME_ERROR_PATTERNS.some((p) => p.test(r.message ?? ""));
  });
  if (matches.length === 0) return [];
  const bucket = Math.floor(now.getTime() / (windowMin * 60_000));
  const sample = matches[0].message.slice(0, 160);
  const sev: FindingCandidate["severity"] = matches.length >= 5 ? "high" : "medium";
  return [{
    kind: "frontend_realtime_error",
    severity: sev,
    summary: `${matches.length} realtime/channel error(s) in browser in last ${windowMin}m: ${sample}`,
    dedupe_key: `frontend_realtime_error:${bucket}`,
    subject_ref: { sample_url: matches[0].url ?? null },
    payload: {
      window_minutes: windowMin,
      count: matches.length,
      sample_message: sample,
      sample_url: matches[0].url ?? null,
    },
  }];
}

/**
 * Edge function error-rate watcher (per-function, rate-based).
 * Fires per function when:
 *   - >= 3 5xx in window AND error_rate >= 20%   → high
 *   - >= 10 5xx in window                        → critical
 */
export function checkEdgeFunctionErrorRate(
  now: Date,
  windowMin: number,
  logs: EdgeLogRow[],
): FindingCandidate[] {
  const sinceMs = now.getTime() - windowMin * 60_000;
  const recent = logs.filter((l) => +new Date(l.created_at) >= sinceMs);
  const byFn: Record<string, { total: number; errors: number }> = {};
  for (const l of recent) {
    const k = l.function_name || "unknown";
    byFn[k] ||= { total: 0, errors: 0 };
    byFn[k].total++;
    if ((l.status ?? 0) >= 500) byFn[k].errors++;
  }
  const bucket = Math.floor(now.getTime() / (windowMin * 60_000));
  const out: FindingCandidate[] = [];
  for (const [fn, agg] of Object.entries(byFn)) {
    const rate = agg.total ? agg.errors / agg.total : 0;
    let sev: FindingCandidate["severity"] | null = null;
    if (agg.errors >= 10) sev = "critical";
    else if (agg.errors >= 3 && rate >= 0.2) sev = "high";
    if (!sev) continue;
    out.push({
      kind: "edge_function_error_rate",
      severity: sev,
      summary:
        `${fn}: ${agg.errors} server errors of ${agg.total} calls in ` +
        `last ${windowMin}m (${(rate * 100).toFixed(0)}%).`,
      dedupe_key: `edge_function_error_rate:${fn}:${bucket}`,
      subject_ref: { function_name: fn, window_minutes: windowMin },
      payload: {
        function_name: fn, window_minutes: windowMin,
        total: agg.total, errors: agg.errors, error_rate: rate,
      },
    });
  }
  return out;
}

export type ClientErrorRow = {
  function_name: string | null;
  message: string;
  created_at: string;
};

/**
 * Browser-side network failures captured by the client-error-beacon function.
 * Fires when >= 5 transport errors targeting the same function in the window.
 */
export function checkClientTransportErrors(
  now: Date,
  windowMin: number,
  rows: ClientErrorRow[],
): FindingCandidate[] {
  const sinceMs = now.getTime() - windowMin * 60_000;
  const recent = rows.filter((r) => +new Date(r.created_at) >= sinceMs);
  const byFn: Record<string, { count: number; sample: string }> = {};
  for (const r of recent) {
    const k = r.function_name || "unknown";
    byFn[k] ||= { count: 0, sample: r.message };
    byFn[k].count++;
  }
  const bucket = Math.floor(now.getTime() / (windowMin * 60_000));
  const out: FindingCandidate[] = [];
  for (const [fn, agg] of Object.entries(byFn)) {
    if (agg.count < 5) continue;
    out.push({
      kind: "client_transport_error",
      severity: agg.count >= 20 ? "high" : "medium",
      summary:
        `${agg.count} browser-side network failure(s) calling ${fn} in last ` +
        `${windowMin}m: ${agg.sample.slice(0, 120)}`,
      dedupe_key: `client_transport_error:${fn}:${bucket}`,
      subject_ref: { function_name: fn, window_minutes: windowMin },
      payload: {
        function_name: fn, window_minutes: windowMin,
        count: agg.count, sample_message: agg.sample.slice(0, 240),
      },
    });
  }
  return out;
}


/**
 * Voice pipeline red-state check (TTS / browser transport / Telegram voice).
 * Bands: red when error_rate > 10% over 1h OR no successful call in last 60min
 * (provided we've ever seen one — to avoid flapping on cold start).
 */
const VOICE_FUNCTIONS = ["gemini-tts", "companion-cloud-chat", "telegram-send-voice"] as const;

export function checkVoicePipelineRed(
  now: Date,
  windowMin: number,
  rows: EdgeLogRow[],
): FindingCandidate[] {
  const sinceMs = now.getTime() - windowMin * 60_000;
  const inWindow = rows.filter((r) => +new Date(r.created_at) >= sinceMs);
  const bucket = Math.floor(now.getTime() / (windowMin * 60_000));
  const out: FindingCandidate[] = [];

  for (const fn of VOICE_FUNCTIONS) {
    const fnRows = inWindow.filter((r) => r.function_name === fn);
    const total = fnRows.length;
    const errors = fnRows.filter((r) => (r.status ?? 0) >= 500).length;
    const lastSuccess = fnRows
      .filter((r) => (r.status ?? 0) < 400)
      .sort((a, b) => +new Date(b.created_at) - +new Date(a.created_at))[0];
    const rate = total ? errors / total : 0;
    const noSuccess = total > 0 && !lastSuccess;
    const highRate = total >= 5 && rate > 0.1;
    if (!noSuccess && !highRate) continue;

    out.push({
      kind: "voice_pipeline_red",
      severity: "high",
      summary:
        `Voice ${fn}: ${errors}/${total} errors (${(rate * 100).toFixed(0)}%) in last ${windowMin}m` +
        (noSuccess ? "; no successful call." : "."),
      dedupe_key: `voice_pipeline_red:${fn}:${bucket}`,
      subject_ref: { function_name: fn, window_minutes: windowMin },
      payload: {
        function_name: fn, window_minutes: windowMin,
        total, errors, error_rate: rate,
        no_success_in_window: noSuccess,
      },
    });
  }
  return out;
}

/**
 * Night-jobs stalled (slice 1 — Hermes worker reclaim pattern).
 * Caller passes the result of public.reclaim_stale_night_jobs(); we surface
 * a finding whenever anything was reclaimed or auto-blocked in this tick.
 */
export type ReclaimResult = {
  overnight_runs_reclaimed?: number;
  overnight_runs_auto_blocked?: number;
  night_shifts_reclaimed?: number;
  night_shifts_auto_blocked?: number;
};

export function checkNightJobsStalled(
  now: Date,
  reclaim: ReclaimResult,
): FindingCandidate[] {
  const blocked =
    (reclaim.overnight_runs_auto_blocked ?? 0) +
    (reclaim.night_shifts_auto_blocked ?? 0);
  const reclaimed =
    (reclaim.overnight_runs_reclaimed ?? 0) +
    (reclaim.night_shifts_reclaimed ?? 0);
  if (blocked === 0 && reclaimed === 0) return [];
  const bucket = Math.floor(now.getTime() / (60 * 60_000));
  const sev: FindingCandidate["severity"] = blocked > 0 ? "high" : "medium";
  return [{
    kind: "night_jobs_stalled",
    severity: sev,
    summary:
      `Night worker reclaim: ${reclaimed} requeued, ${blocked} auto-blocked ` +
      `(retry cap reached).`,
    dedupe_key: `night_jobs_stalled:${bucket}`,
    subject_ref: {},
    payload: { ...reclaim, hour_bucket: bucket },
  }];
}

/**
 * Allowlist rejects (slice 4 — default-deny watchdog).
 * Fires when a single platform sees > threshold rejects in 24h.
 */
export type AllowlistRejectRow = {
  function_name: string | null;
  classified_error: string | null;
  created_at: string;
  request_meta?: Record<string, unknown> | null;
};

export function checkAllowlistRejects(
  now: Date,
  rows: AllowlistRejectRow[],
  threshold = 50,
): FindingCandidate[] {
  const since = now.getTime() - 24 * 3600 * 1000;
  const filtered = rows.filter(
    (r) =>
      r.classified_error === "allowlist_reject" &&
      +new Date(r.created_at) >= since,
  );
  if (filtered.length === 0) return [];
  const byFn: Record<string, number> = {};
  for (const r of filtered) {
    const k = r.function_name || "unknown";
    byFn[k] = (byFn[k] ?? 0) + 1;
  }
  const out: FindingCandidate[] = [];
  const dayBucket = Math.floor(now.getTime() / (24 * 3600 * 1000));
  for (const [fn, count] of Object.entries(byFn)) {
    if (count < threshold) continue;
    out.push({
      kind: "allowlist_rejects",
      severity: count >= threshold * 4 ? "critical" : "high",
      summary: `${fn}: ${count} allowlist rejects in last 24h — possible probing or stale config.`,
      dedupe_key: `allowlist_rejects:${fn}:${dayBucket}`,
      subject_ref: { function_name: fn },
      payload: { function_name: fn, count, threshold, window_hours: 24 },
    });
  }
  return out;
}

/**
 * What's New: drafts queue going stale.
 * Fires medium when > 20 unreviewed drafts OR oldest draft > 7 days.
 */
export type WhatsNewDraftRow = { id: string; created_at: string };

export function checkWhatsNewDraftsStale(
  now: Date,
  drafts: WhatsNewDraftRow[],
): FindingCandidate[] {
  if (drafts.length === 0) return [];
  const oldest = drafts.reduce(
    (m, d) => Math.min(m, +new Date(d.created_at)),
    now.getTime(),
  );
  const ageDays = (now.getTime() - oldest) / (24 * 3600_000);
  const tooMany = drafts.length > 20;
  const tooOld = ageDays > 7;
  if (!tooMany && !tooOld) return [];
  const dayBucket = Math.floor(now.getTime() / (24 * 3600_000));
  return [{
    kind: "whats_new_drafts_stale",
    severity: "medium",
    summary:
      `What's New: ${drafts.length} unreviewed draft${drafts.length === 1 ? "" : "s"}` +
      (tooOld ? `, oldest ${Math.floor(ageDays)}d old` : "") + ".",
    dedupe_key: `whats_new_drafts_stale:${dayBucket}`,
    subject_ref: {},
    payload: { drafts: drafts.length, oldest_age_days: Math.floor(ageDays) },
  }];
}
