// Pure aggregator for the Morning Review.
// Inputs are plain rows fetched by index.ts; outputs are the JSON payload
// shape upserted into public.morning_reviews. Keeping this pure lets us
// unit-test the rules without hitting the database.

export type AutomationRun = {
  job: string;
  status: string;          // "ok" | "error" | "warn" | ...
  status_code: number | null;
  duration_ms: number | null;
  created_at: string;      // ISO
};

export type DiscussionAction = {
  id: string;
  title: string;
  status: string;
  priority: string;        // "low"|"med"|"high"|"urgent"
  promoted_task_id: string | null;
  created_at: string;
  updated_at: string;
  short_num: number;
  source?: string | null;       // "plan_footer" | "session_summary" | "manual" | "extracted" | null
  source_ref?: string | null;
};


export type RoadmapTask = {
  id: string;
  status: string;          // "todo"|"doing"|"done"|...
  updated_at: string;
};

export type Finding = {
  id: string;
  severity: string;        // "info"|"low"|"medium"|"high"|"critical"
  category: string | null;
  title: string;
  acknowledged: boolean;
  created_at: string;
  source?: "code_review" | "sentinel";
};

export type DeferredItem = {
  id: string;
  title: string;
  severity: string;
  defer_until: string;     // YYYY-MM-DD
  status: string;
};

export type NightShift = {
  id: string;
  status: string;
  window_start: string;
  window_end: string;
  summary: Record<string, unknown>;
};

export type AiUsageRow = { cost_usd: number | null; created_at: string };

export type AggregatorInput = {
  now: Date;
  // Expected cron cadences in minutes — used to flag stuck jobs (>2× cadence silent).
  jobCadenceMinutes: Record<string, number>;
  recentRuns: AutomationRun[];                 // last ~24h, all jobs
  openActions: DiscussionAction[];             // status='open'
  promotedTasks: Record<string, RoadmapTask>;  // keyed by promoted_task_id
  findings: Finding[];                         // open + ack=false
  deferred: DeferredItem[];                    // status='deferred'
  shifts: NightShift[];                        // last 24h
  aiUsage: AiUsageRow[];                       // last 24h
};

export type Kpis = {
  automation_success_rate_24h: number;          // 0..1
  automation_total_runs_24h: number;
  ai_cost_24h_usd: number;
  cron_last_seen: Record<string, string | null>;
};

export type StuckJob = {
  job: string;
  last_run_at: string | null;
  expected_within_minutes: number;
  silent_for_minutes: number | null;
};

export type DriftItem = {
  action_id: string;
  short_num: number;
  title: string;
  promoted_task_id: string;
  task_status: string | null;
  promoted_age_hours: number;
};

export type TopAction = {
  action_id: string;
  short_num: number;
  title: string;
  priority: string;
  age_hours: number;
  source: string | null;
  source_ref: string | null;
};


export type RevisitItem = {
  id: string;
  title: string;
  severity: string;
  defer_until: string;
};

export type AggregatorOutput = {
  kpis: Kpis;
  stuck_jobs: StuckJob[];
  promotion_drift: DriftItem[];
  night_throughput: {
    shifts: number;
    completed_shifts: number;
    last_window_end: string | null;
    summary: Record<string, unknown>;
  };
  open_findings: Finding[];
  top_actions: TopAction[];
  revisit_items: RevisitItem[];
};

const PRIORITY_ORDER: Record<string, number> = { urgent: 4, high: 3, med: 2, low: 1 };
const SEVERITY_RANK: Record<string, number> = { info: 0, low: 1, medium: 2, high: 3, critical: 4 };

const DRIFT_HOURS = 72;

export function aggregate(input: AggregatorInput): AggregatorOutput {
  const nowMs = input.now.getTime();

  // KPIs ---------------------------------------------------------------
  const last24 = input.recentRuns;
  const total = last24.length;
  const ok = last24.filter((r) => r.status === "ok").length;
  const successRate = total === 0 ? 1 : ok / total;
  const cost = input.aiUsage.reduce((s, r) => s + (Number(r.cost_usd) || 0), 0);

  const cronLastSeen: Record<string, string | null> = {};
  for (const job of Object.keys(input.jobCadenceMinutes)) {
    const latest = last24
      .filter((r) => r.job === job)
      .sort((a, b) => +new Date(b.created_at) - +new Date(a.created_at))[0];
    cronLastSeen[job] = latest?.created_at ?? null;
  }

  // Stuck jobs ---------------------------------------------------------
  const stuck: StuckJob[] = [];
  for (const [job, cadence] of Object.entries(input.jobCadenceMinutes)) {
    const last = cronLastSeen[job];
    const lastMs = last ? +new Date(last) : null;
    const silentFor = lastMs == null ? null : Math.round((nowMs - lastMs) / 60000);
    const threshold = cadence * 2;
    if (lastMs == null || (silentFor ?? 0) > threshold) {
      stuck.push({
        job,
        last_run_at: last,
        expected_within_minutes: cadence,
        silent_for_minutes: silentFor,
      });
    }
  }

  // Promotion drift ----------------------------------------------------
  const drift: DriftItem[] = [];
  for (const a of input.openActions) {
    if (!a.promoted_task_id) continue;
    const t = input.promotedTasks[a.promoted_task_id];
    const ageH = (nowMs - +new Date(a.updated_at)) / 3_600_000;
    if (ageH < DRIFT_HOURS) continue;
    if (t && t.status === "done") continue;
    drift.push({
      action_id: a.id,
      short_num: a.short_num,
      title: a.title,
      promoted_task_id: a.promoted_task_id,
      task_status: t?.status ?? null,
      promoted_age_hours: Math.round(ageH),
    });
  }

  // Night throughput ---------------------------------------------------
  const shifts = input.shifts;
  const lastShift = [...shifts].sort(
    (a, b) => +new Date(b.window_end) - +new Date(a.window_end),
  )[0];
  const completed = shifts.filter((s) => s.status === "complete" || s.status === "completed").length;
  const summary: Record<string, unknown> = {};
  if (lastShift?.summary && typeof lastShift.summary === "object") {
    Object.assign(summary, lastShift.summary);
  }

  // Open findings (medium+) -------------------------------------------
  const openFindings = input.findings
    .filter((f) => !f.acknowledged && (SEVERITY_RANK[f.severity] ?? 0) >= SEVERITY_RANK.medium)
    .sort((a, b) => (SEVERITY_RANK[b.severity] ?? 0) - (SEVERITY_RANK[a.severity] ?? 0))
    .slice(0, 25);

  // Top 5 actions ------------------------------------------------------
  const topActions = [...input.openActions]
    .sort((a, b) => {
      const pd = (PRIORITY_ORDER[b.priority] ?? 0) - (PRIORITY_ORDER[a.priority] ?? 0);
      if (pd !== 0) return pd;
      return +new Date(a.created_at) - +new Date(b.created_at);
    })
    .slice(0, 5)
    .map<TopAction>((a) => ({
      action_id: a.id,
      short_num: a.short_num,
      title: a.title,
      priority: a.priority,
      age_hours: Math.round((nowMs - +new Date(a.created_at)) / 3_600_000),
      source: a.source ?? null,
      source_ref: a.source_ref ?? null,
    }));


  // Revisit (deferred items due) --------------------------------------
  const todayIso = input.now.toISOString().slice(0, 10);
  const revisit: RevisitItem[] = input.deferred
    .filter((d) => d.status === "deferred" && d.defer_until <= todayIso)
    .map((d) => ({ id: d.id, title: d.title, severity: d.severity, defer_until: d.defer_until }));

  return {
    kpis: {
      automation_success_rate_24h: Number(successRate.toFixed(4)),
      automation_total_runs_24h: total,
      ai_cost_24h_usd: Number(cost.toFixed(4)),
      cron_last_seen: cronLastSeen,
    },
    stuck_jobs: stuck,
    promotion_drift: drift,
    night_throughput: {
      shifts: shifts.length,
      completed_shifts: completed,
      last_window_end: lastShift?.window_end ?? null,
      summary,
    },
    open_findings: openFindings,
    top_actions: topActions,
    revisit_items: revisit,
  };
}

// Default cadences (minutes) for known cron jobs. Anything older than 2× this
// flags as stuck. Keep in sync with the actual pg_cron schedules — note
// the cron jobname can differ from the function/job name written to
// automation_runs (e.g. cron `weekly-qa-validate` invokes function `qa-validate`).
export const DEFAULT_JOB_CADENCES: Record<string, number> = {
  "scheduled-code-review": 7 * 24 * 60,           // weekly (Mon 06:00 UTC, cron weekly-code-review)
  "qa-validate": 7 * 24 * 60,                     // weekly (Fri 16:00 UTC, cron weekly-qa-validate)
  "record-test-run": 24 * 60,                     // daily
  "secrets-health-check": 24 * 60,                // daily
  "night-agent-open": 24 * 60,                    // daily
  "night-agent-close": 24 * 60,                   // daily
  "overnight-phase-runner-15m": 15,               // every 15 min
  "overnight-prequeue": 24 * 60,                  // daily
  "morning-review": 24 * 60,                      // daily
  "sentinel-tick": 15,                            // every 15 min
  "lessons-synthesize": 7 * 24 * 60,              // weekly (Sun 05:00 UTC)
};
