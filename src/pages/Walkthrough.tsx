import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Loader2, PlayCircle, AlertTriangle, CheckCircle2, ChevronDown, ChevronRight } from "lucide-react";
import { toast } from "@/hooks/use-toast";

type Run = {
  id: string;
  status: string;
  trigger: string;
  started_at: string;
  finished_at: string | null;
  total: number;
  passed: number;
  failed: number;
  skipped: number;
  duration_ms: number | null;
  summary: Record<string, unknown> | null;
};

type Check = {
  id: string;
  run_id: string;
  kind: string;
  target: string;
  capability_id: string | null;
  status: string;
  latency_ms: number | null;
  http_status: number | null;
  error: string | null;
  severity: string;
};

const ago = (iso: string | null) => {
  if (!iso) return "never";
  const d = Date.now() - new Date(iso).getTime();
  const m = Math.floor(d / 60_000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
};

const statusTone = (s: string) =>
  s === "pass" ? "text-emerald-600 dark:text-emerald-400"
  : s === "fail" ? "text-destructive"
  : s === "error" ? "text-destructive"
  : "text-muted-foreground";

const runTone = (s: string) =>
  s === "ok" ? "border-emerald-500/40 bg-emerald-500/5"
  : s === "partial" ? "border-amber-500/40 bg-amber-500/5"
  : s === "running" ? "border-border bg-muted/30"
  : "border-destructive/40 bg-destructive/5";

export default function Walkthrough() {
  const [runs, setRuns] = useState<Run[]>([]);
  const [checksByRun, setChecksByRun] = useState<Record<string, Check[]>>({});
  const [openRun, setOpenRun] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const channelName = useMemo(() => `walkthrough_page:${crypto.randomUUID()}`, []);

  const loadRuns = async () => {
    const { data } = await supabase
      .from("walkthrough_runs" as any)
      .select("id,status,trigger,started_at,finished_at,total,passed,failed,skipped,duration_ms,summary")
      .order("started_at", { ascending: false })
      .limit(50);
    setRuns(((data ?? []) as unknown) as Run[]);
  };

  const loadChecks = async (runId: string) => {
    const { data } = await supabase
      .from("walkthrough_checks" as any)
      .select("id,run_id,kind,target,capability_id,status,latency_ms,http_status,error,severity")
      .eq("run_id", runId)
      .order("status", { ascending: true })
      .order("target", { ascending: true });
    setChecksByRun((prev) => ({ ...prev, [runId]: ((data ?? []) as unknown) as Check[] }));
  };

  useEffect(() => {
    loadRuns();
    const ch = supabase
      .channel(channelName)
      .on("postgres_changes", { event: "*", schema: "public", table: "walkthrough_runs" }, loadRuns)
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [channelName]);

  const runNow = async () => {
    setRunning(true);
    const { data, error } = await supabase.functions.invoke("app-walkthrough", { body: {} });
    setRunning(false);
    if (error) {
      toast({ title: "Walkthrough failed", description: error.message, variant: "destructive" });
      return;
    }
    const summary = data as { passed: number; failed: number; total: number };
    toast({
      title: "Walkthrough complete",
      description: `${summary.passed}/${summary.total} passed · ${summary.failed} failed`,
    });
    loadRuns();
  };

  const toggleRun = (id: string) => {
    if (openRun === id) {
      setOpenRun(null);
    } else {
      setOpenRun(id);
      if (!checksByRun[id]) loadChecks(id);
    }
  };

  return (
    <div className="container max-w-5xl py-6 space-y-4">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">App walkthrough</h1>
          <p className="text-sm text-muted-foreground">
            Nightly probe of awip-api endpoints, edge functions, UI routes, and capability self-tests.
            Failures upsert into <code className="px-1 py-0.5 rounded bg-muted text-xs">sentinel_findings</code>.
          </p>
        </div>
        <Button onClick={runNow} disabled={running}>
          {running ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <PlayCircle className="h-4 w-4 mr-2" />}
          Run walkthrough now
        </Button>
      </header>

      {runs.length === 0 ? (
        <div className="rounded border border-border bg-card p-6 text-center text-sm text-muted-foreground">
          No walkthrough runs yet. Run one now to see results.
        </div>
      ) : (
        <ul className="space-y-2">
          {runs.map((r) => {
            const open = openRun === r.id;
            const checks = checksByRun[r.id] ?? [];
            return (
              <li key={r.id} className={`rounded border ${runTone(r.status)}`}>
                <button
                  type="button"
                  onClick={() => toggleRun(r.id)}
                  className="w-full px-3 py-2 flex items-center gap-2 text-left"
                >
                  {open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                  {r.status === "ok" ? <CheckCircle2 className="h-4 w-4 text-emerald-600" /> : <AlertTriangle className="h-4 w-4 text-amber-600" />}
                  <span className="font-mono text-xs uppercase">{r.status}</span>
                  <span className="text-sm">{r.passed}/{r.total} passed</span>
                  {r.failed > 0 && <span className="text-sm text-destructive">· {r.failed} failed</span>}
                  <span className="text-xs text-muted-foreground">· {r.trigger}</span>
                  <span className="ml-auto text-xs text-muted-foreground">
                    {ago(r.started_at)}
                    {r.duration_ms != null && ` · ${(r.duration_ms / 1000).toFixed(1)}s`}
                  </span>
                </button>
                {open && (
                  <div className="border-t border-border/60 px-3 py-2">
                    {checks.length === 0 ? (
                      <div className="text-xs text-muted-foreground py-2">Loading checks…</div>
                    ) : (
                      <table className="w-full text-xs">
                        <thead className="text-muted-foreground">
                          <tr>
                            <th className="text-left font-normal py-1 pr-2">Status</th>
                            <th className="text-left font-normal py-1 pr-2">Kind</th>
                            <th className="text-left font-normal py-1 pr-2">Target</th>
                            <th className="text-left font-normal py-1 pr-2">HTTP</th>
                            <th className="text-left font-normal py-1 pr-2">ms</th>
                            <th className="text-left font-normal py-1">Error</th>
                          </tr>
                        </thead>
                        <tbody>
                          {checks.map((c) => (
                            <tr key={c.id} className="border-t border-border/40">
                              <td className={`py-1 pr-2 font-mono ${statusTone(c.status)}`}>{c.status}</td>
                              <td className="py-1 pr-2 text-muted-foreground">{c.kind}</td>
                              <td className="py-1 pr-2 break-all">{c.target}</td>
                              <td className="py-1 pr-2 font-mono">{c.http_status ?? "—"}</td>
                              <td className="py-1 pr-2 font-mono">{c.latency_ms ?? "—"}</td>
                              <td className="py-1 text-destructive break-all">{c.error ?? ""}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
