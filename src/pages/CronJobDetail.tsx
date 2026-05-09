// Per-job drill-down: latest runs, full error messages, evidence detail.
// Route: /admin/cron-health/:job
import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Activity, AlertTriangle, ArrowLeft, CheckCircle2, ChevronDown, ChevronRight,
  Loader2, Play, RefreshCw,
} from "lucide-react";
import { toast } from "sonner";

const KNOWN_JOBS: Record<string, { label: string; cadence: string; cron: string; description: string }> = {
  "morning-review": {
    label: "Morning Review (W2)",
    cadence: "Daily 06:00 UTC",
    cron: "scheduled-morning-review",
    description: "Daily KPI + drift aggregator. Writes to morning_reviews.",
  },
  "sentinel-tick": {
    label: "Sentinel Agent (W3)",
    cadence: "Every 15 minutes",
    cron: "scheduled-sentinel-tick",
    description: "Cron silence, 5xx spikes, secret age, admin grants, error-rate watcher.",
  },
  "lessons-synthesize": {
    label: "Lessons Loop (W4)",
    cadence: "Sundays 05:00 UTC",
    cron: "scheduled-lessons-weekly",
    description: "Weekly AI synthesis of 7-day signal into proposed lessons.",
  },
  "deep-audit": {
    label: "Deep Audit (W5)",
    cadence: "Sundays 04:00 + 1st of month 04:30 UTC",
    cron: "scheduled-deep-audit-weekly / scheduled-deep-audit-monthly",
    description: "5-module audit: secrets, RBAC, automation, RLS, retention.",
  },
};

type Run = {
  id: string;
  job: string;
  status: string;
  status_code: number | null;
  message: string | null;
  duration_ms: number | null;
  trigger: string;
  detail: Record<string, unknown> | null;
  created_at: string;
};

const isOk = (r: Run) => r.status === "ok" && (r.status_code ?? 0) < 400;

function rel(iso: string) {
  const m = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

function statusBadge(r: Run) {
  if (isOk(r)) return <Badge className="bg-emerald-600 text-white">ok</Badge>;
  if (r.status === "running") return <Badge variant="outline">running</Badge>;
  return <Badge variant="destructive">{r.status_code ?? r.status}</Badge>;
}

export default function CronJobDetail() {
  const { job = "" } = useParams<{ job: string }>();
  const [searchParams] = useSearchParams();
  const focusIds = useMemo(() => {
    const raw = searchParams.get("focus") ?? "";
    return new Set(raw.split(",").map((s) => s.trim()).filter(Boolean));
  }, [searchParams]);
  const meta = KNOWN_JOBS[job];
  const [runs, setRuns] = useState<Run[]>([]);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [filter, setFilter] = useState<"all" | "errors" | "ok">(focusIds.size > 0 ? "errors" : "all");
  const [expanded, setExpanded] = useState<Set<string>>(new Set(focusIds));
  const focusRef = useRef<HTMLDivElement | null>(null);
  const scrolledRef = useRef(false);

  const load = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("automation_runs" as any)
      .select("id,job,status,status_code,message,duration_ms,trigger,detail,created_at")
      .eq("job", job)
      .order("created_at", { ascending: false })
      .limit(200);
    if (error) toast.error(error.message);
    setRuns(((data ?? []) as unknown) as Run[]);
    setLoading(false);
  };

  useEffect(() => {
    if (!job) return;
    load();
    const ch = supabase
      .channel(`cron_job_${job}`)
      .on("postgres_changes",
        { event: "INSERT", schema: "public", table: "automation_runs", filter: `job=eq.${job}` },
        load)
      .subscribe();
    return () => { supabase.removeChannel(ch); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [job]);

  // Scroll the first focused run into view once the rows are rendered.
  useEffect(() => {
    if (scrolledRef.current) return;
    if (focusIds.size === 0 || runs.length === 0) return;
    if (focusRef.current) {
      focusRef.current.scrollIntoView({ behavior: "smooth", block: "center" });
      scrolledRef.current = true;
    }
  }, [runs, focusIds]);

  const triggerNow = async () => {
    setRunning(true);
    try {
      const { error } = await supabase.functions.invoke(job);
      if (error) throw error;
      toast.success(`Triggered ${job}`);
      setTimeout(load, 1000);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to trigger");
    } finally {
      setRunning(false);
    }
  };

  const stats = useMemo(() => {
    const total = runs.length;
    const ok = runs.filter(isOk).length;
    const err = total - ok;
    const lastSuccess = runs.find(isOk) ?? null;
    const lastError = runs.find((r) => !isOk(r) && r.status !== "running") ?? null;
    return { total, ok, err, lastSuccess, lastError };
  }, [runs]);

  const filtered = useMemo(() => {
    if (filter === "errors") return runs.filter((r) => !isOk(r) && r.status !== "running");
    if (filter === "ok") return runs.filter(isOk);
    return runs;
  }, [runs, filter]);

  const toggle = (id: string) => {
    setExpanded((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  if (!meta) {
    return (
      <div className="container mx-auto p-6">
        <Button asChild variant="ghost" size="sm">
          <Link to="/admin/cron-health"><ArrowLeft className="h-4 w-4 mr-1" /> Back</Link>
        </Button>
        <Card className="mt-4">
          <CardContent className="py-12 text-center text-muted-foreground">
            Unknown job <code className="font-mono">{job}</code>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="container mx-auto p-6 space-y-6">
      <div>
        <Button asChild variant="ghost" size="sm">
          <Link to="/admin/cron-health"><ArrowLeft className="h-4 w-4 mr-1" /> Cron health</Link>
        </Button>
      </div>

      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Activity className="h-6 w-6" /> {meta.label}
          </h1>
          <code className="text-xs text-muted-foreground">{job}</code>
          <p className="text-sm text-muted-foreground mt-1">{meta.description}</p>
          <div className="text-xs text-muted-foreground mt-1">
            Cadence: <span className="font-mono">{meta.cadence}</span> · Cron job:{" "}
            <span className="font-mono">{meta.cron}</span>
          </div>
        </div>
        <div className="flex gap-2 shrink-0">
          <Button variant="outline" size="sm" onClick={load} disabled={loading}>
            <RefreshCw className={`h-4 w-4 mr-1 ${loading ? "animate-spin" : ""}`} /> Refresh
          </Button>
          <Button size="sm" onClick={triggerNow} disabled={running}>
            {running ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Play className="h-4 w-4 mr-1" />}
            Run now
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Card><CardContent className="p-4">
          <div className="text-[10px] uppercase text-muted-foreground">Total runs (last 200)</div>
          <div className="text-2xl font-mono mt-1">{stats.total}</div>
        </CardContent></Card>
        <Card><CardContent className="p-4">
          <div className="text-[10px] uppercase text-muted-foreground">Errors</div>
          <div className={`text-2xl font-mono mt-1 ${stats.err > 0 ? "text-destructive" : ""}`}>{stats.err}</div>
        </CardContent></Card>
        <Card><CardContent className="p-4">
          <div className="text-[10px] uppercase text-muted-foreground">Last success</div>
          <div className="text-sm font-mono mt-1">
            {stats.lastSuccess
              ? <span className="text-emerald-600 dark:text-emerald-400">{rel(stats.lastSuccess.created_at)}</span>
              : <span className="text-destructive">never</span>}
          </div>
        </CardContent></Card>
        <Card><CardContent className="p-4">
          <div className="text-[10px] uppercase text-muted-foreground">Last error</div>
          <div className="text-sm font-mono mt-1">
            {stats.lastError
              ? <span className="text-destructive">{rel(stats.lastError.created_at)}</span>
              : <span className="text-muted-foreground">—</span>}
          </div>
        </CardContent></Card>
      </div>

      {focusIds.size > 0 && (
        <div className="rounded border border-amber-500/40 bg-amber-500/10 p-3 text-xs flex items-center justify-between gap-3">
          <div>
            <strong>Focused on {focusIds.size} run{focusIds.size === 1 ? "" : "s"}</strong>{" "}
            from a sentinel finding. Matching rows are highlighted and expanded below.
          </div>
          <Button asChild variant="ghost" size="sm" className="h-7 text-xs">
            <Link to={`/admin/cron-health/${job}`}>Clear focus</Link>
          </Button>
        </div>
      )}

      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-base">Recent runs</CardTitle>
            <div className="flex gap-1">
              {(["all","errors","ok"] as const).map((f) => (
                <Button
                  key={f}
                  variant={filter === f ? "default" : "outline"}
                  size="sm"
                  onClick={() => setFilter(f)}
                  className="h-7 text-xs"
                >
                  {f}
                </Button>
              ))}
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {loading && runs.length === 0 ? (
            <div className="p-6 text-sm text-muted-foreground flex items-center gap-2">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading…
            </div>
          ) : filtered.length === 0 ? (
            <div className="p-6 text-sm text-muted-foreground">No runs match this filter.</div>
          ) : (
            <div className="divide-y">
              {filtered.map((r) => {
                const isExpanded = expanded.has(r.id);
                const ok = isOk(r);
                const isFocused = focusIds.has(r.id);
                return (
                  <div
                    key={r.id}
                    ref={isFocused && !scrolledRef.current ? focusRef : undefined}
                    className={[
                      ok ? "" : "bg-destructive/5",
                      isFocused ? "ring-2 ring-amber-500/60 ring-inset" : "",
                    ].join(" ")}
                  >
                    <button
                      onClick={() => toggle(r.id)}
                      className="w-full text-left p-3 hover:bg-accent/50 flex items-start gap-3"
                    >
                      <div className="mt-0.5">
                        {isExpanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                      </div>
                      <div className="flex-shrink-0 mt-0.5">
                        {ok
                          ? <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                          : <AlertTriangle className="h-4 w-4 text-destructive" />}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          {statusBadge(r)}
                          <Badge variant="outline" className="text-[10px]">{r.trigger}</Badge>
                          <span className="text-xs text-muted-foreground font-mono">
                            {new Date(r.created_at).toLocaleString()} · {rel(r.created_at)}
                          </span>
                          {r.duration_ms != null && (
                            <span className="text-xs text-muted-foreground font-mono">
                              {r.duration_ms}ms
                            </span>
                          )}
                        </div>
                        {r.message && (
                          <div className={`text-xs mt-1 ${ok ? "text-muted-foreground" : "text-destructive"} ${isExpanded ? "" : "line-clamp-2"} break-words`}>
                            {r.message}
                          </div>
                        )}
                      </div>
                    </button>
                    {isExpanded && (
                      <div className="px-3 pb-3 pl-11 space-y-2">
                        {r.message && (
                          <div>
                            <div className="text-[10px] uppercase text-muted-foreground mb-1">Message</div>
                            <pre className="text-xs bg-muted p-2 rounded whitespace-pre-wrap break-words">
                              {r.message}
                            </pre>
                          </div>
                        )}
                        {r.detail && Object.keys(r.detail).length > 0 && (
                          <div>
                            <div className="text-[10px] uppercase text-muted-foreground mb-1">Detail</div>
                            <pre className="text-xs bg-muted p-2 rounded overflow-x-auto">
                              {JSON.stringify(r.detail, null, 2)}
                            </pre>
                          </div>
                        )}
                        <div className="text-[10px] text-muted-foreground font-mono">
                          run_id: {r.id}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
