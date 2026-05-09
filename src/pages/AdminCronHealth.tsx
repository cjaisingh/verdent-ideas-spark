import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Activity, CheckCircle2, XCircle, Clock, Moon, AlertTriangle, RefreshCw } from "lucide-react";
import ErrorGroupsPanel from "@/components/admin/ErrorGroupsPanel";
import EdgeHealthDashboard from "@/components/admin/EdgeHealthDashboard";

// Cron jobs that run as part of the overnight pipeline.
// Keep aligned with mem://features/automation.
const NIGHT_JOBS = [
  "night-agent-open",
  "night-agent-close",
  "overnight-phase-runner",
  "overnight-prequeue",
  "secrets-health-check",
  "scheduled-code-review",
  "qa-validate",
  "record-test-run",
] as const;
type Job = typeof NIGHT_JOBS[number];

type Run = {
  id: string;
  job: string;
  trigger: string;
  status: string;
  status_code: number | null;
  message: string | null;
  duration_ms: number | null;
  created_at: string;
};

type Shift = {
  id: string;
  status: string;
  started_at: string;
  ended_at: string | null;
  window_start: string;
  window_end: string;
};

const fmt = (iso: string | null) => {
  if (!iso) return "—";
  return new Date(iso).toLocaleString(undefined, {
    month: "short", day: "2-digit", hour: "2-digit", minute: "2-digit",
  });
};

const rel = (iso: string | null) => {
  if (!iso) return "—";
  const m = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
};

const isOk = (r: Run) =>
  r.status === "ok" && (r.status_code === null || r.status_code < 400);

const Card = ({ children, className = "" }: { children: React.ReactNode; className?: string }) => (
  <div className={`rounded-md border border-border bg-card p-4 ${className}`}>{children}</div>
);

const AdminCronHealth = () => {
  const [runs, setRuns] = useState<Run[]>([]);
  const [shifts, setShifts] = useState<Shift[]>([]);
  const [loading, setLoading] = useState(true);
  const [lastRefresh, setLastRefresh] = useState<Date>(new Date());

  const load = async () => {
    const since = new Date(Date.now() - 48 * 3600 * 1000).toISOString();
    const [{ data: r }, { data: s }] = await Promise.all([
      supabase
        .from("automation_runs" as any)
        .select("id, job, trigger, status, status_code, message, duration_ms, created_at")
        .in("job", NIGHT_JOBS as unknown as string[])
        .gte("created_at", since)
        .order("created_at", { ascending: false })
        .limit(500),
      supabase
        .from("night_shifts" as any)
        .select("id, status, started_at, ended_at, window_start, window_end")
        .order("started_at", { ascending: false })
        .limit(5),
    ]);
    setRuns((r as any) ?? []);
    setShifts((s as any) ?? []);
    setLastRefresh(new Date());
    setLoading(false);
  };

  useEffect(() => {
    load();
    const ch = supabase
      .channel("admin_cron_health")
      .on("postgres_changes", { event: "*", schema: "public", table: "automation_runs" }, load)
      .on("postgres_changes", { event: "*", schema: "public", table: "night_shifts" }, load)
      .subscribe();
    const t = setInterval(load, 30000);
    return () => {
      supabase.removeChannel(ch);
      clearInterval(t);
    };
  }, []);

  const lastShift = shifts[0] ?? null;

  // Per-job last-success and last-error
  const perJob = NIGHT_JOBS.map((job) => {
    const jobRuns = runs.filter((r) => r.job === job);
    const lastSuccess = jobRuns.find(isOk) ?? null;
    const lastError = jobRuns.find((r) => !isOk(r)) ?? null;
    const lastAny = jobRuns[0] ?? null;
    return { job, lastSuccess, lastError, lastAny, total: jobRuns.length };
  });

  const errors = runs.filter((r) => !isOk(r));

  return (
    <div className="p-6 space-y-4 max-w-6xl">
      <header className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold flex items-center gap-2">
            <Activity className="h-5 w-5" /> Cron health (admin)
          </h1>
          <p className="text-sm text-muted-foreground">
            Live view of the overnight automation: last successful tick per job, last shift open/close,
            and every <code>automation_runs</code> error for night jobs over the last 48 hours.
          </p>
        </div>
        <button
          onClick={load}
          className="text-xs flex items-center gap-1.5 px-2 py-1 rounded border border-border hover:bg-accent"
        >
          <RefreshCw className="h-3 w-3" /> {rel(lastRefresh.toISOString())}
        </button>
      </header>

      {/* Last shift open / close */}
      <Card>
        <div className="flex items-center gap-2 text-xs text-muted-foreground uppercase tracking-wide mb-2">
          <Moon className="h-3.5 w-3.5" /> Last night shift
        </div>
        {lastShift ? (
          <Link to="/night-shifts" className="block hover:underline">
            <div className="flex flex-wrap items-baseline gap-x-6 gap-y-1">
              <div className="flex items-center gap-2 text-sm font-medium capitalize">
                {lastShift.status === "completed" && <CheckCircle2 className="h-4 w-4 text-emerald-600" />}
                {lastShift.status === "running" && <Clock className="h-4 w-4 text-blue-600 animate-pulse" />}
                {(lastShift.status === "aborted" || lastShift.status === "failed") && (
                  <XCircle className="h-4 w-4 text-destructive" />
                )}
                {lastShift.status}
              </div>
              <div className="text-xs font-mono text-muted-foreground">
                opened <span className="text-foreground">{fmt(lastShift.started_at)}</span>{" "}
                ({rel(lastShift.started_at)})
              </div>
              <div className="text-xs font-mono text-muted-foreground">
                closed <span className="text-foreground">{fmt(lastShift.ended_at)}</span>
                {lastShift.ended_at ? ` (${rel(lastShift.ended_at)})` : ""}
              </div>
              <div className="text-xs font-mono text-muted-foreground">
                window {fmt(lastShift.window_start)} → {fmt(lastShift.window_end)}
              </div>
            </div>
          </Link>
        ) : loading ? (
          <div className="text-sm text-muted-foreground">Loading…</div>
        ) : (
          <div className="text-sm text-muted-foreground">No shifts recorded.</div>
        )}
      </Card>

      {/* Per-job last successful tick */}
      <Card>
        <div className="flex items-center gap-2 text-xs text-muted-foreground uppercase tracking-wide mb-3">
          <CheckCircle2 className="h-3.5 w-3.5" /> Last successful tick (per job)
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="text-left text-muted-foreground">
              <tr className="border-b border-border">
                <th className="py-1.5 pr-3 font-medium">Job</th>
                <th className="py-1.5 pr-3 font-medium">Last success</th>
                <th className="py-1.5 pr-3 font-medium">Last error</th>
                <th className="py-1.5 pr-3 font-medium">Last run</th>
                <th className="py-1.5 pr-3 font-medium text-right">Runs (48h)</th>
              </tr>
            </thead>
            <tbody>
              {perJob.map(({ job, lastSuccess, lastError, lastAny, total }) => {
                const stale = !lastSuccess || (Date.now() - new Date(lastSuccess.created_at).getTime()) > 24 * 3600 * 1000;
                return (
                  <tr key={job} className="border-b border-border last:border-0">
                    <td className="py-1.5 pr-3 font-mono text-foreground">{job}</td>
                    <td className="py-1.5 pr-3 font-mono">
                      {lastSuccess ? (
                        <span className={stale ? "text-amber-600 dark:text-amber-400" : "text-emerald-600 dark:text-emerald-400"}>
                          {rel(lastSuccess.created_at)}
                        </span>
                      ) : (
                        <span className="text-destructive">never</span>
                      )}
                    </td>
                    <td className="py-1.5 pr-3 font-mono">
                      {lastError ? (
                        <span className="text-destructive">{rel(lastError.created_at)}</span>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </td>
                    <td className="py-1.5 pr-3 font-mono text-muted-foreground">
                      {lastAny ? `${rel(lastAny.created_at)} · ${lastAny.status_code ?? lastAny.status}` : "—"}
                    </td>
                    <td className="py-1.5 pr-3 font-mono text-muted-foreground text-right tabular-nums">{total}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>

      {/* Errors grouped by job + likely cause */}
      <Card>
        <div className="flex items-center gap-2 text-xs text-muted-foreground uppercase tracking-wide mb-2">
          <AlertTriangle className="h-3.5 w-3.5" /> Night job errors (48h) — grouped
          <span className={`ml-auto font-mono tabular-nums ${errors.length > 0 ? "text-destructive" : "text-muted-foreground"}`}>
            {errors.length}
          </span>
        </div>
        <p className="text-[11px] text-muted-foreground mb-2">
          Click a job to see distinct failure causes; click a cause for the diagnosis and matching runs.
        </p>
        <ErrorGroupsPanel errors={errors} />
      </Card>

      {/* Recent shifts */}
      {shifts.length > 1 && (
        <Card>
          <div className="flex items-center gap-2 text-xs text-muted-foreground uppercase tracking-wide mb-2">
            <Moon className="h-3.5 w-3.5" /> Recent shifts
          </div>
          <ul className="divide-y divide-border text-xs">
            {shifts.map((s) => (
              <li key={s.id} className="py-1.5 flex items-center gap-3">
                <span className="font-mono shrink-0 capitalize">{s.status}</span>
                <span className="font-mono text-muted-foreground">opened {fmt(s.started_at)}</span>
                <span className="font-mono text-muted-foreground">closed {fmt(s.ended_at)}</span>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
};

export default AdminCronHealth;
