// Live status panel for background jobs.
// - Top: jobs currently running (or just finished) in the last 6h with ETA + overdue flag.
// - Click row → drawer showing per-step timeline + edge log tail (joined by request_id).

import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { RefreshCcw, Loader2, CheckCircle2, XCircle, AlertTriangle } from "lucide-react";

type RunRow = {
  run_id: string;
  job: string;
  trigger: string | null;
  status: string;
  status_code: number | null;
  started_at: string;
  duration_ms: number | null;
  request_id: string | null;
  message: string | null;
  detail: Record<string, unknown> | null;
  elapsed_ms: number;
};

type EtaRow = { job: string; samples: number; median_ms: number; p95_ms: number; max_ms: number };

type StepRow = {
  id: string;
  job: string;
  step_key: string;
  step_label: string;
  phase_kind: string;
  status: "running" | "ok" | "error" | "skipped";
  started_at: string;
  finished_at: string | null;
  duration_ms: number | null;
  detail: Record<string, unknown> | null;
  request_id: string | null;
};

type LogRow = {
  id: string;
  created_at: string;
  status: number | null;
  latency_ms: number | null;
  classified_error: string | null;
  error_message: string | null;
  method: string | null;
  path: string | null;
  meta: Record<string, unknown> | null;
};

function fmtMs(ms: number | null | undefined): string {
  if (ms == null) return "—";
  if (ms < 1000) return `${Math.round(ms)}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  return `${(ms / 60_000).toFixed(1)}m`;
}

function fmtTime(iso: string): string {
  return new Date(iso).toLocaleTimeString(undefined, { hour12: false });
}

function StatusBadge({ status, code }: { status: string; code?: number | null }) {
  const map: Record<string, string> = {
    running: "bg-sky-500/15 text-sky-300 border-sky-500/30",
    ok: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30",
    error: "bg-red-500/15 text-red-300 border-red-500/30",
    rejected: "bg-amber-500/15 text-amber-300 border-amber-500/30",
    skipped: "bg-muted text-muted-foreground border-border",
  };
  const cls = map[status] ?? map.skipped;
  return (
    <Badge variant="outline" className={cls}>
      {status === "running" && <Loader2 className="h-3 w-3 mr-1 animate-spin" />}
      {status === "ok" && <CheckCircle2 className="h-3 w-3 mr-1" />}
      {status === "error" && <XCircle className="h-3 w-3 mr-1" />}
      {status}{code ? ` ${code}` : ""}
    </Badge>
  );
}

export default function AdminJobs() {
  const [runs, setRuns] = useState<RunRow[]>([]);
  const [etas, setEtas] = useState<Record<string, EtaRow>>({});
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<"all" | "cron" | "errored">("all");
  const [openRun, setOpenRun] = useState<RunRow | null>(null);
  const [tick, setTick] = useState(0);

  const load = async () => {
    setLoading(true);
    const [runsR, etaR] = await Promise.all([
      supabase.from("v_jobs_recent").select("*").order("started_at", { ascending: false }).limit(200),
      supabase.from("v_job_eta_baseline").select("*"),
    ]);
    if (runsR.data) setRuns(runsR.data as RunRow[]);
    if (etaR.data) {
      const m: Record<string, EtaRow> = {};
      for (const r of etaR.data as EtaRow[]) m[r.job] = r;
      setEtas(m);
    }
    setLoading(false);
  };

  useEffect(() => {
    load();
    const ch = supabase
      .channel(`admin-jobs-${crypto.randomUUID()}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "automation_runs" }, () => load())
      .on("postgres_changes", { event: "*", schema: "public", table: "automation_steps" }, () => setTick((t) => t + 1))
      .subscribe();
    const iv = setInterval(() => setTick((t) => t + 1), 5000);
    return () => {
      supabase.removeChannel(ch);
      clearInterval(iv);
    };
  }, []);

  // tick used to refresh live elapsed/ETA in render
  void tick;

  const filtered = useMemo(() => {
    return runs.filter((r) => {
      if (filter === "cron" && r.trigger !== "cron") return false;
      if (filter === "errored" && r.status === "ok") return false;
      return true;
    });
  }, [runs, filter]);

  const running = filtered.filter((r) => r.status === "running");
  const finished = filtered.filter((r) => r.status !== "running");

  const etaFor = (r: RunRow): { remainMs: number; overdue: boolean; baseline?: EtaRow } => {
    const b = etas[r.job];
    if (!b) return { remainMs: 0, overdue: false };
    const liveElapsed = Date.now() - new Date(r.started_at).getTime();
    const elapsed = r.status === "running" ? liveElapsed : (r.duration_ms ?? liveElapsed);
    const remain = Math.max(0, b.median_ms - elapsed);
    const overdue = elapsed > b.p95_ms;
    return { remainMs: remain, overdue, baseline: b };
  };

  return (
    <div className="min-h-screen bg-background text-foreground p-6 space-y-6">
      <header className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Background Jobs</h1>
          <p className="text-sm text-muted-foreground">
            Last 6h. ETA from 30-day median duration; overdue past p95.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <ToggleGroup type="single" value={filter} onValueChange={(v) => v && setFilter(v as typeof filter)}>
            <ToggleGroupItem value="all">All</ToggleGroupItem>
            <ToggleGroupItem value="cron">Cron only</ToggleGroupItem>
            <ToggleGroupItem value="errored">Errored</ToggleGroupItem>
          </ToggleGroup>
          <Button variant="outline" size="sm" onClick={load} disabled={loading}>
            <RefreshCcw className="h-4 w-4 mr-1" /> Refresh
          </Button>
        </div>
      </header>

      <section>
        <h2 className="text-sm font-medium text-muted-foreground mb-2">
          Running now ({running.length})
        </h2>
        {running.length === 0 ? (
          <Card><CardContent className="py-6 text-sm text-muted-foreground">No jobs running.</CardContent></Card>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {running.map((r) => {
              const { remainMs, overdue, baseline } = etaFor(r);
              const liveElapsed = Date.now() - new Date(r.started_at).getTime();
              return (
                <Card key={r.run_id} className="cursor-pointer hover:border-primary/40 transition" onClick={() => setOpenRun(r)}>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-base flex items-center justify-between gap-2">
                      <span className="font-mono text-sm truncate">{r.job}</span>
                      <StatusBadge status={r.status} />
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="pt-0 text-sm space-y-1">
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Elapsed</span>
                      <span className="font-mono">{fmtMs(liveElapsed)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">ETA</span>
                      {overdue ? (
                        <span className="font-mono text-red-300 inline-flex items-center gap-1">
                          <AlertTriangle className="h-3 w-3" /> overdue (p95 {fmtMs(baseline?.p95_ms)})
                        </span>
                      ) : baseline ? (
                        <span className="font-mono">~{fmtMs(remainMs)} left</span>
                      ) : (
                        <span className="text-muted-foreground">no baseline</span>
                      )}
                    </div>
                    <div className="text-xs text-muted-foreground truncate">{r.trigger ?? "—"} · started {fmtTime(r.started_at)}</div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </section>

      <section>
        <h2 className="text-sm font-medium text-muted-foreground mb-2">
          Recent ({finished.length})
        </h2>
        <Card>
          <CardContent className="p-0">
            <table className="w-full text-sm">
              <thead className="text-xs text-muted-foreground border-b border-border">
                <tr>
                  <th className="text-left p-2 font-medium">Job</th>
                  <th className="text-left p-2 font-medium">Trigger</th>
                  <th className="text-left p-2 font-medium">Started</th>
                  <th className="text-right p-2 font-medium">Duration</th>
                  <th className="text-left p-2 font-medium">Status</th>
                  <th className="text-left p-2 font-medium">Message</th>
                </tr>
              </thead>
              <tbody>
                {finished.slice(0, 100).map((r) => {
                  const b = etas[r.job];
                  const overdue = b && r.duration_ms != null && r.duration_ms > b.p95_ms;
                  return (
                    <tr key={r.run_id} className="border-b border-border hover:bg-muted/30 cursor-pointer" onClick={() => setOpenRun(r)}>
                      <td className="p-2 font-mono text-xs">{r.job}</td>
                      <td className="p-2 text-xs text-muted-foreground">{r.trigger ?? "—"}</td>
                      <td className="p-2 text-xs font-mono">{fmtTime(r.started_at)}</td>
                      <td className="p-2 text-right font-mono text-xs">
                        {fmtMs(r.duration_ms)}
                        {overdue && <AlertTriangle className="h-3 w-3 inline ml-1 text-amber-400" />}
                      </td>
                      <td className="p-2"><StatusBadge status={r.status} code={r.status_code} /></td>
                      <td className="p-2 text-xs text-muted-foreground truncate max-w-[24rem]">{r.message ?? ""}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </CardContent>
        </Card>
      </section>

      <RunDrawer run={openRun} baseline={openRun ? etas[openRun.job] : undefined} onClose={() => setOpenRun(null)} />
    </div>
  );
}

function RunDrawer({ run, baseline, onClose }: { run: RunRow | null; baseline?: EtaRow; onClose: () => void }) {
  const [steps, setSteps] = useState<StepRow[]>([]);
  const [logs, setLogs] = useState<LogRow[]>([]);
  const [logsFuzzy, setLogsFuzzy] = useState(false);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!run) { setSteps([]); setLogs([]); return; }
    setLoading(true);
    (async () => {
      // Steps — prefer request_id; fall back to (job + started_at window).
      let stepRows: StepRow[] = [];
      if (run.request_id) {
        const r = await supabase
          .from("automation_steps")
          .select("*")
          .eq("request_id", run.request_id)
          .order("started_at", { ascending: true })
          .limit(500);
        stepRows = (r.data as StepRow[]) ?? [];
      }
      if (stepRows.length === 0) {
        const startMs = new Date(run.started_at).getTime();
        const endMs = startMs + (run.duration_ms ?? Date.now() - startMs) + 60_000;
        const r = await supabase
          .from("automation_steps")
          .select("*")
          .eq("job", run.job)
          .gte("started_at", new Date(startMs - 1000).toISOString())
          .lte("started_at", new Date(endMs).toISOString())
          .order("started_at", { ascending: true })
          .limit(500);
        stepRows = (r.data as StepRow[]) ?? [];
      }
      setSteps(stepRows);

      // Logs — exact via request_id; otherwise fuzzy by function_name + window.
      let logRows: LogRow[] = [];
      let fuzzy = false;
      if (run.request_id) {
        const r = await supabase
          .from("edge_request_logs")
          .select("id,created_at,status,latency_ms,classified_error,error_message,method,path,meta")
          .eq("request_id", run.request_id)
          .order("created_at", { ascending: true })
          .limit(200);
        logRows = (r.data as LogRow[]) ?? [];
      }
      if (logRows.length === 0) {
        fuzzy = true;
        const startMs = new Date(run.started_at).getTime();
        const endMs = startMs + (run.duration_ms ?? Date.now() - startMs) + 60_000;
        // Function name is approximated from job (strip suffix variants).
        const fnGuess = run.job.replace(/-\d+m$/, "").replace(/-(open|close|smoke)$/, "");
        const r = await supabase
          .from("edge_request_logs")
          .select("id,created_at,status,latency_ms,classified_error,error_message,method,path,meta")
          .eq("function_name", fnGuess)
          .gte("created_at", new Date(startMs - 1000).toISOString())
          .lte("created_at", new Date(endMs).toISOString())
          .order("created_at", { ascending: true })
          .limit(50);
        logRows = (r.data as LogRow[]) ?? [];
      }
      setLogs(logRows);
      setLogsFuzzy(fuzzy);
      setLoading(false);
    })();
  }, [run]);

  const totalRunMs = run?.duration_ms ?? (run ? Date.now() - new Date(run.started_at).getTime() : 0);
  const maxStepMs = Math.max(1, ...steps.map((s) => s.duration_ms ?? (Date.now() - new Date(s.started_at).getTime())));

  return (
    <Sheet open={!!run} onOpenChange={(v) => !v && onClose()}>
      <SheetContent side="right" className="w-full sm:max-w-2xl overflow-y-auto">
        {run && (
          <>
            <SheetHeader>
              <SheetTitle className="font-mono text-base flex items-center gap-2">
                {run.job} <StatusBadge status={run.status} code={run.status_code} />
              </SheetTitle>
              <div className="text-xs text-muted-foreground flex flex-wrap gap-3">
                <span>Started {fmtTime(run.started_at)}</span>
                <span>Duration {fmtMs(totalRunMs)}</span>
                {baseline && <span>p50 {fmtMs(baseline.median_ms)} · p95 {fmtMs(baseline.p95_ms)}</span>}
                {run.request_id && <span className="font-mono">req {run.request_id}</span>}
              </div>
              {run.message && <p className="text-sm pt-2">{run.message}</p>}
            </SheetHeader>

            <div className="mt-6 space-y-6">
              <section>
                <h3 className="text-sm font-medium mb-2">Steps ({steps.length})</h3>
                {loading && <p className="text-xs text-muted-foreground">Loading…</p>}
                {!loading && steps.length === 0 && (
                  <p className="text-xs text-muted-foreground">No steps recorded for this run.</p>
                )}
                <ol className="space-y-1">
                  {steps.map((s) => {
                    const dur = s.duration_ms ?? (s.status === "running" ? Date.now() - new Date(s.started_at).getTime() : null);
                    const widthPct = dur ? Math.max(2, (dur / maxStepMs) * 100) : 2;
                    const colors: Record<string, string> = {
                      running: "bg-sky-500/40",
                      ok: "bg-emerald-500/40",
                      error: "bg-red-500/50",
                      skipped: "bg-muted",
                    };
                    return (
                      <li key={s.id} className="text-xs">
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-mono truncate">{s.step_label || s.step_key}</span>
                          <span className="font-mono text-muted-foreground shrink-0">{fmtMs(dur)}</span>
                        </div>
                        <div className="h-1.5 rounded bg-muted/40 mt-0.5 overflow-hidden">
                          <div className={`h-full ${colors[s.status] ?? "bg-muted"} ${s.status === "running" ? "animate-pulse" : ""}`} style={{ width: `${widthPct}%` }} />
                        </div>
                      </li>
                    );
                  })}
                </ol>
              </section>

              <section>
                <h3 className="text-sm font-medium mb-2 flex items-center gap-2">
                  Logs ({logs.length})
                  {logsFuzzy && <Badge variant="outline" className="text-amber-300 border-amber-500/30">fuzzy match — request_id not recorded</Badge>}
                </h3>
                {logs.length === 0 ? (
                  <p className="text-xs text-muted-foreground">No edge-request log rows found.</p>
                ) : (
                  <div className="space-y-1">
                    {logs.map((l) => (
                      <details key={l.id} className="text-xs border border-border rounded p-2">
                        <summary className="cursor-pointer flex items-center justify-between gap-2">
                          <span className="font-mono">
                            {fmtTime(l.created_at)} · {l.method} {l.status} · {fmtMs(l.latency_ms)}
                          </span>
                          {l.classified_error && (
                            <Badge variant="outline" className="text-red-300 border-red-500/30">{l.classified_error}</Badge>
                          )}
                        </summary>
                        {l.error_message && <p className="mt-1 text-red-300/90 break-all">{l.error_message}</p>}
                        {l.path && <p className="mt-1 font-mono text-muted-foreground break-all">{l.path}</p>}
                        {l.meta && Object.keys(l.meta).length > 0 && (
                          <pre className="mt-1 text-[10px] bg-muted/30 rounded p-2 overflow-x-auto">{JSON.stringify(l.meta, null, 2)}</pre>
                        )}
                      </details>
                    ))}
                  </div>
                )}
              </section>
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}
