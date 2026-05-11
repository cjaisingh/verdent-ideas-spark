import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Activity, AlertTriangle, CheckCircle2, XCircle, ChevronLeft, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

// Jobs that run within the night window (22:00–06:00 UTC) or are
// part of the overnight automation pipeline.
const NIGHT_JOBS = [
  "night-agent-open",
  "night-agent-close",
  "overnight-phase-runner-15m",
  "overnight-prequeue",
  "overnight-recommender",
  "scheduled-deep-audit-weekly",
  "scheduled-deep-audit-monthly",
  "deep-audit",
  "scheduled-app-walkthrough",
  "scheduled-lessons-weekly",
  "lessons-synthesize",
  "scheduled-morning-review",
  "morning-review",
  "tomorrow-plan-refresh",
  "nightly-rollup-analytics",
  "snapshot-daily-report",
  "ingest-external-data",
  "cache-warm",
  "awip-reviews-pull",
];

// Keys in automation_runs.detail that count "rows written" by a job.
const WRITTEN_KEYS = [
  "written", "inserted", "updated", "items", "items_updated",
  "rows_deleted", "candidates", "alerts", "synthesized", "promoted",
  "queued", "ingested", "warmed", "exported",
];

type Run = {
  id: string;
  job: string;
  trigger: string;
  status: string;
  status_code: number | null;
  message: string | null;
  duration_ms: number | null;
  created_at: string;
  detail: Record<string, any>;
};

const dayKey = (iso: string) => iso.slice(0, 10);

const sumWritten = (detail: Record<string, any> | null | undefined) => {
  if (!detail || typeof detail !== "object") return 0;
  let total = 0;
  for (const k of WRITTEN_KEYS) {
    const v = detail[k];
    if (typeof v === "number" && Number.isFinite(v)) total += v;
  }
  return total;
};

const isError = (r: Run) =>
  r.status !== "ok" || (r.status_code !== null && r.status_code >= 400);

const fmt = (iso: string) =>
  new Date(iso).toLocaleString(undefined, {
    month: "short", day: "2-digit", hour: "2-digit", minute: "2-digit",
  });

const OvernightActivity = () => {
  const [runs, setRuns] = useState<Run[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = async () => {
    setRefreshing(true);
    const since = new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString();
    const { data } = await supabase
      .from("automation_runs" as any)
      .select("id, job, trigger, status, status_code, message, duration_ms, created_at, detail")
      .in("job", NIGHT_JOBS)
      .gte("created_at", since)
      .order("created_at", { ascending: false })
      .limit(2000);
    setRuns(((data as unknown) as Run[]) ?? []);
    setLoading(false);
    setRefreshing(false);
  };

  useEffect(() => {
    load();
    const ch = supabase
      .channel(`overnight_activity_${Math.random().toString(36).slice(2, 8)}`)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "automation_runs" }, load)
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, []);

  const totals = useMemo(() => {
    const errors = runs.filter(isError).length;
    const written = runs.reduce((acc, r) => acc + sumWritten(r.detail), 0);
    return { runs: runs.length, errors, written };
  }, [runs]);

  const perJob = useMemo(() => {
    const m = new Map<string, {
      job: string; total: number; ok: number; errors: number;
      written: number; lastRun: string | null; lastStatus: string;
      avgMs: number;
    }>();
    for (const r of runs) {
      const cur = m.get(r.job) ?? {
        job: r.job, total: 0, ok: 0, errors: 0, written: 0,
        lastRun: null, lastStatus: "ok", avgMs: 0,
      };
      cur.total++;
      if (isError(r)) cur.errors++; else cur.ok++;
      cur.written += sumWritten(r.detail);
      if (!cur.lastRun || r.created_at > cur.lastRun) {
        cur.lastRun = r.created_at;
        cur.lastStatus = isError(r) ? "error" : "ok";
      }
      cur.avgMs += r.duration_ms ?? 0;
      m.set(r.job, cur);
    }
    return Array.from(m.values())
      .map((j) => ({ ...j, avgMs: j.total ? Math.round(j.avgMs / j.total) : 0 }))
      .sort((a, b) => b.errors - a.errors || b.total - a.total);
  }, [runs]);

  const perDay = useMemo(() => {
    const m = new Map<string, { day: string; total: number; errors: number; written: number }>();
    for (const r of runs) {
      const d = dayKey(r.created_at);
      const cur = m.get(d) ?? { day: d, total: 0, errors: 0, written: 0 };
      cur.total++;
      if (isError(r)) cur.errors++;
      cur.written += sumWritten(r.detail);
      m.set(d, cur);
    }
    // Always emit 7 buckets ending today
    const out: { day: string; total: number; errors: number; written: number }[] = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date(Date.now() - i * 24 * 3600 * 1000).toISOString().slice(0, 10);
      out.push(m.get(d) ?? { day: d, total: 0, errors: 0, written: 0 });
    }
    return out;
  }, [runs]);

  const recentErrors = useMemo(() => runs.filter(isError).slice(0, 50), [runs]);

  const maxDayTotal = Math.max(1, ...perDay.map((d) => d.total));

  return (
    <div className="p-6 space-y-4 max-w-6xl">
      <div>
        <Link to="/overnight" className="text-xs text-muted-foreground hover:text-foreground inline-flex items-center gap-1">
          <ChevronLeft className="h-3 w-3" /> Overnight overview
        </Link>
        <div className="flex items-center justify-between mt-2">
          <div>
            <h1 className="text-2xl font-semibold flex items-center gap-2">
              <Activity className="h-5 w-5" /> Overnight activity (7 days)
            </h1>
            <p className="text-sm text-muted-foreground">
              Per-pipeline run counts, rows written, and errors across the overnight automation.
            </p>
          </div>
          <Button size="sm" variant="outline" onClick={load} disabled={refreshing} className="gap-1.5">
            <RefreshCw className={`h-3.5 w-3.5 ${refreshing ? "animate-spin" : ""}`} /> Refresh
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <div className="rounded-md border border-border bg-card p-4">
          <div className="text-xs uppercase text-muted-foreground tracking-wide">Total runs</div>
          <div className="text-3xl font-semibold tabular-nums mt-1">{totals.runs}</div>
        </div>
        <div className="rounded-md border border-border bg-card p-4">
          <div className="text-xs uppercase text-muted-foreground tracking-wide">Rows written</div>
          <div className="text-3xl font-semibold tabular-nums mt-1">{totals.written.toLocaleString()}</div>
          <div className="text-[11px] text-muted-foreground mt-1 font-mono">
            sum of detail.{WRITTEN_KEYS.slice(0, 4).join(", ")}…
          </div>
        </div>
        <div className="rounded-md border border-border bg-card p-4">
          <div className="text-xs uppercase text-muted-foreground tracking-wide">Errors</div>
          <div className={`text-3xl font-semibold tabular-nums mt-1 ${totals.errors > 0 ? "text-destructive" : ""}`}>
            {totals.errors}
          </div>
        </div>
      </div>

      {/* Per-day strip */}
      <div className="rounded-md border border-border bg-card p-4">
        <div className="text-xs uppercase text-muted-foreground tracking-wide mb-3">Daily activity</div>
        <div className="flex items-end gap-2 h-32">
          {perDay.map((d) => {
            const h = Math.max(4, Math.round((d.total / maxDayTotal) * 100));
            const errPct = d.total ? (d.errors / d.total) * 100 : 0;
            return (
              <div key={d.day} className="flex-1 flex flex-col items-center gap-1">
                <div className="w-full bg-muted rounded-t flex flex-col-reverse overflow-hidden" style={{ height: `${h}%` }}>
                  {errPct > 0 && (
                    <div className="bg-destructive w-full" style={{ height: `${errPct}%` }} title={`${d.errors} errors`} />
                  )}
                  <div className="bg-primary/70 w-full flex-1" title={`${d.total - d.errors} ok`} />
                </div>
                <div className="text-[10px] font-mono text-muted-foreground">{d.day.slice(5)}</div>
                <div className="text-[10px] tabular-nums">{d.total}</div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Per-job table */}
      <div className="rounded-md border border-border bg-card">
        <div className="px-4 py-3 border-b border-border text-xs uppercase text-muted-foreground tracking-wide">
          Per pipeline (last 7 days)
        </div>
        {loading ? (
          <div className="p-4 text-sm text-muted-foreground">Loading…</div>
        ) : perJob.length === 0 ? (
          <div className="p-4 text-sm text-muted-foreground">No overnight pipeline runs in the last 7 days.</div>
        ) : (
          <table className="w-full text-xs">
            <thead className="text-[10px] uppercase text-muted-foreground bg-muted/50">
              <tr>
                <th className="text-left px-4 py-2">Job</th>
                <th className="text-right px-2 py-2">Runs</th>
                <th className="text-right px-2 py-2">OK</th>
                <th className="text-right px-2 py-2">Errors</th>
                <th className="text-right px-2 py-2">Rows written</th>
                <th className="text-right px-2 py-2">Avg ms</th>
                <th className="text-left px-4 py-2">Last run</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {perJob.map((j) => (
                <tr key={j.job} className="hover:bg-muted/30">
                  <td className="px-4 py-2 font-mono">{j.job}</td>
                  <td className="px-2 py-2 text-right tabular-nums">{j.total}</td>
                  <td className="px-2 py-2 text-right tabular-nums text-emerald-600 dark:text-emerald-400">{j.ok}</td>
                  <td className={`px-2 py-2 text-right tabular-nums ${j.errors > 0 ? "text-destructive font-semibold" : "text-muted-foreground"}`}>
                    {j.errors}
                  </td>
                  <td className="px-2 py-2 text-right tabular-nums">{j.written.toLocaleString()}</td>
                  <td className="px-2 py-2 text-right tabular-nums text-muted-foreground">{j.avgMs.toLocaleString()}</td>
                  <td className="px-4 py-2 font-mono text-muted-foreground flex items-center gap-1.5">
                    {j.lastStatus === "ok"
                      ? <CheckCircle2 className="h-3 w-3 text-emerald-600" />
                      : <XCircle className="h-3 w-3 text-destructive" />}
                    {j.lastRun ? fmt(j.lastRun) : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Recent errors */}
      <div className="rounded-md border border-border bg-card">
        <div className="px-4 py-3 border-b border-border text-xs uppercase text-muted-foreground tracking-wide flex items-center gap-2">
          <AlertTriangle className="h-3.5 w-3.5" /> Errors (last 7 days)
          <Badge variant={recentErrors.length > 0 ? "destructive" : "outline"} className="ml-auto text-[10px]">
            {recentErrors.length}
          </Badge>
        </div>
        {recentErrors.length === 0 ? (
          <div className="p-4 text-sm text-muted-foreground">No errors. Quiet nights.</div>
        ) : (
          <ul className="divide-y divide-border text-xs">
            {recentErrors.map((r) => (
              <li key={r.id} className="px-4 py-2 flex items-start gap-2">
                <XCircle className="h-3.5 w-3.5 text-destructive shrink-0 mt-0.5" />
                <span className="font-mono text-muted-foreground shrink-0">{fmt(r.created_at)}</span>
                <span className="font-mono text-foreground shrink-0">{r.job}</span>
                <span className="font-mono text-[10px] px-1.5 rounded border border-border text-muted-foreground shrink-0">
                  {r.trigger}
                </span>
                <span className="font-mono text-destructive shrink-0">{r.status_code ?? r.status}</span>
                <span className="text-foreground/90 truncate">{r.message ?? "(no message)"}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
};

export default OvernightActivity;
