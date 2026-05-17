import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Activity, CheckCircle2, XCircle, Clock, AlertTriangle, RefreshCw } from "lucide-react";

// Cron jobs we cross-check. Both pg_cron AND automation_runs must show a
// recent success for a job to be "green".
const TRACKED_JOBS: { name: string; cadenceMin: number }[] = [
  { name: "scheduled-sentinel-tick", cadenceMin: 15 },
  { name: "overnight-phase-runner-15m", cadenceMin: 15 },
  { name: "scheduled-tomorrow-plan-refresh", cadenceMin: 15 },
  { name: "ci-status-sync-30m", cadenceMin: 30 },
  { name: "scheduled-morning-review", cadenceMin: 1440 },
  { name: "scheduled-overnight-recommender", cadenceMin: 1440 },
  { name: "overnight-prequeue", cadenceMin: 1440 },
  { name: "night-agent-open", cadenceMin: 1440 },
  { name: "night-agent-close", cadenceMin: 1440 },
  { name: "scheduled-app-walkthrough", cadenceMin: 1440 },
  { name: "scheduled-lessons-daily", cadenceMin: 1440 },
  { name: "scheduled-awip-reviews-pull", cadenceMin: 10080 },
  { name: "scheduled-lessons-weekly", cadenceMin: 10080 },
  { name: "scheduled-deep-audit-weekly", cadenceMin: 10080 },
];

type CronRow = {
  jobname: string;
  schedule: string;
  active: boolean;
  last_status: string | null;
  last_start: string | null;
  last_end: string | null;
};

type AutoRow = {
  job: string;
  status: string;
  status_code: number | null;
  created_at: string;
};

type PhaseRun = {
  id: string;
  status: string;
  scheduled_for: string;
  requested_at: string;
  finished_at: string | null;
  phase_key: string;
};

const rel = (iso: string | null) => {
  if (!iso) return "—";
  const m = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
};

// Tonight = current UTC date if hour >= 22, otherwise the date that just ended this morning
const tonightUTC = () => {
  const now = new Date();
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  if (now.getUTCHours() < 6) d.setUTCDate(d.getUTCDate() - 1);
  return d;
};
const toISODate = (d: Date) => d.toISOString().slice(0, 10);

const STATUS_COLORS: Record<string, string> = {
  queued: "bg-blue-500/60",
  running: "bg-amber-500",
  done: "bg-emerald-500",
  failed: "bg-destructive",
  auto_blocked: "bg-destructive/70",
  cancelled: "bg-muted-foreground/40",
};

const RuntimeHealthWidget = () => {
  const [cronRows, setCronRows] = useState<CronRow[]>([]);
  const [autoRows, setAutoRows] = useState<AutoRow[]>([]);
  const [phaseRuns, setPhaseRuns] = useState<PhaseRun[]>([]);
  const [loading, setLoading] = useState(true);
  const [lastRefresh, setLastRefresh] = useState<Date>(new Date());

  const loadCron = async () => {
    const jobNames = TRACKED_JOBS.map((j) => j.name);
    const sinceAuto = new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString();
    const [{ data: cron }, { data: auto }] = await Promise.all([
      supabase.rpc("runtime_cron_status", { _jobnames: jobNames }),
      supabase
        .from("automation_runs" as any)
        .select("job, status, status_code, created_at")
        .in("job", jobNames)
        .gte("created_at", sinceAuto)
        .order("created_at", { ascending: false })
        .limit(1000),
    ]);
    setCronRows((cron as any) ?? []);
    setAutoRows((auto as any) ?? []);
    setLastRefresh(new Date());
    setLoading(false);
  };

  const loadPhases = async () => {
    // 8 nights of phase runs (7 prior + tonight)
    const since = new Date(Date.now() - 8 * 24 * 3600 * 1000).toISOString();
    const { data } = await supabase
      .from("roadmap_phase_overnight_runs" as any)
      .select("id, status, scheduled_for, requested_at, finished_at, phase_key")
      .gte("requested_at", since)
      .order("requested_at", { ascending: false })
      .limit(500);
    setPhaseRuns((data as any) ?? []);
  };

  useEffect(() => {
    loadCron();
    loadPhases();
    // Hybrid: realtime phase runs, polling for cron.
    const ch = supabase
      .channel("runtime_health_widget_phase_runs")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "roadmap_phase_overnight_runs" },
        loadPhases,
      )
      .subscribe();
    const t = setInterval(loadCron, 60_000);
    return () => {
      supabase.removeChannel(ch);
      clearInterval(t);
    };
  }, []);

  // Cross-check per tracked job
  const jobHealth = useMemo(() => {
    return TRACKED_JOBS.map(({ name, cadenceMin }) => {
      const cron = cronRows.find((r) => r.jobname === name);
      const lastAutoOk = autoRows.find(
        (r) => r.job === name && r.status === "ok" && (r.status_code === null || r.status_code < 400),
      );
      const windowMs = cadenceMin * 2 * 60_000;
      const cronOk =
        !!cron &&
        cron.active &&
        cron.last_status === "succeeded" &&
        !!cron.last_end &&
        Date.now() - new Date(cron.last_end).getTime() < windowMs;
      const autoOk =
        !!lastAutoOk && Date.now() - new Date(lastAutoOk.created_at).getTime() < windowMs;
      let band: "green" | "amber" | "red";
      if (cronOk && autoOk) band = "green";
      else if (!cron || !cron.active) band = "red";
      else band = "amber";
      return { name, cadenceMin, cron, lastAutoOk, cronOk, autoOk, band };
    });
  }, [cronRows, autoRows]);

  const reds = jobHealth.filter((j) => j.band === "red").length;
  const ambers = jobHealth.filter((j) => j.band === "amber").length;

  // Phase runs by night
  const phasesByNight = useMemo(() => {
    const nights: { date: string; counts: Record<string, number>; total: number; isTonight: boolean }[] = [];
    const tonight = tonightUTC();
    for (let i = 7; i >= 0; i--) {
      const d = new Date(tonight);
      d.setUTCDate(d.getUTCDate() - i);
      const iso = toISODate(d);
      const rows = phaseRuns.filter((r) => r.scheduled_for === iso);
      const counts: Record<string, number> = {};
      rows.forEach((r) => {
        counts[r.status] = (counts[r.status] ?? 0) + 1;
      });
      nights.push({ date: iso, counts, total: rows.length, isTonight: i === 0 });
    }
    return nights;
  }, [phaseRuns]);

  const tonightNight = phasesByNight[phasesByNight.length - 1];
  const tonightRuns = phaseRuns.filter((r) => r.scheduled_for === tonightNight?.date);

  const STATUSES = ["queued", "running", "done", "failed", "auto_blocked", "cancelled"];

  return (
    <div className="rounded-md border border-border bg-card p-4 space-y-4">
      <header className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-sm font-semibold flex items-center gap-2 uppercase tracking-wide text-muted-foreground">
            <Activity className="h-3.5 w-3.5" /> Runtime health
          </h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            Cron ticks (pg_cron <span className="font-mono">AND</span> automation_runs must agree) ·
            Phase runs tonight + 7-night history.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {reds > 0 && (
            <span className="text-xs px-2 py-0.5 rounded bg-destructive/15 text-destructive font-mono">
              {reds} red
            </span>
          )}
          {ambers > 0 && (
            <span className="text-xs px-2 py-0.5 rounded bg-amber-500/15 text-amber-700 dark:text-amber-400 font-mono">
              {ambers} amber
            </span>
          )}
          {reds === 0 && ambers === 0 && !loading && (
            <span className="text-xs px-2 py-0.5 rounded bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 font-mono">
              all green
            </span>
          )}
          <button
            onClick={() => {
              loadCron();
              loadPhases();
            }}
            className="text-xs flex items-center gap-1 px-2 py-0.5 rounded border border-border hover:bg-accent"
          >
            <RefreshCw className="h-3 w-3" /> {rel(lastRefresh.toISOString())}
          </button>
        </div>
      </header>

      {/* Cron grid */}
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead className="text-left text-muted-foreground">
            <tr className="border-b border-border">
              <th className="py-1.5 pr-3 font-medium">Job</th>
              <th className="py-1.5 pr-3 font-medium">Cadence</th>
              <th className="py-1.5 pr-3 font-medium">pg_cron</th>
              <th className="py-1.5 pr-3 font-medium">automation_runs</th>
              <th className="py-1.5 pr-3 font-medium text-right">Status</th>
            </tr>
          </thead>
          <tbody>
            {jobHealth.map((j) => (
              <tr key={j.name} className="border-b border-border last:border-0">
                <td className="py-1.5 pr-3 font-mono">{j.name}</td>
                <td className="py-1.5 pr-3 font-mono text-muted-foreground">
                  {j.cadenceMin < 60
                    ? `${j.cadenceMin}m`
                    : j.cadenceMin < 1440
                    ? `${j.cadenceMin / 60}h`
                    : j.cadenceMin === 1440
                    ? "daily"
                    : `${j.cadenceMin / 1440}d`}
                </td>
                <td className="py-1.5 pr-3 font-mono">
                  {!j.cron ? (
                    <span className="text-destructive">missing</span>
                  ) : !j.cron.active ? (
                    <span className="text-destructive">disabled</span>
                  ) : j.cronOk ? (
                    <span className="text-emerald-600 dark:text-emerald-400">{rel(j.cron.last_end)}</span>
                  ) : (
                    <span className="text-amber-600 dark:text-amber-400">
                      {j.cron.last_end ? rel(j.cron.last_end) : "never"}
                      {j.cron.last_status && j.cron.last_status !== "succeeded"
                        ? ` · ${j.cron.last_status}`
                        : ""}
                    </span>
                  )}
                </td>
                <td className="py-1.5 pr-3 font-mono">
                  {j.autoOk ? (
                    <span className="text-emerald-600 dark:text-emerald-400">
                      {rel(j.lastAutoOk!.created_at)}
                    </span>
                  ) : j.lastAutoOk ? (
                    <span className="text-amber-600 dark:text-amber-400">
                      {rel(j.lastAutoOk.created_at)} (stale)
                    </span>
                  ) : (
                    <span className="text-destructive">none in 7d</span>
                  )}
                </td>
                <td className="py-1.5 pr-3 text-right">
                  {j.band === "green" && <CheckCircle2 className="h-4 w-4 text-emerald-600 inline" />}
                  {j.band === "amber" && <AlertTriangle className="h-4 w-4 text-amber-500 inline" />}
                  {j.band === "red" && <XCircle className="h-4 w-4 text-destructive inline" />}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Phase runs */}
      <div>
        <div className="flex items-center gap-2 text-xs text-muted-foreground uppercase tracking-wide mb-2">
          <Clock className="h-3.5 w-3.5" /> Overnight phase runs · tonight + last 7 nights
        </div>

        {/* Tonight */}
        <div className="rounded border border-border p-2 mb-2 bg-background/50">
          <div className="text-xs font-medium mb-1.5">
            Tonight ({tonightNight?.date})
            <span className="ml-2 font-mono text-muted-foreground">
              {tonightNight?.total ?? 0} run{(tonightNight?.total ?? 0) === 1 ? "" : "s"}
            </span>
          </div>
          {tonightRuns.length === 0 ? (
            <div className="text-xs text-muted-foreground italic">No phases queued for tonight.</div>
          ) : (
            <ul className="text-xs divide-y divide-border">
              {tonightRuns.slice(0, 8).map((r) => (
                <li key={r.id} className="py-1 flex items-center gap-2 font-mono">
                  <span
                    className={`inline-block h-2 w-2 rounded-full ${STATUS_COLORS[r.status] ?? "bg-muted-foreground/40"}`}
                  />
                  <span className="capitalize w-20">{r.status}</span>
                  <span className="text-muted-foreground">{r.phase_key}</span>
                  <span className="ml-auto text-muted-foreground">
                    {r.finished_at ? `done ${rel(r.finished_at)}` : `req ${rel(r.requested_at)}`}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* 8-night sparkline grid */}
        <div className="grid grid-cols-8 gap-1">
          {phasesByNight.map((n) => {
            const max = Math.max(1, ...phasesByNight.map((x) => x.total));
            const h = Math.max(4, Math.round((n.total / max) * 36));
            return (
              <div key={n.date} className="flex flex-col items-center gap-1">
                <div className="h-10 flex items-end w-full">
                  <div className="w-full flex flex-col-reverse rounded overflow-hidden border border-border" style={{ height: `${h}px` }}>
                    {STATUSES.map((s) =>
                      n.counts[s] ? (
                        <div
                          key={s}
                          className={STATUS_COLORS[s]}
                          style={{ flex: n.counts[s] }}
                          title={`${s}: ${n.counts[s]}`}
                        />
                      ) : null,
                    )}
                  </div>
                </div>
                <div className={`text-[10px] font-mono ${n.isTonight ? "text-foreground font-semibold" : "text-muted-foreground"}`}>
                  {n.date.slice(5)}
                </div>
                <div className="text-[10px] font-mono text-muted-foreground tabular-nums">{n.total}</div>
              </div>
            );
          })}
        </div>

        {/* Legend */}
        <div className="flex flex-wrap gap-3 mt-2 text-[10px] font-mono text-muted-foreground">
          {STATUSES.map((s) => (
            <span key={s} className="flex items-center gap-1">
              <span className={`inline-block h-2 w-2 rounded-full ${STATUS_COLORS[s]}`} />
              {s}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
};

export default RuntimeHealthWidget;
