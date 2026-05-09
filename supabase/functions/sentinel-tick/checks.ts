// Pure check helpers for the Sentinel Agent.
// Each helper takes plain rows (fetched by index.ts) and returns a list of
// `FindingCandidate` objects ready to upsert into public.sentinel_findings.

export type FindingCandidate = {
  kind: "cron_silence" | "five_xx_spike" | "secret_age" | "role_grant";
  severity: "info" | "low" | "medium" | "high" | "critical";
  summary: string;
  dedupe_key: string;
  subject_ref: Record<string, unknown>;
  payload: Record<string, unknown>;
};

export type AutomationRunRow = { job: string; created_at: string };
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

export const SENTINEL_CADENCES: Record<string, number> = {
  "qa-validate": 60,
  "overnight-phase-runner-15m": 15,
  "morning-review": 24 * 60,
  "sentinel-tick": 15,
};
