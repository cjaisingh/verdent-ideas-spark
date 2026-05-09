// Deep Audit checks — pure helpers so they can be unit tested without Supabase.
// Each check returns ModuleResult; the function aggregates these into a run row.

export type Severity = "info" | "low" | "medium" | "high" | "critical";

export type AuditFinding = {
  module: string;
  severity: Severity;
  title: string;
  detail?: string;
  evidence?: Record<string, unknown>;
};

export type ModuleResult = {
  module: string;
  status: "ok" | "warn" | "fail";
  checked: number;
  findings: AuditFinding[];
  metrics?: Record<string, number>;
};

// ---------- 1. Secrets hygiene ----------
// Flags secrets older than 90 / 180 days.
export function auditSecrets(
  secrets: Array<{ key: string; updated_at: string | null }>,
  now: Date = new Date(),
): ModuleResult {
  const findings: AuditFinding[] = [];
  let oldCount = 0;
  for (const s of secrets) {
    if (!s.updated_at) continue;
    const ageDays = Math.floor((now.getTime() - new Date(s.updated_at).getTime()) / 86_400_000);
    if (ageDays >= 180) {
      findings.push({
        module: "secrets",
        severity: "high",
        title: `Secret '${s.key}' is ${ageDays} days old`,
        detail: "Rotate secrets at least every 180 days.",
        evidence: { key: s.key, age_days: ageDays, updated_at: s.updated_at },
      });
      oldCount++;
    } else if (ageDays >= 90) {
      findings.push({
        module: "secrets",
        severity: "medium",
        title: `Secret '${s.key}' is ${ageDays} days old`,
        detail: "Consider rotating; recommended cadence is 90 days.",
        evidence: { key: s.key, age_days: ageDays },
      });
      oldCount++;
    }
  }
  return {
    module: "secrets",
    status: findings.some((f) => f.severity === "high" || f.severity === "critical")
      ? "fail"
      : findings.length > 0
      ? "warn"
      : "ok",
    checked: secrets.length,
    findings,
    metrics: { stale_count: oldCount },
  };
}

// ---------- 2. Admin role inventory ----------
export function auditAdmins(
  adminUserIds: string[],
  recentGrants: Array<{ role: string; action: string; created_at: string }>,
  now: Date = new Date(),
): ModuleResult {
  const findings: AuditFinding[] = [];
  if (adminUserIds.length === 0) {
    findings.push({
      module: "rbac",
      severity: "critical",
      title: "No admin users",
      detail: "System has zero admins — privileged actions cannot be granted.",
    });
  } else if (adminUserIds.length === 1) {
    findings.push({
      module: "rbac",
      severity: "medium",
      title: "Only one admin user",
      detail: "Single point of failure for privileged operations. Add at least one backup admin.",
    });
  } else if (adminUserIds.length > 5) {
    findings.push({
      module: "rbac",
      severity: "medium",
      title: `${adminUserIds.length} admin users (over recommended ≤ 5)`,
      detail: "Audit admin grants and revoke unused ones (least-privilege).",
      evidence: { count: adminUserIds.length },
    });
  }
  const since30d = now.getTime() - 30 * 86_400_000;
  const recentAdminGrants = recentGrants.filter(
    (g) => g.role === "admin" && g.action === "granted" && new Date(g.created_at).getTime() >= since30d,
  );
  if (recentAdminGrants.length >= 3) {
    findings.push({
      module: "rbac",
      severity: "high",
      title: `${recentAdminGrants.length} admin grants in last 30 days`,
      detail: "Spike in admin grants — confirm each was intentional.",
      evidence: { count: recentAdminGrants.length },
    });
  }
  return {
    module: "rbac",
    status: findings.some((f) => f.severity === "high" || f.severity === "critical")
      ? "fail"
      : findings.length > 0
      ? "warn"
      : "ok",
    checked: adminUserIds.length,
    findings,
    metrics: { admin_count: adminUserIds.length, recent_admin_grants_30d: recentAdminGrants.length },
  };
}

// ---------- 3. Automation health (last 7 days) ----------
export function auditAutomation(
  runs: Array<{ job: string; status: string; created_at: string }>,
): ModuleResult {
  const byJob = new Map<string, { ok: number; err: number }>();
  for (const r of runs) {
    const cur = byJob.get(r.job) ?? { ok: 0, err: 0 };
    if (r.status === "ok" || r.status === "success") cur.ok++;
    else if (r.status === "error" || r.status === "fail") cur.err++;
    byJob.set(r.job, cur);
  }
  const findings: AuditFinding[] = [];
  let totalErr = 0;
  for (const [job, c] of byJob) {
    const total = c.ok + c.err;
    totalErr += c.err;
    if (total === 0) continue;
    const errorRate = c.err / total;
    if (errorRate >= 0.5 && c.err >= 3) {
      findings.push({
        module: "automation",
        severity: "high",
        title: `Job '${job}' failing ${(errorRate * 100).toFixed(0)}% of the time (7d)`,
        evidence: { job, ok: c.ok, err: c.err },
      });
    } else if (errorRate >= 0.2 && c.err >= 2) {
      findings.push({
        module: "automation",
        severity: "medium",
        title: `Job '${job}' error rate ${(errorRate * 100).toFixed(0)}% (7d)`,
        evidence: { job, ok: c.ok, err: c.err },
      });
    }
  }
  return {
    module: "automation",
    status: findings.some((f) => f.severity === "high" || f.severity === "critical")
      ? "fail"
      : findings.length > 0
      ? "warn"
      : "ok",
    checked: runs.length,
    findings,
    metrics: { jobs: byJob.size, total_runs: runs.length, total_errors: totalErr },
  };
}

// ---------- 4. RLS / public-table coverage ----------
// Flags any public table where rls is disabled.
export function auditRls(
  tables: Array<{ table_name: string; rls_enabled: boolean; policies: number }>,
): ModuleResult {
  const findings: AuditFinding[] = [];
  for (const t of tables) {
    if (!t.rls_enabled) {
      findings.push({
        module: "rls",
        severity: "critical",
        title: `Table '${t.table_name}' has RLS disabled`,
        detail: "All public-schema tables must have RLS enabled.",
        evidence: { table: t.table_name },
      });
    } else if (t.policies === 0) {
      findings.push({
        module: "rls",
        severity: "high",
        title: `Table '${t.table_name}' has RLS enabled but no policies`,
        detail: "Without policies, RLS denies all access — likely a misconfiguration.",
        evidence: { table: t.table_name },
      });
    }
  }
  return {
    module: "rls",
    status: findings.some((f) => f.severity === "critical")
      ? "fail"
      : findings.length > 0
      ? "warn"
      : "ok",
    checked: tables.length,
    findings,
    metrics: { tables: tables.length, violations: findings.length },
  };
}

// ---------- 5. Retention compliance ----------
export function auditRetention(
  rows: Array<{ table_name: string; retention_days: number; row_count: number; oldest: string | null }>,
  now: Date = new Date(),
): ModuleResult {
  const findings: AuditFinding[] = [];
  for (const r of rows) {
    if (r.retention_days <= 0 || !r.oldest) continue;
    const oldestAgeDays = Math.floor((now.getTime() - new Date(r.oldest).getTime()) / 86_400_000);
    const overBy = oldestAgeDays - r.retention_days;
    if (overBy >= 7) {
      findings.push({
        module: "retention",
        severity: overBy >= 30 ? "high" : "medium",
        title: `'${r.table_name}' has rows ${overBy}d past retention window`,
        detail: `Retention is ${r.retention_days}d; oldest row is ${oldestAgeDays}d old.`,
        evidence: { table: r.table_name, retention_days: r.retention_days, oldest_age_days: oldestAgeDays },
      });
    }
  }
  return {
    module: "retention",
    status: findings.some((f) => f.severity === "high")
      ? "fail"
      : findings.length > 0
      ? "warn"
      : "ok",
    checked: rows.length,
    findings,
    metrics: { managed_tables: rows.length, violations: findings.length },
  };
}

// ---------- aggregator ----------
export function summarise(modules: ModuleResult[]) {
  const summary = { info: 0, low: 0, medium: 0, high: 0, critical: 0 };
  const findings: AuditFinding[] = [];
  let worst: "ok" | "warn" | "fail" = "ok";
  for (const m of modules) {
    for (const f of m.findings) {
      summary[f.severity]++;
      findings.push(f);
    }
    if (m.status === "fail") worst = "fail";
    else if (m.status === "warn" && worst === "ok") worst = "warn";
  }
  return { summary, findings, status: worst };
}
