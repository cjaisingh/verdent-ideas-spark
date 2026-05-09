// Pure check helpers for the Sentinel Agent.
// Each helper takes plain rows (fetched by index.ts) and returns a list of
// `FindingCandidate` objects ready to upsert into public.sentinel_findings.

export type FindingCandidate = {
  kind: "cron_silence" | "five_xx_spike" | "secret_age" | "role_grant" | "job_error_rate";
  severity: "info" | "low" | "medium" | "high" | "critical";
  summary: string;
  dedupe_key: string;
  subject_ref: Record<string, unknown>;
  payload: Record<string, unknown>;
};

export type AutomationRunRow = { job: string; created_at: string; status?: string | null };
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
    out.push({
      kind: "job_error_rate",
      severity: sev,
      summary: `${job}: ${reason} (rate ${(rate24 * 100).toFixed(0)}%).`,
      dedupe_key: `job_error_rate:${job}:${hourBucket}`,
      subject_ref: { job },
      payload: {
        runs_24h: last24.length, errors_24h: err24.length,
        successes_24h: ok24.length, errors_1h: err1h.length,
        error_rate_24h: rate24,
      },
    });
  }
  return out;
}

export const SENTINEL_CADENCES: Record<string, number> = {
  "qa-validate": 60,
  "overnight-phase-runner-15m": 15,
  "morning-review": 24 * 60,
  "sentinel-tick": 15,
  "lessons-synthesize": 7 * 24 * 60,
};

