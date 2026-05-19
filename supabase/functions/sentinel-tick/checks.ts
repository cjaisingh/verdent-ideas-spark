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
    | "whats_new_drafts_stale"
    | "lint_delta_failures"
    | "companion_streams_stalled"
    | "heygen_videos_failed"
    | "truth_conflicts_unresolved"
    | "budget_projection_80"
    | "budget_projection_100"
    | "credit_runway_warn"
    | "credit_runway_critical"
    | "credit_snapshot_stale_warn"
    | "credit_snapshot_stale_critical"
    | "ai_jobs_stuck"
    | "ai_workers_offline"
    | "telegram_webhook_silent"
    | "approvals_stale"
    | "secrets_health_stale"
    | "cron_auth_failures_burst"
    | "inbox_kind_classify_failures"
    | "inbox_source_silent";
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
// `automation_runs.job` by each function. Sentinel filters automation_runs
// by this key set, so anything not listed here is NOT watched for silence.
export const SENTINEL_CADENCES: Record<string, number> = {
  // 15-minute heartbeats
  "sentinel-tick": 15,
  "tomorrow-plan-refresh": 15,
  "overnight-phase-runner-15m": 15,
  "automation-auth-monitor": 15,
  // 30-minute
  "ci-status-sync-30m": 30,
  // ~12-hourly
  "secrets-health-check": 12 * 60,
  // daily
  "morning-review": 24 * 60,
  "night-agent-open": 24 * 60,
  "night-agent-close": 24 * 60,
  "scheduled-code-review": 24 * 60,
  "daily-plan": 24 * 60,
  "lessons-daily-synth": 24 * 60,
  "snapshot-daily-report": 24 * 60,
  "nightly-rollup-analytics": 24 * 60,
  "ingest-external-data": 24 * 60,
  "cache-warm": 24 * 60,
  "app-walkthrough": 24 * 60,
  "overnight-prequeue": 24 * 60,
  "overnight-recommender": 24 * 60,
  "record-test-run": 24 * 60,
  // weekly
  "qa-validate": 7 * 24 * 60,
  "lessons-synthesize": 7 * 24 * 60,
  "awip-reviews-pull": 7 * 24 * 60,
  "deep-audit": 7 * 24 * 60,
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

/**
 * Delta lint failures (Hermes slice 2).
 * Fires medium when >5 failed lint_delta_runs in last 60 minutes.
 */
export type LintDeltaRow = {
  id: string;
  created_at: string;
  caller: string | null;
  file_path: string | null;
  error_class: string | null;
};

export function checkLintDeltaFailures(
  now: Date,
  rows: LintDeltaRow[],
  threshold = 5,
): FindingCandidate[] {
  if (rows.length <= threshold) return [];
  const byCaller: Record<string, number> = {};
  for (const r of rows) {
    const k = r.caller || "unknown";
    byCaller[k] = (byCaller[k] ?? 0) + 1;
  }
  const top = Object.entries(byCaller).sort((a, b) => b[1] - a[1])[0];
  const hourBucket = Math.floor(now.getTime() / (3600_000));
  return [{
    kind: "lint_delta_failures",
    severity: rows.length > threshold * 4 ? "high" : "medium",
    summary:
      `Delta lint: ${rows.length} failures in last 60min (top: ${top[0]} ×${top[1]}).`,
    dedupe_key: `lint_delta_failures:${hourBucket}`,
    subject_ref: { top_caller: top[0] },
    payload: { failures: rows.length, threshold, by_caller: byCaller, window_min: 60 },
  }];
}

// ── companion_streams_stalled ────────────────────────────────────────────────
// Flags when assistant streams in companion_messages stay in `streaming` state
// past their heartbeat deadline (>5 min stale). >5 in 24h → medium.
export type CompanionStreamRow = {
  id: string;
  thread_id: string | null;
  streamed_at: string | null;
  created_at: string;
};

export function checkCompanionStreamsStalled(
  now: Date,
  rows: CompanionStreamRow[],
  threshold = 5,
): FindingCandidate[] {
  if (rows.length <= threshold) return [];
  const dayBucket = Math.floor(now.getTime() / (24 * 3600_000));
  return [{
    kind: "companion_streams_stalled",
    severity: rows.length > threshold * 4 ? "high" : "medium",
    summary: `Companion: ${rows.length} assistant streams stalled in last 24h.`,
    dedupe_key: `companion_streams_stalled:${dayBucket}`,
    subject_ref: { sample_thread: rows[0]?.thread_id ?? null },
    payload: { stalled: rows.length, threshold, window_h: 24 },
  }];
}

// ── heygen_videos_failed ────────────────────────────────────────────────────
// Flags any HeyGen video creation/processing failures in the last 24h.
export type HeygenFailedRow = { id: string; kind: string; error: string | null; created_at: string };

export function checkHeygenVideosFailed(now: Date, rows: HeygenFailedRow[]): FindingCandidate[] {
  if (rows.length === 0) return [];
  const dayBucket = Math.floor(now.getTime() / (24 * 3600_000));
  return [{
    kind: "heygen_videos_failed",
    severity: rows.length >= 2 ? "high" : "medium",
    summary: `HeyGen: ${rows.length} video(s) failed in last 24h.`,
    dedupe_key: `heygen_videos_failed:${dayBucket}`,
    subject_ref: { sample_id: rows[0]?.id ?? null },
    payload: {
      failures: rows.length,
      window_h: 24,
      sample_error: rows[0]?.error ?? null,
      kinds: Array.from(new Set(rows.map((r) => r.kind))),
    },
  }];
}

// ── truth_conflicts_unresolved ──────────────────────────────────────────────
// Flags entity/field rows in public.truth_conflicts (top two competing
// claims share precedence and the score gap is < 10%). Persistent state, so
// auto-resolves when the operator files a tie-breaking claim.
export type TruthConflictRow = {
  entity: string;
  entity_id: string;
  field: string;
  top_source: string | null;
  next_source: string | null;
};

export function checkTruthConflictsUnresolved(
  _now: Date,
  rows: TruthConflictRow[],
): FindingCandidate[] {
  if (rows.length === 0) return [];
  const sample = rows[0];
  const sev: FindingCandidate["severity"] =
    rows.length >= 5 ? "high" : rows.length >= 2 ? "medium" : "low";
  return [{
    kind: "truth_conflicts_unresolved",
    severity: sev,
    summary: `Truth: ${rows.length} entity/field row(s) have competing claims within 10% (e.g. ${sample.entity}.${sample.field}: ${sample.top_source} vs ${sample.next_source}).`,
    dedupe_key: `truth_conflicts_unresolved`,
    subject_ref: { sample_entity: sample.entity, sample_field: sample.field, sample_id: sample.entity_id },
    payload: {
      conflict_count: rows.length,
      sample: rows.slice(0, 5),
    },
  }];
}

// Budget projection check.
// Fires once per (year_month, threshold_pct) when projected month-end spend
// (burn_7d_per_day × 30) crosses 80% or 100% of monthly_budget_credits.
export type BudgetSignals = {
  budget: number | null;
  burn_7d_per_day: number | null;
  projected_month_end: number | null;
};
export type CreditAlertRow = { year_month: string; threshold_pct: number | null; kind?: string };

export function checkBudgetProjection(
  now: Date,
  signals: BudgetSignals | null,
  existing: CreditAlertRow[],
): FindingCandidate[] {
  if (!signals) return [];
  const budget = Number(signals.budget ?? 0);
  const burn = Number(signals.burn_7d_per_day ?? 0);
  if (budget <= 0 || !Number.isFinite(burn) || burn <= 0) return [];
  const projected = Number(signals.projected_month_end ?? burn * 30);
  const projectedPct = Math.round((projected / budget) * 100 * 100) / 100;
  const ym = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
  const fired = new Set(
    existing.filter((r) => r.year_month === ym).map((r) => r.threshold_pct),
  );
  const out: FindingCandidate[] = [];
  for (const threshold of [80, 100] as const) {
    if (projectedPct < threshold) continue;
    if (fired.has(threshold)) continue;
    const severity: FindingCandidate["severity"] = threshold === 100 ? "critical" : "high";
    const kind: FindingCandidate["kind"] =
      threshold === 100 ? "budget_projection_100" : "budget_projection_80";
    out.push({
      kind,
      severity,
      summary: `Projected month-end spend ${projectedPct.toFixed(0)}% of budget (${projected.toFixed(0)}/${budget} credits; ${burn.toFixed(1)}/day).`,
      dedupe_key: `${kind}:${ym}`,
      subject_ref: { year_month: ym, threshold_pct: threshold },
      payload: {
        year_month: ym,
        threshold_pct: threshold,
        projected_pct: projectedPct,
        projected_month_end: projected,
        burn_per_day: burn,
        budget,
      },
    });
  }
  return out;
}

// Credit runway check. Reads v_credit_runway and fires:
//   - credit_runway_warn      when days_runway_21d < 14 (high)
//   - credit_runway_critical  when days_runway_21d < 7  (critical)
// Skips when:
//   - snapshot is missing or older than 7 days (stale → not actionable)
//   - burn_per_day_21d <= 0 (no recent spend → infinite runway)
//   - an alert of the same (year_month, kind) already fired this month
export type RunwayRow = {
  balance: number | null;
  as_of: string | null;
  estimated_balance_now: number | null;
  burn_per_day_21d: number | null;
  days_runway_21d: number | null;
  runway_exhaustion_date_21d: string | null;
};

export function checkCreditRunway(
  now: Date,
  runway: RunwayRow | null,
  existing: CreditAlertRow[],
): FindingCandidate[] {
  if (!runway || runway.balance == null || !runway.as_of) return [];
  const ageMs = now.getTime() - +new Date(runway.as_of);
  if (ageMs > 7 * 24 * 60 * 60 * 1000) return [];
  const burn = Number(runway.burn_per_day_21d ?? 0);
  if (!Number.isFinite(burn) || burn <= 0) return [];
  const days = runway.days_runway_21d == null ? null : Number(runway.days_runway_21d);
  if (days == null || !Number.isFinite(days)) return [];

  const ym = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
  const firedKinds = new Set(
    existing.filter((r) => r.year_month === ym).map((r) => (r as { kind?: string }).kind),
  );

  const out: FindingCandidate[] = [];
  // Critical first (so the higher band wins if both thresholds are crossed).
  if (days < 7 && !firedKinds.has("runway_critical")) {
    out.push({
      kind: "credit_runway_critical",
      severity: "critical",
      summary: `Credit runway ${days.toFixed(1)}d at ${burn.toFixed(1)}/day. Balance ${Number(runway.estimated_balance_now ?? runway.balance).toFixed(0)}.`,
      dedupe_key: `credit_runway_critical:${ym}`,
      subject_ref: { year_month: ym, kind: "runway_critical" },
      payload: {
        year_month: ym,
        kind: "runway_critical",
        days_runway: days,
        burn_per_day: burn,
        balance: Number(runway.balance),
        estimated_balance_now: Number(runway.estimated_balance_now ?? runway.balance),
        as_of: runway.as_of,
        exhaust_at: runway.runway_exhaustion_date_21d,
      },
    });
  } else if (days < 14 && !firedKinds.has("runway_warn") && !firedKinds.has("runway_critical")) {
    out.push({
      kind: "credit_runway_warn",
      severity: "high",
      summary: `Credit runway ${days.toFixed(1)}d at ${burn.toFixed(1)}/day. Balance ${Number(runway.estimated_balance_now ?? runway.balance).toFixed(0)}.`,
      dedupe_key: `credit_runway_warn:${ym}`,
      subject_ref: { year_month: ym, kind: "runway_warn" },
      payload: {
        year_month: ym,
        kind: "runway_warn",
        days_runway: days,
        burn_per_day: burn,
        balance: Number(runway.balance),
        estimated_balance_now: Number(runway.estimated_balance_now ?? runway.balance),
        as_of: runway.as_of,
        exhaust_at: runway.runway_exhaustion_date_21d,
      },
    });
  }
  return out;
}

// ============================================================================
// Credit snapshot staleness — fires once per UTC day when operator hasn't
// recorded a fresh balance reading despite ongoing logged spend.
// ============================================================================

export type CreditSnapshotAgeRow = {
  latest_as_of: string | null;
  minutes_since_latest: number | null;
  snapshots_24h: number | null;
  entries_since_latest: number | null;
};

export function checkCreditSnapshotStale(
  now: Date,
  age: CreditSnapshotAgeRow | null,
  existing: CreditAlertRow[],
): FindingCandidate[] {
  if (!age || age.minutes_since_latest == null) return [];
  const mins = Number(age.minutes_since_latest);
  const entries = Number(age.entries_since_latest ?? 0);
  if (!Number.isFinite(mins)) return [];

  const day = now.toISOString().slice(0, 10); // YYYY-MM-DD
  const ym = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
  const firedKinds = new Set(
    existing.filter((r) => r.year_month === ym).map((r) => (r as { kind?: string }).kind),
  );

  const out: FindingCandidate[] = [];
  if (mins > 1440 && entries >= 1 && !firedKinds.has(`snapshot_stale_critical:${day}`)) {
    out.push({
      kind: "credit_snapshot_stale_critical",
      severity: "critical",
      summary:
        `No credit-balance snapshot for ${(mins / 60).toFixed(1)}h while ${entries} entr${entries === 1 ? "y" : "ies"} logged. ` +
        `Record one on /admin/ai-usage.`,
      dedupe_key: `credit_snapshot_stale_critical:${day}`,
      subject_ref: { day, kind: `snapshot_stale_critical:${day}` },
      payload: {
        year_month: ym,
        kind: `snapshot_stale_critical:${day}`,
        minutes_since_latest: mins,
        entries_since_latest: entries,
        latest_as_of: age.latest_as_of,
      },
    });
  } else if (
    mins > 240 && entries >= 3 &&
    !firedKinds.has(`snapshot_stale_warn:${day}`) &&
    !firedKinds.has(`snapshot_stale_critical:${day}`)
  ) {
    out.push({
      kind: "credit_snapshot_stale_warn",
      severity: "high",
      summary:
        `No credit-balance snapshot for ${(mins / 60).toFixed(1)}h while ${entries} entries logged. ` +
        `Record one on /admin/ai-usage so per-step drift can be calculated.`,
      dedupe_key: `credit_snapshot_stale_warn:${day}`,
      subject_ref: { day, kind: `snapshot_stale_warn:${day}` },
      payload: {
        year_month: ym,
        kind: `snapshot_stale_warn:${day}`,
        minutes_since_latest: mins,
        entries_since_latest: entries,
        latest_as_of: age.latest_as_of,
      },
    });
  }
  return out;
}

// ============================================================================
// AI Jobs (local Ollama worker) — slice 1
// ============================================================================

export type AiJobStaleRow = {
  id: string;
  kind: string;
  attempts: number | null;
  heartbeat_at: string | null;
  claimed_at: string | null;
};

export function checkAiJobsStuck(
  now: Date,
  rows: AiJobStaleRow[],
  staleMinutes = 10,
): FindingCandidate[] {
  const cutoff = now.getTime() - staleMinutes * 60_000;
  const stuck = rows.filter((r) => {
    const last = new Date(r.heartbeat_at ?? r.claimed_at ?? 0).getTime();
    return last > 0 && last < cutoff;
  });
  if (stuck.length === 0) return [];
  const hour = Math.floor(now.getTime() / (60 * 60_000));
  return [{
    kind: "ai_jobs_stuck",
    severity: stuck.length >= 3 ? "high" : "medium",
    summary:
      `${stuck.length} ai_job(s) claimed > ${staleMinutes}m with stale heartbeat. ` +
      `Worker probably crashed or laptop slept.`,
    dedupe_key: `ai_jobs_stuck:${hour}`,
    subject_ref: { count: stuck.length },
    payload: { stale_minutes: staleMinutes, ids: stuck.slice(0, 10).map((s) => s.id) },
  }];
}

export type AiWorkerRow = {
  name: string;
  enabled: boolean;
  last_seen_at: string | null;
};

export function checkAiWorkersOffline(
  now: Date,
  workers: AiWorkerRow[],
  queueDepth: number,
  offlineMinutes = 15,
): FindingCandidate[] {
  if (queueDepth === 0) return []; // no queue → no urgency
  const cutoff = now.getTime() - offlineMinutes * 60_000;
  const offline = workers.filter((w) => {
    if (!w.enabled) return false;
    const last = new Date(w.last_seen_at ?? 0).getTime();
    return last === 0 || last < cutoff;
  });
  if (offline.length === 0) return [];
  const hour = Math.floor(now.getTime() / (60 * 60_000));
  return [{
    kind: "ai_workers_offline",
    severity: "medium",
    summary:
      `${offline.length} enabled ai_worker(s) offline > ${offlineMinutes}m ` +
      `with ${queueDepth} job(s) waiting.`,
    dedupe_key: `ai_workers_offline:${hour}`,
    subject_ref: { queue_depth: queueDepth },
    payload: { offline_minutes: offlineMinutes, names: offline.map((w) => w.name) },
  }];
}

/**
 * Telegram webhook silence. If the operator channel goes quiet for hours
 * we lose every Telegram message + every approval decision silently.
 * Reads from edge_request_logs (which records every webhook hit, including
 * 200s with `ignored: not_allowlisted`).
 *
 * Threshold: >6h with zero hits → high. Bot is essentially always in use,
 * so >6h is a strong signal of a broken webhook, expired token, or wrong
 * URL registration.
 */
export function checkTelegramWebhookSilent(
  now: Date,
  lastSeenAt: string | null,
  silenceHours = 6,
): FindingCandidate[] {
  const silenceMs = lastSeenAt ? now.getTime() - +new Date(lastSeenAt) : Infinity;
  const thresholdMs = silenceHours * 3600_000;
  if (silenceMs <= thresholdMs) return [];
  return [{
    kind: "telegram_webhook_silent",
    severity: "high",
    summary: `Telegram webhook silent for ${
      isFinite(silenceMs) ? Math.round(silenceMs / 3600_000) + "h" : "ever"
    } (threshold ${silenceHours}h). Check bot token, webhook URL, allowlist.`,
    dedupe_key: `telegram_webhook_silent`,
    subject_ref: { function_name: "telegram-webhook" },
    payload: { last_seen_at: lastSeenAt, silence_hours_threshold: silenceHours },
  }];
}

/**
 * Approvals staleness. Operator approval channel quiet for too long
 * usually means upstream (Telegram, awip-api) is silently dropping
 * requests. Fires when no new approval_queue row in N hours.
 *
 * Threshold: 72h → medium. Pure-quiet window in practice rarely exceeds
 * 48h; 72h means the channel is broken, not just unused.
 */
export function checkApprovalsStale(
  now: Date,
  lastCreatedAt: string | null,
  staleHours = 72,
): FindingCandidate[] {
  const ageMs = lastCreatedAt ? now.getTime() - +new Date(lastCreatedAt) : Infinity;
  const thresholdMs = staleHours * 3600_000;
  if (ageMs <= thresholdMs) return [];
  return [{
    kind: "approvals_stale",
    severity: "medium",
    summary: `No new approvals in ${
      isFinite(ageMs) ? Math.round(ageMs / 3600_000) + "h" : "ever"
    } (threshold ${staleHours}h). Operator approval channel may be broken.`,
    dedupe_key: `approvals_stale`,
    subject_ref: { table: "approval_queue" },
    payload: { last_created_at: lastCreatedAt, stale_hours_threshold: staleHours },
  }];
}


/**
 * Detector-of-the-detector: secrets-health-check must produce a fresh `ok`
 * row in automation_runs at least once per 26h (cron runs daily at 21:30 UTC).
 * If the detector itself is silent or erroring, we fire critical — this is
 * exactly the case that hid the AWIP_SERVICE_TOKEN rotation drift for a day.
 */
export function checkSecretsHealthStale(
  now: Date,
  lastOkAt: string | null,
  staleHours = 26,
): FindingCandidate[] {
  const ageMs = lastOkAt ? now.getTime() - +new Date(lastOkAt) : Infinity;
  const thresholdMs = staleHours * 3600_000;
  if (ageMs <= thresholdMs) return [];
  return [{
    kind: "secrets_health_stale",
    severity: "critical",
    summary: `secrets-health-check has not produced an ok run in ${
      isFinite(ageMs) ? Math.round(ageMs / 3600_000) + "h" : "ever"
    } (threshold ${staleHours}h). Secret-drift detection is offline.`,
    dedupe_key: `secrets_health_stale`,
    subject_ref: { job: "secrets-health-check" },
    payload: { last_ok_at: lastOkAt, stale_hours_threshold: staleHours },
  }];
}

export type AlertLogRow = { job: string; reason: string; created_at: string };

/**
 * Aggregate cron auth-failure burst. When the service token diverges between
 * the DB-side value (read by cron) and the edge-function env var (checked by
 * the function), every cron job fires `auth_failed` alerts. A single 401 is
 * noise; >5 across any jobs in an hour is the platform-wide auth chain
 * collapsing and must page critical immediately.
 */
export function checkCronAuthFailuresBurst(
  now: Date,
  rows: AlertLogRow[],
  threshold = 5,
): FindingCandidate[] {
  const since = now.getTime() - 60 * 60_000;
  const recent = rows.filter(
    (r) => r.reason === "auth_failed" && +new Date(r.created_at) >= since,
  );
  if (recent.length <= threshold) return [];
  const byJob: Record<string, number> = {};
  for (const r of recent) byJob[r.job] = (byJob[r.job] ?? 0) + 1;
  const top = Object.entries(byJob).sort((a, b) => b[1] - a[1]).slice(0, 5);
  // Hour-bucket dedupe so a sustained outage re-flags hourly, not every 15m.
  const hourBucket = Math.floor(now.getTime() / (60 * 60_000));
  return [{
    kind: "cron_auth_failures_burst",
    severity: "critical",
    summary:
      `${recent.length} cron auth_failed alerts in last 1h across ${
        Object.keys(byJob).length
      } job(s) (top: ${top.map(([j, n]) => `${j}×${n}`).join(", ")}). ` +
      `Likely AWIP_SERVICE_TOKEN mismatch between app_secrets and edge env.`,
    dedupe_key: `cron_auth_failures_burst:${hourBucket}`,
    subject_ref: { window_minutes: 60 },
    payload: { count: recent.length, by_job: byJob, threshold },
  }];
}

export type InboxKindUsageRow = { status: string | null; created_at: string };

/**
 * Inbox kind classifier failures. Triggers when >10% of LLM classify calls
 * over the last 24h returned status='error' (network / gateway / no_tool_call).
 * Requires at least 10 attempts to avoid noise on a quiet day.
 */
export function checkInboxKindClassifyFailures(
  now: Date,
  rows: InboxKindUsageRow[],
  minAttempts = 10,
  ratioThreshold = 0.1,
): FindingCandidate[] {
  if (rows.length < minAttempts) return [];
  const errors = rows.filter((r) => r.status === "error").length;
  const ratio = errors / rows.length;
  if (ratio < ratioThreshold) return [];
  const dayBucket = Math.floor(now.getTime() / (24 * 60 * 60_000));
  return [{
    kind: "inbox_kind_classify_failures",
    severity: "medium",
    summary:
      `Operator inbox LLM classifier failed ${errors}/${rows.length} (${
        (ratio * 100).toFixed(0)
      }%) in last 24h. Messages will fall through to manual triage.`,
    dedupe_key: `inbox_kind_classify_failures:${dayBucket}`,
    subject_ref: { job: "route-operator-message:inbox-kind" },
    payload: { errors, total: rows.length, ratio },
  }];
}

export type InboxSourceRow = { id: string; label: string | null; chat_id: number | string };
export type InboxMessageRecentRow = { source_chat_id: number | string | null };

/**
 * Inbox source silent. Any registered+enabled operator_inbox_sources entry
 * that has produced zero operator_messages in the last 14d is flagged so the
 * operator can disable it or check the bot membership.
 */
export function checkInboxSourceSilent(
  now: Date,
  sources: InboxSourceRow[],
  recent: InboxMessageRecentRow[],
): FindingCandidate[] {
  if (!sources.length) return [];
  const active = new Set(
    recent.map((r) => (r.source_chat_id ?? "").toString()).filter(Boolean),
  );
  const out: FindingCandidate[] = [];
  const dayBucket = Math.floor(now.getTime() / (24 * 60 * 60_000));
  for (const s of sources) {
    const key = s.chat_id.toString();
    if (active.has(key)) continue;
    out.push({
      kind: "inbox_source_silent",
      severity: "low",
      summary:
        `Operator inbox source "${s.label ?? key}" (chat ${key}) has had no messages in 14 days.`,
      dedupe_key: `inbox_source_silent:${key}:${dayBucket}`,
      subject_ref: { source_id: s.id, chat_id: key },
      payload: { label: s.label, chat_id: key },
    });
  }
  return out;
}
