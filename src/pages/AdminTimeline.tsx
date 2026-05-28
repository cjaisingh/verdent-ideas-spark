import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { RefreshCcw, Activity, AlertTriangle, CheckCircle2, XCircle, Loader2 } from "lucide-react";

type StepRow = {
  id: string;
  created_at: string;
  job: string;
  step_key: string;
  step_label: string;
  phase_kind: string;
  started_at: string;
  finished_at: string | null;
  duration_ms: number | null;
  status: "running" | "ok" | "error" | "skipped";
  detail: Record<string, unknown>;
};

type P95Row = { job: string; step_key: string; p95_ms: number; sample_count: number };

const PHASE_COLORS: Record<string, string> = {
  ai_call: "bg-violet-500/15 text-violet-300 border-violet-500/30",
  db_scan: "bg-sky-500/15 text-sky-300 border-sky-500/30",
  lock_wait: "bg-amber-500/15 text-amber-300 border-amber-500/30",
  backoff: "bg-orange-500/15 text-orange-300 border-orange-500/30",
  external_http: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30",
  compute: "bg-slate-500/15 text-slate-300 border-slate-500/30",
  other: "bg-muted text-muted-foreground border-border",
};

function fmtDuration(ms: number | null, fallbackStartedAt?: string) {
  if (ms == null && fallbackStartedAt) {
    const live = Date.now() - new Date(fallbackStartedAt).getTime();
    if (live < 1000) return `${live}ms`;
    return `${(live / 1000).toFixed(1)}s`;
  }
  if (ms == null) return "—";
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

function fmtRelative(iso: string) {
  const diff = Date.now() - new Date(iso).getTime();
  if (diff < 60_000) return `${Math.floor(diff / 1000)}s ago`;
  if (diff < 3600_000) return `${Math.floor(diff / 60_000)}m ago`;
  return new Date(iso).toLocaleTimeString();
}

export default function AdminTimeline() {
  const [rows, setRows] = useState<StepRow[]>([]);
  const [p95, setP95] = useState<Map<string, number>>(new Map());
  const [loading, setLoading] = useState(true);
  const [_, setTick] = useState(0); // re-render for live duration ticks

  const [jobFilter, setJobFilter] = useState<string>("all");
  const [phaseFilter, setPhaseFilter] = useState<string>("all");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [onlyOverP95, setOnlyOverP95] = useState(false);

  async function load() {
    setLoading(true);
    const since = new Date(Date.now() - 6 * 3600_000).toISOString();
    const [stepsRes, p95Res] = await Promise.all([
      supabase.from("automation_steps")
        .select("*")
        .gte("started_at", since)
        .order("started_at", { ascending: false })
        .limit(500),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      supabase.from("v_automation_step_p95_30d" as any).select("job,step_key,p95_ms,sample_count"),
    ]);
    setRows((stepsRes.data ?? []) as StepRow[]);
    const m = new Map<string, number>();
    for (const r of ((p95Res.data ?? []) as unknown) as P95Row[]) {
      m.set(`${r.job}|${r.step_key}`, r.p95_ms);
    }
    setP95(m);
    setLoading(false);
  }

  useEffect(() => {
    load();
    const channel = supabase
      .channel(`admin-timeline-${Math.random().toString(36).slice(2)}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "automation_steps" }, () => {
        load();
      })
      .subscribe();
    const ticker = setInterval(() => setTick((t) => t + 1), 1000);
    return () => { supabase.removeChannel(channel); clearInterval(ticker); };
  }, []);

  const enriched = useMemo(() => rows.map((r) => {
    const baseline = p95.get(`${r.job}|${r.step_key}`) ?? null;
    const liveDuration = r.duration_ms ?? (Date.now() - new Date(r.started_at).getTime());
    const isOverP95 = baseline != null && liveDuration > baseline && (liveDuration - baseline) > 50;
    return { ...r, baseline, isOverP95, liveDuration };
  }), [rows, p95]);

  const jobOptions = useMemo(() => Array.from(new Set(rows.map((r) => r.job))).sort(), [rows]);

  const filtered = enriched.filter((r) => {
    if (jobFilter !== "all" && r.job !== jobFilter) return false;
    if (phaseFilter !== "all" && r.phase_kind !== phaseFilter) return false;
    if (statusFilter !== "all" && r.status !== statusFilter) return false;
    if (onlyOverP95 && !r.isOverP95) return false;
    return true;
  });

  const runningNow = enriched.filter((r) => r.status === "running");
  const oldestRunning = runningNow.length
    ? runningNow.reduce((a, b) => (new Date(a.started_at) < new Date(b.started_at) ? a : b))
    : null;
  const lastHour = enriched.filter((r) => r.status === "ok" && Date.now() - new Date(r.started_at).getTime() < 3600_000);
  const slowestLastHour = [...lastHour].sort((a, b) => (b.duration_ms ?? 0) - (a.duration_ms ?? 0)).slice(0, 5);
  const overP95Count = lastHour.filter((r) => r.isOverP95).length;

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Platform timeline</h1>
          <p className="text-sm text-muted-foreground">Live view of every cron, edge function and sentinel check — labelled phases with p95 regression flags.</p>
        </div>
        <Button variant="outline" size="sm" onClick={load} disabled={loading}>
          {loading ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <RefreshCcw className="h-4 w-4 mr-2" />}
          Refresh
        </Button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-2"><Activity className="h-4 w-4" />Running now</CardTitle></CardHeader>
          <CardContent>
            <div className="text-2xl font-semibold">{runningNow.length}</div>
            <div className="text-xs text-muted-foreground mt-1">
              {oldestRunning ? `oldest started ${fmtRelative(oldestRunning.started_at)} — ${oldestRunning.job}` : "idle"}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm">Slowest last 1h</CardTitle></CardHeader>
          <CardContent className="space-y-1">
            {slowestLastHour.length === 0 && <div className="text-xs text-muted-foreground">No completed steps yet.</div>}
            {slowestLastHour.map((r) => (
              <div key={r.id} className="text-xs flex items-center justify-between gap-2">
                <span className="truncate"><span className="text-muted-foreground">{r.job}</span> · {r.step_label}</span>
                <span className="font-mono">{fmtDuration(r.duration_ms)}</span>
              </div>
            ))}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-2"><AlertTriangle className={`h-4 w-4 ${overP95Count > 0 ? "text-amber-500" : ""}`} />Over p95 (1h)</CardTitle></CardHeader>
          <CardContent>
            <div className={`text-2xl font-semibold ${overP95Count > 0 ? "text-amber-500" : ""}`}>{overP95Count}</div>
            <div className="text-xs text-muted-foreground mt-1">Compared against 30-day p95 baseline.</div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <div className="flex flex-wrap items-center gap-2">
            <Select value={jobFilter} onValueChange={setJobFilter}>
              <SelectTrigger className="h-8 w-[200px] text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All jobs</SelectItem>
                {jobOptions.map((j) => <SelectItem key={j} value={j}>{j}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={phaseFilter} onValueChange={setPhaseFilter}>
              <SelectTrigger className="h-8 w-[160px] text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All phases</SelectItem>
                {Object.keys(PHASE_COLORS).map((p) => <SelectItem key={p} value={p}>{p}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="h-8 w-[140px] text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All statuses</SelectItem>
                <SelectItem value="running">running</SelectItem>
                <SelectItem value="ok">ok</SelectItem>
                <SelectItem value="error">error</SelectItem>
                <SelectItem value="skipped">skipped</SelectItem>
              </SelectContent>
            </Select>
            <Button
              variant={onlyOverP95 ? "default" : "outline"}
              size="sm"
              onClick={() => setOnlyOverP95((v) => !v)}
              className="h-8 text-xs"
            >
              <AlertTriangle className="h-3.5 w-3.5 mr-1" /> Over p95 only
            </Button>
            <div className="ml-auto text-xs text-muted-foreground">{filtered.length} of {rows.length} rows · last 6h</div>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <div className="divide-y divide-border">
            {filtered.length === 0 && (
              <div className="p-6 text-sm text-muted-foreground text-center">No steps match these filters yet.</div>
            )}
            {filtered.map((r) => (
              <div key={r.id} className="px-4 py-2 flex items-center gap-3 text-sm">
                <div className="w-5">
                  {r.status === "running" && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
                  {r.status === "ok" && <CheckCircle2 className="h-4 w-4 text-emerald-500" />}
                  {r.status === "error" && <XCircle className="h-4 w-4 text-destructive" />}
                  {r.status === "skipped" && <div className="h-4 w-4 rounded-full bg-muted" />}
                </div>
                <Badge variant="outline" className={`text-[10px] ${PHASE_COLORS[r.phase_kind] ?? PHASE_COLORS.other}`}>{r.phase_kind}</Badge>
                <div className="flex-1 min-w-0">
                  <div className="truncate">
                    <span className="text-xs text-muted-foreground mr-2">{r.job}</span>
                    <span>{r.step_label}</span>
                  </div>
                  <div className="text-[11px] text-muted-foreground truncate">
                    {r.step_key} · started {fmtRelative(r.started_at)}
                  </div>
                </div>
                <div className="font-mono text-xs tabular-nums w-16 text-right">
                  {fmtDuration(r.duration_ms, r.status === "running" ? r.started_at : undefined)}
                </div>
                {r.baseline != null && (
                  <div className={`text-[10px] tabular-nums w-24 text-right ${r.isOverP95 ? "text-amber-500" : "text-muted-foreground"}`}>
                    p95 {fmtDuration(r.baseline)}
                  </div>
                )}
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
