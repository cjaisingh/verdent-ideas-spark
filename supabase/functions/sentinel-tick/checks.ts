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
    | "inbox_source_silent"
    | "out_of_scope_stale"
    | "observability_missing_watcher"
    | "observability_stale_surface"
    | "resolver_low_confidence_rate"
    | "resolver_no_match_burst"
    | "resolver_no_log_in_window"
    | "alias_revoke_burst"
    | "alias_corpus_ready"
    | "module_silent_24h"
    | "module_register_idempotency_replay_burst"
    | "app_secrets_plaintext_present"
    | "scheduled_jobs_stuck"
    | "scheduler_dlq_growth"
    | "module_endpoint_silent"
    | "module_endpoint_red"
    | "gh_actions_watch_stale"
    | "gh_actions_watch_auth_failed"
    | "ingest_files_stuck_parsing"
    | "ingest_files_failed_burst";


  severity: "info" | "low" | "medium" | "high" | "critical";
  summary: string;
  dedupe_key: string;
  subject_ref: Record<string, unknown>;
  payload: Record<string, unknown>;
};

export type AutomationRunRow = { id?: string; job: string; created_at: string; status?: string | null };
export type EdgeLogRow = { status: number | null; created_at: string; function_name: string };
export type GhActionsWatchRequestRow = {
  status: number | null;
  created_at: string;
  method: string | null;
};
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

    // Require RECENT errors. A 24h spike with zero errors in the last hour is
    // a stale rotation aftershock, not an active fire — let it decay silently.
    let sev: FindingCandidate["severity"] | null = null;
    let reason = "";
    if (err1h.length >= 5) {
      sev = "high"; reason = `${err1h.length} errors in last hour`;
    } else if (err24.length >= 20 && err1h.length >= 1) {
      sev = "high"; reason = `${err24.length} errors in last 24h (${err1h.length} in last hour)`;
    } else if (err1h.length >= 1 && ok24.length === 0) {
      sev = "high"; reason = `${err24.length} error(s) and 0 successes in last 24h`;
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
  // automation-auth-monitor removed 2026-05-28 (Lane 1 zombie kill).
  // 30-minute
  // NOTE: ci-status-sync-30m doesn't write to automation_runs — its state
  // is recorded in discussion_actions ci_* columns. Skip cron-silence here.
  // "ci-status-sync-30m": 30,
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
  // NOTE: app-walkthrough writes to walkthrough_runs, not automation_runs —
  // monitor via its own table, not the cron-silence sample. Same for
  // ci-status-sync-30m (its rows live in discussion_actions ci_* columns).
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
const VOICE_FUNCTIONS = ["gemini-tts", "companion-cloud-chat"] as const;

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
  // Drop the volume threshold: the system can generate >20 drafts/day on its
  // own, so `tooMany` is just noise. Only AGE indicates a real review backlog.
  const tooOld = ageDays > 14;
  if (!tooOld) return [];
  const dayBucket = Math.floor(now.getTime() / (24 * 3600_000));
  return [{
    kind: "whats_new_drafts_stale",
    severity: "medium",
    summary:
      `What's New: ${drafts.length} unreviewed draft${drafts.length === 1 ? "" : "s"}, ` +
      `oldest ${Math.floor(ageDays)}d old.`,
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
 * Approvals staleness. Caller must pass the `created_at` of the OLDEST
 * PENDING row in `approval_queue` (not the latest of any status). Empty
 * pending queue → caller passes null → no finding. Pending row older than
 * threshold → operator approval channel may be broken or operator delinquent.
 */
export function checkApprovalsStale(
  now: Date,
  oldestPendingCreatedAt: string | null,
  staleHours = 72,
): FindingCandidate[] {
  if (!oldestPendingCreatedAt) return [];
  const ageMs = now.getTime() - +new Date(oldestPendingCreatedAt);
  const thresholdMs = staleHours * 3600_000;
  if (ageMs <= thresholdMs) return [];
  return [{
    kind: "approvals_stale",
    severity: "medium",
    summary: `Oldest pending approval is ${Math.round(ageMs / 3600_000)}h old (threshold ${staleHours}h). Operator approval channel may be broken.`,
    dedupe_key: `approvals_stale`,
    subject_ref: { table: "approval_queue" },
    payload: { oldest_pending_created_at: oldestPendingCreatedAt, stale_hours_threshold: staleHours },
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
export type InboxMessageRecentRow = { chat_id: number | string | null };

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
    recent.map((r) => (r.chat_id ?? "").toString()).filter(Boolean),
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

// ---------------- out_of_scope_stale ----------------
// Any discussion_action auto-logged from a plan footer or session summary
// that has been status='open' for >14 days. Forces operator to either close
// with reason or promote — prevents the auto-log channel from turning into
// a black hole.
export type OutOfScopeStaleRow = {
  id: string;
  short_num: number;
  title: string;
  source: string;
  source_ref: string | null;
  created_at: string;
};

export function checkOutOfScopeStale(
  now: Date,
  rows: OutOfScopeStaleRow[],
): FindingCandidate[] {
  const cutoff = now.getTime() - 14 * 24 * 60 * 60_000;
  const stale = rows.filter((r) => new Date(r.created_at).getTime() < cutoff);
  if (!stale.length) return [];
  const dayBucket = Math.floor(now.getTime() / (24 * 60 * 60_000));
  // One finding per (source, source_ref) so a noisy plan doesn't fan out into
  // dozens of identical findings.
  const grouped = new Map<string, OutOfScopeStaleRow[]>();
  for (const r of stale) {
    const key = `${r.source}|${r.source_ref ?? "_"}`;
    const arr = grouped.get(key) ?? [];
    arr.push(r);
    grouped.set(key, arr);
  }
  const out: FindingCandidate[] = [];
  for (const [key, items] of grouped) {
    const sample = items[0];
    out.push({
      kind: "out_of_scope_stale",
      severity: "medium",
      summary:
        `${items.length} auto-logged ${sample.source} action(s) open >14 days` +
        (sample.source_ref ? ` (ref ${sample.source_ref})` : "") +
        `. Triage or close with reason.`,
      dedupe_key: `out_of_scope_stale:${key}:${dayBucket}`,
      subject_ref: { source: sample.source, source_ref: sample.source_ref, count: items.length },
      payload: {
        action_ids: items.map((i) => i.id),
        short_nums: items.map((i) => i.short_num),
        oldest_created_at: items.reduce(
          (m, i) => (m < i.created_at ? m : i.created_at),
          items[0].created_at,
        ),
      },
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// observability_registry watchers
// Fires per offending row in v_observability_registry_status:
//   - missing-watcher → high (no watcher declared for this surface)
//   - stale           → medium (cadence breached or last_seen missing)
// dedupe_key keys per (kind, surface_kind, surface_id) so the row stays open
// until the operator either declares a watcher or the surface goes healthy.
// ---------------------------------------------------------------------------

export type ObservabilityStatusRow = {
  surface_kind: string;
  surface_id: string;
  expected_cadence_minutes: number | null;
  watcher_kinds: string[] | null;
  owner: string | null;
  last_seen_at: string | null;
  status: string;
};

export function checkObservabilityRegistry(
  _now: Date,
  rows: ObservabilityStatusRow[],
): FindingCandidate[] {
  const out: FindingCandidate[] = [];
  for (const r of rows) {
    if (r.status === "missing-watcher") {
      out.push({
        kind: "observability_missing_watcher",
        severity: "high",
        summary:
          `observability_registry: ${r.surface_kind}/${r.surface_id} has no watcher declared` +
          (r.owner ? ` (owner: ${r.owner})` : ""),
        dedupe_key: `observability_missing_watcher:${r.surface_kind}:${r.surface_id}`,
        subject_ref: {
          surface_kind: r.surface_kind,
          surface_id: r.surface_id,
        },
        payload: {
          owner: r.owner,
          expected_cadence_minutes: r.expected_cadence_minutes,
          watcher_kinds: r.watcher_kinds ?? [],
          fix_url: "/admin/observability-registry",
        },
      });
    } else if (r.status === "stale") {
      const ageMin = r.last_seen_at
        ? Math.round((Date.now() - new Date(r.last_seen_at).getTime()) / 60_000)
        : null;
      out.push({
        kind: "observability_stale_surface",
        severity: "medium",
        summary:
          `observability_registry: ${r.surface_kind}/${r.surface_id} is stale` +
          (ageMin !== null
            ? ` (last seen ${ageMin} min ago, cadence ${r.expected_cadence_minutes ?? "?"} min)`
            : " (no recent activity)"),
        dedupe_key: `observability_stale_surface:${r.surface_kind}:${r.surface_id}`,
        subject_ref: {
          surface_kind: r.surface_kind,
          surface_id: r.surface_id,
        },
        payload: {
          owner: r.owner,
          expected_cadence_minutes: r.expected_cadence_minutes,
          watcher_kinds: r.watcher_kinds ?? [],
          last_seen_at: r.last_seen_at,
          age_minutes: ageMin,
          fix_url: "/admin/observability-registry",
        },
      });
    }
  }
  return out;
}

// ----- s5.2: resolver low-confidence rate -------------------------------
export type ResolverHealthRow = {
  tenant_id: string;
  band: string;
  event_count: number;
};

export function checkResolverLowConfidenceRate(
  now: Date,
  rows: ResolverHealthRow[],
): FindingCandidate[] {
  const out: FindingCandidate[] = [];
  const byTenant = new Map<string, { total: number; no_match: number }>();
  for (const r of rows) {
    const cur = byTenant.get(r.tenant_id) ?? { total: 0, no_match: 0 };
    cur.total += Number(r.event_count);
    if (r.band === "no_match") cur.no_match += Number(r.event_count);
    byTenant.set(r.tenant_id, cur);
  }
  const hourBucket = Math.floor(now.getTime() / (60 * 60_000));
  for (const [tenantId, c] of byTenant) {
    if (c.total < 20) continue;
    const pct = c.no_match / c.total;
    if (pct < 0.20) continue;
    out.push({
      kind: "resolver_low_confidence_rate",
      severity: "medium",
      summary:
        `Resolver no_match rate ${(pct * 100).toFixed(0)}% over 24h ` +
        `(${c.no_match}/${c.total}) for tenant ${tenantId.slice(0, 8)}. ` +
        `Check descriptor weights or alias coverage.`,
      dedupe_key: `resolver_low_confidence_rate:${tenantId}:${hourBucket}`,
      subject_ref: { tenant_id: tenantId, no_match: c.no_match, total: c.total },
      payload: { no_match_pct: pct, fix_url: "/entities" },
    });
  }
  return out;
}

// ----- s5.3 M3: alias_revoke_burst ---------------------------------------
// >10 alias_revoke events in 15min for one tenant → high. Catches sloppy
// scripted revocations and the early-warning sign of a tenant-tree mis-merge.
export type AliasRevokeEventRow = {
  tenant_id: string;
  kind: string; // alias_revoke or alias_hard_revoke
  created_at: string;
};

export function checkAliasRevokeBurst(
  now: Date,
  windowMinutes: number,
  threshold: number,
  rows: AliasRevokeEventRow[],
): FindingCandidate[] {
  const out: FindingCandidate[] = [];
  const cutoff = now.getTime() - windowMinutes * 60_000;
  const byTenant = new Map<string, { soft: number; hard: number }>();
  for (const r of rows) {
    if (r.kind !== "alias_revoke" && r.kind !== "alias_hard_revoke") continue;
    if (+new Date(r.created_at) < cutoff) continue;
    const cur = byTenant.get(r.tenant_id) ?? { soft: 0, hard: 0 };
    if (r.kind === "alias_hard_revoke") cur.hard++;
    else cur.soft++;
    byTenant.set(r.tenant_id, cur);
  }
  // Bucket the window so dedupe doesn't churn while the burst is ongoing.
  const windowBucket = Math.floor(now.getTime() / (windowMinutes * 60_000));
  for (const [tenantId, c] of byTenant) {
    const total = c.soft + c.hard;
    if (total < threshold) continue;
    out.push({
      kind: "alias_revoke_burst",
      severity: c.hard >= 3 ? "critical" : "high",
      summary:
        `Alias revoke burst: ${total} in ${windowMinutes}m for tenant ` +
        `${tenantId.slice(0, 8)} (${c.soft} soft, ${c.hard} hard). ` +
        `Check for a misfiring script or tenant-tree mis-merge.`,
      dedupe_key: `alias_revoke_burst:${tenantId}:${windowBucket}`,
      subject_ref: { tenant_id: tenantId, soft: c.soft, hard: c.hard, window_minutes: windowMinutes },
      payload: {
        soft_revokes: c.soft,
        hard_revokes: c.hard,
        window_minutes: windowMinutes,
        threshold,
        fix_url: "/entities",
      },
    });
  }
  return out;
}

// --- module_silent_24h ---
// Input: one row per (owning_module, last_heartbeat_at) for modules that have ≥1 registered capability.
// Fires medium if last heartbeat older than 24h, suppressed if module has no capabilities.
export type ModuleLivenessRow = {
  owning_module: string;
  cap_count: number;
  last_heartbeat_at: string | null;
};

export function checkModuleSilent24h(now: Date, rows: ModuleLivenessRow[]): FindingCandidate[] {
  const out: FindingCandidate[] = [];
  const cutoff = now.getTime() - 24 * 60 * 60 * 1000;
  for (const r of rows) {
    if (!r.owning_module || r.cap_count < 1) continue;
    const lastMs = r.last_heartbeat_at ? new Date(r.last_heartbeat_at).getTime() : 0;
    if (lastMs >= cutoff) continue;
    const ageH = r.last_heartbeat_at
      ? Math.round((now.getTime() - lastMs) / 3_600_000)
      : null;
    out.push({
      kind: "module_silent_24h",
      severity: "medium",
      summary: r.last_heartbeat_at
        ? `Module '${r.owning_module}' has not sent a heartbeat in ${ageH}h (${r.cap_count} capabilities registered).`
        : `Module '${r.owning_module}' has never sent a heartbeat (${r.cap_count} capabilities registered).`,
      dedupe_key: `module_silent_24h:${r.owning_module}`,
      subject_ref: { owning_module: r.owning_module },
      payload: {
        owning_module: r.owning_module,
        cap_count: r.cap_count,
        last_heartbeat_at: r.last_heartbeat_at,
        age_hours: ageH,
        fix_url: "/capabilities",
      },
    });
  }
  return out;
}


// --- alias_corpus_ready ---------------------------------------------------
// Fires once when tenant_node_aliases count crosses the ADR-0004 acceptance
// threshold (≥ALIAS_CORPUS_READY_THRESHOLD). Severity `info`; dedupe key is
// stable so re-firing requires the row to be resolved + corpus to dip below
// and re-cross. Purpose: auto-nudge the operator that the ADR-0004 bench can
// finally produce a representative measurement. See
// docs/adr/0004-alias-revocation-cascade.md § Acceptance.
export const ALIAS_CORPUS_READY_THRESHOLD = 1000;

export function checkAliasCorpusReady(
  aliasCount: number,
  threshold: number = ALIAS_CORPUS_READY_THRESHOLD,
): FindingCandidate[] {
  if (aliasCount < threshold) return [];
  return [{
    kind: "alias_corpus_ready",
    severity: "info",
    summary: `tenant_node_aliases corpus = ${aliasCount} (≥${threshold}). ADR-0004 bench is unblocked; run scripts/adr-bench/adr-0004-revocation.ts --write-decision.`,
    dedupe_key: "alias_corpus_ready",
    subject_ref: { adr: "ADR-0004" },
    payload: {
      alias_count: aliasCount,
      threshold,
      fix_url: "/admin/adr-bench",
      bench_script: "scripts/adr-bench/adr-0004-revocation.ts",
    },
  }];
}

// --- resolver_no_log_in_window -------------------------------------------
// s5.2/t5: every entity-resolve invocation MUST land in resolver_decisions.
// Compare edge_logs invocations vs resolver_decisions inserts in the last
// `windowMinutes`. Gap > tolerance → high. Owner = resolver.
export type ResolverLogCoverageSignal = {
  entity_resolve_calls: number;
  resolver_decisions_inserts: number;
  window_minutes: number;
};

export function checkResolverNoLogInWindow(
  signal: ResolverLogCoverageSignal,
  tolerance = 5,
): FindingCandidate[] {
  const gap = signal.entity_resolve_calls - signal.resolver_decisions_inserts;
  if (gap <= tolerance) return [];
  return [{
    kind: "resolver_no_log_in_window",
    severity: "high",
    summary: `entity-resolve called ${signal.entity_resolve_calls}× in last ${signal.window_minutes}min but only ${signal.resolver_decisions_inserts} resolver_decisions rows — ${gap} unlogged calls.`,
    dedupe_key: "resolver_no_log_in_window",
    subject_ref: { rpc: "public.resolve_entity_logged", window_minutes: signal.window_minutes },
    payload: {
      entity_resolve_calls: signal.entity_resolve_calls,
      resolver_decisions_inserts: signal.resolver_decisions_inserts,
      gap,
      tolerance,
      fix_url: "/admin/resolver",
    },
  }];
}

/**
 * ADR-0009: app_secrets values are encrypted at rest in `value_ciphertext bytea`.
 * The legacy plaintext `value` column was dropped. If anything (a buggy
 * migration, an over-eager fix, a manual ALTER) re-introduces it, every row
 * silently regresses to plaintext. Fire critical the moment the column
 * reappears OR if any row has NULL ciphertext.
 */
export type AppSecretsAtRestSignal = {
  legacy_value_column_present: boolean;
  rows_with_null_ciphertext: number;
};

export function checkAppSecretsPlaintextPresent(
  signal: AppSecretsAtRestSignal,
): FindingCandidate[] {
  const issues: string[] = [];
  if (signal.legacy_value_column_present) {
    issues.push("legacy plaintext `value` column has reappeared on public.app_secrets");
  }
  if (signal.rows_with_null_ciphertext > 0) {
    issues.push(`${signal.rows_with_null_ciphertext} row(s) have NULL value_ciphertext`);
  }
  if (issues.length === 0) return [];
  return [{
    kind: "app_secrets_plaintext_present",
    severity: "critical",
    summary: `app_secrets at-rest encryption regressed: ${issues.join("; ")}. See ADR-0009.`,
    dedupe_key: "app_secrets_plaintext_present",
    subject_ref: { table: "public.app_secrets", adr: "ADR-0009" },
    payload: { ...signal, fix_url: "/admin", runbook: "docs/runbooks/secrets-mek-rotation.md" },
  }];
}

/**
 * Resolver no-match burst (s5.2/t3 acceptance gate).
 *
 * Reads recent `entity_resolution_events` rows of kind=`propose` with
 * `payload.confidence_band ∈ {auto_bind, conflict, no_match}` over the last
 * window (default 60 min). Fires `medium` when the no_match share exceeds
 * `threshold` AND the sample size clears `minSample` (so a single failed call
 * doesn't trip it). Critical above 2× threshold.
 *
 * Dedupe key bucketed per UTC hour so the same finding doesn't re-fire each tick.
 */
export type ResolverProposeRow = {
  kind: string;
  occurred_at: string;
  payload: { confidence_band?: string | null } | null;
};

export function checkResolverNoMatchBurst(
  now: Date,
  rows: ResolverProposeRow[],
  opts: { windowMinutes?: number; threshold?: number; minSample?: number } = {},
): FindingCandidate[] {
  const windowMinutes = opts.windowMinutes ?? 60;
  const threshold = opts.threshold ?? 0.2;
  const minSample = opts.minSample ?? 10;
  const since = now.getTime() - windowMinutes * 60_000;
  const recent = rows.filter(
    (r) => r.kind === "propose" && +new Date(r.occurred_at) >= since,
  );
  if (recent.length < minSample) return [];
  const noMatch = recent.filter(
    (r) => (r.payload?.confidence_band ?? "") === "no_match",
  ).length;
  const rate = noMatch / recent.length;
  if (rate <= threshold) return [];
  const hourBucket = Math.floor(now.getTime() / (3600 * 1000));
  const severity: FindingCandidate["severity"] = rate >= threshold * 2 ? "critical" : "medium";
  return [{
    kind: "resolver_no_match_burst",
    severity,
    summary:
      `Resolver no-match rate ${(rate * 100).toFixed(1)}% over last ${windowMinutes}m ` +
      `(${noMatch}/${recent.length}). Threshold ${(threshold * 100).toFixed(0)}%. ` +
      `Likely corpus drift or normaliser regression.`,
    dedupe_key: `resolver_no_match_burst:${hourBucket}`,
    subject_ref: { rpc: "public.resolve_entity", window_minutes: windowMinutes },
    payload: {
      window_minutes: windowMinutes,
      threshold,
      sample_size: recent.length,
      no_match_count: noMatch,
      no_match_rate: Number(rate.toFixed(4)),
      hour_bucket: hourBucket,
    },
  }];
}

// ============================================================================
// W8.1 Global Scheduling Substrate — 4 sentinel checks
// ============================================================================

export type ScheduledJobSentinelRow = {
  id: string;
  kind: string;
  owning_module: string;
  status: string;
  run_at: string;
  started_at: string | null;
  attempts: number | null;
  last_error: string | null;
};

/** scheduled_jobs_stuck — any `running` >10min OR `pending` with run_at < now()-5min. */
export function checkScheduledJobsStuck(
  now: Date,
  rows: ScheduledJobSentinelRow[],
): FindingCandidate[] {
  const runningCutoff = now.getTime() - 10 * 60_000;
  const pendingCutoff = now.getTime() - 5 * 60_000;
  const stuck = rows.filter((r) => {
    if (r.status === "running") {
      const t = r.started_at ? +new Date(r.started_at) : +new Date(r.run_at);
      return t < runningCutoff;
    }
    if (r.status === "pending") {
      return +new Date(r.run_at) < pendingCutoff;
    }
    return false;
  });
  if (stuck.length === 0) return [];
  const byMod = new Map<string, number>();
  for (const r of stuck) byMod.set(r.owning_module, (byMod.get(r.owning_module) ?? 0) + 1);
  const hourBucket = Math.floor(now.getTime() / 3600_000);
  return [{
    kind: "scheduled_jobs_stuck",
    severity: stuck.length >= 10 ? "high" : "medium",
    summary: `${stuck.length} scheduled_jobs stuck (running>10m or pending past run_at>5m) across ${byMod.size} module(s).`,
    dedupe_key: `scheduled_jobs_stuck:${hourBucket}`,
    subject_ref: { table: "scheduled_jobs", count: stuck.length },
    payload: {
      stuck_count: stuck.length,
      by_module: Object.fromEntries(byMod),
      sample_ids: stuck.slice(0, 10).map((r) => r.id),
      runbook: "docs/scheduler.md#stuck-jobs",
    },
  }];
}

/** scheduler_dlq_growth — >20 failed jobs in last 24h. */
export function checkSchedulerDlqGrowth(
  now: Date,
  rows: { id: string; owning_module: string; kind: string; last_error: string | null; updated_at: string }[],
  threshold = 20,
): FindingCandidate[] {
  if (rows.length <= threshold) return [];
  const byMod = new Map<string, number>();
  for (const r of rows) byMod.set(r.owning_module, (byMod.get(r.owning_module) ?? 0) + 1);
  const dayBucket = now.toISOString().slice(0, 10);
  return [{
    kind: "scheduler_dlq_growth",
    severity: rows.length >= threshold * 2 ? "critical" : "high",
    summary: `${rows.length} scheduled jobs landed in DLQ (failed) in last 24h (threshold ${threshold}).`,
    dedupe_key: `scheduler_dlq_growth:${dayBucket}`,
    subject_ref: { table: "scheduled_jobs", status: "failed" },
    payload: {
      failed_24h: rows.length,
      threshold,
      by_module: Object.fromEntries(byMod),
      sample_ids: rows.slice(0, 10).map((r) => r.id),
      runbook: "docs/scheduler.md#dlq",
    },
  }];
}

export type ModuleEndpointRow = {
  module: string;
  callback_url: string | null;
  last_dispatch_ok_at: string | null;
  last_dispatch_err_at: string | null;
  last_error: string | null;
};

/** module_endpoint_silent — endpoint has pending jobs but last_dispatch_ok_at is >7d old. */
export function checkModuleEndpointSilent(
  now: Date,
  endpoints: ModuleEndpointRow[],
  pendingByModule: Record<string, number>,
): FindingCandidate[] {
  const cutoff = now.getTime() - 7 * 24 * 3600_000;
  const out: FindingCandidate[] = [];
  for (const e of endpoints) {
    const pending = pendingByModule[e.module] ?? 0;
    if (pending === 0) continue;
    const last = e.last_dispatch_ok_at ? +new Date(e.last_dispatch_ok_at) : 0;
    if (last >= cutoff) continue;
    out.push({
      kind: "module_endpoint_silent",
      severity: "medium",
      summary: `FM module '${e.module}' has ${pending} pending scheduled jobs but no successful dispatch in >7d.`,
      dedupe_key: `module_endpoint_silent:${e.module}`,
      subject_ref: { table: "module_endpoints", module: e.module },
      payload: {
        module: e.module,
        pending_jobs: pending,
        last_dispatch_ok_at: e.last_dispatch_ok_at,
        callback_url: e.callback_url,
        runbook: "docs/scheduler.md#endpoint-silent",
      },
    });
  }
  return out;
}

/** module_endpoint_red — last_dispatch_err_at > last_dispatch_ok_at for >1h with ≥3 attempts. */
export function checkModuleEndpointRed(
  now: Date,
  endpoints: ModuleEndpointRow[],
  recentAttemptsByModule: Record<string, number>,
): FindingCandidate[] {
  const cutoff = now.getTime() - 60 * 60_000;
  const out: FindingCandidate[] = [];
  for (const e of endpoints) {
    if (!e.last_dispatch_err_at) continue;
    const errAt = +new Date(e.last_dispatch_err_at);
    const okAt = e.last_dispatch_ok_at ? +new Date(e.last_dispatch_ok_at) : 0;
    if (errAt <= okAt) continue;
    if (errAt > cutoff) continue; // err is recent but maybe transient; need >1h
    const attempts = recentAttemptsByModule[e.module] ?? 0;
    if (attempts < 3) continue;
    out.push({
      kind: "module_endpoint_red",
      severity: "high",
      summary: `FM module '${e.module}' endpoint failing for >1h (${attempts} attempts). Last error: ${(e.last_error ?? "").slice(0, 120)}`,
      dedupe_key: `module_endpoint_red:${e.module}`,
      subject_ref: { table: "module_endpoints", module: e.module },
      payload: {
        module: e.module,
        last_dispatch_err_at: e.last_dispatch_err_at,
        last_dispatch_ok_at: e.last_dispatch_ok_at,
        last_error: e.last_error,
        attempts_24h: attempts,
        runbook: "docs/scheduler.md#endpoint-red",
      },
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// gh-actions-watch heartbeat. The cron sweep (scheduled-gh-actions-watch,
// every 5 min) should leave a POST trail in edge_request_logs whether the
// latest GitHub run is green or red. If the newest request is older than
// 30 minutes — or no request exists at all — the sweep is silently broken
// and CI reds on main will not page. High severity, dedupe per day so we
// don't spam.
// ---------------------------------------------------------------------------
export function checkGhActionsWatchStale(
  now: Date,
  lastRequestAt: string | null,
): FindingCandidate[] {
  const dayBucket = Math.floor(now.getTime() / (24 * 60 * 60_000));
  const dedupe = `gh_actions_watch_stale:${dayBucket}`;
  if (!lastRequestAt) {
    return [{
      kind: "gh_actions_watch_stale",
      severity: "high",
      summary: "gh-actions-watch has never been invoked — cron likely not scheduled.",
      dedupe_key: dedupe,
      subject_ref: { watcher: "gh-actions-watch" },
      payload: { last_request_at: null, runbook: "mem://features/gh-actions-watch" },
    }];
  }
  const ageMin = (now.getTime() - new Date(lastRequestAt).getTime()) / 60_000;
  if (ageMin < 30) return [];
  return [{
    kind: "gh_actions_watch_stale",
    severity: "high",
    summary:
      `gh-actions-watch silent for ${Math.round(ageMin)} min ` +
      `(last request ${lastRequestAt}). CI failures on main may not be alerting.`,
    dedupe_key: dedupe,
    subject_ref: { watcher: "gh-actions-watch" },
    payload: {
      last_request_at: lastRequestAt,
      age_minutes: Math.round(ageMin),
      runbook: "mem://features/gh-actions-watch",
    },
  }];
}

export function checkGhActionsWatchAuthFailed(
  now: Date,
  rows: GhActionsWatchRequestRow[],
): FindingCandidate[] {
  const windowMin = 20;
  const sinceMs = now.getTime() - windowMin * 60_000;
  const recent = rows.filter((row) => {
    const method = (row.method ?? "").toUpperCase();
    const status = row.status ?? 0;
    return method === "POST" && +new Date(row.created_at) >= sinceMs && (status === 401 || status === 403);
  });
  if (recent.length < 3) return [];

  const latest = recent
    .slice()
    .sort((a, b) => +new Date(b.created_at) - +new Date(a.created_at))[0];
  const hourBucket = Math.floor(now.getTime() / (60 * 60_000));

  return [{
    kind: "gh_actions_watch_auth_failed",
    severity: "high",
    summary:
      `gh-actions-watch returned ${recent.length} auth failures in the last ${windowMin}m ` +
      `(latest ${latest.created_at}). GitHub reds on main are not paging.`,
    dedupe_key: `gh_actions_watch_auth_failed:${hourBucket}`,
    subject_ref: { watcher: "gh-actions-watch", status: latest.status },
    payload: {
      auth_failures: recent.length,
      window_minutes: windowMin,
      last_seen_at: latest.created_at,
      last_status: latest.status,
      runbook: "mem://features/gh-actions-watch",
    },
  }];
}


