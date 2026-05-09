import { useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ArrowUpRight, Loader2, RefreshCcw, Shield, ShieldAlert, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { FindingRunsDrawer } from "@/components/admin/FindingRunsDrawer";

type Finding = {
  id: string;
  kind: string;
  severity: "info" | "low" | "medium" | "high" | "critical";
  summary: string;
  status: string;
  first_seen_at: string;
  last_seen_at: string;
  subject_ref: Record<string, any> | null;
  payload: Record<string, any> | null;
};
type Run = { created_at: string; status: string; message: string | null };

// Pull the (job, run_ids) tuple from a finding's payload/subject_ref so the UI
// can cross-link from the finding back to the runs that caused it.
function findingRunsRef(f: Finding): { job: string; runIds: string[] } | null {
  const job = f.subject_ref?.job as string | undefined;
  if (!job) return null;
  const ids: string[] = (f.subject_ref?.run_ids as string[]) ??
    (f.payload?.error_run_ids_24h as string[]) ?? [];
  return { job, runIds: ids };
}

const sevColor: Record<string, string> = {
  critical: "bg-destructive text-destructive-foreground",
  high: "bg-destructive/80 text-destructive-foreground",
  medium: "bg-amber-500 text-white",
  low: "bg-muted text-muted-foreground",
  info: "bg-muted text-muted-foreground",
};
const sevRank: Record<string, number> = { info: 0, low: 1, medium: 2, high: 3, critical: 4 };

export function SentinelStatusStrip() {
  const [findings, setFindings] = useState<Finding[]>([]);
  const [lastRun, setLastRun] = useState<Run | null>(null);
  const [running, setRunning] = useState(false);
  const [loading, setLoading] = useState(true);
  const [drawerFinding, setDrawerFinding] = useState<Finding | null>(null);

  const load = async () => {
    const [{ data: f }, { data: r }] = await Promise.all([
      supabase.from("sentinel_findings")
        .select("id,kind,severity,summary,status,first_seen_at,last_seen_at,subject_ref,payload")
        .eq("status", "open").order("last_seen_at", { ascending: false }).limit(50),
      supabase.from("automation_runs")
        .select("created_at,status,message")
        .eq("job", "sentinel-tick").order("created_at", { ascending: false }).limit(1).maybeSingle(),
    ]);
    setFindings((f as Finding[]) ?? []);
    setLastRun((r as Run | null) ?? null);
    setLoading(false);
  };

  const reloadTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scheduleReload = () => {
    if (reloadTimer.current) clearTimeout(reloadTimer.current);
    reloadTimer.current = setTimeout(() => { load(); }, 250);
  };

  useEffect(() => {
    load();
    const ch = supabase.channel("sentinel-strip")
      .on("postgres_changes",
        { event: "*", schema: "public", table: "sentinel_findings" },
        scheduleReload)
      .on("postgres_changes",
        { event: "INSERT", schema: "public", table: "automation_runs", filter: "job=eq.sentinel-tick" },
        scheduleReload)
      .subscribe();
    return () => {
      if (reloadTimer.current) clearTimeout(reloadTimer.current);
      supabase.removeChannel(ch);
    };
  }, []);

  const runNow = async () => {
    setRunning(true);
    try {
      const { error } = await supabase.functions.invoke("sentinel-tick", { body: {} });
      if (error) throw error;
      toast.success("Sentinel tick complete.");
      load();
    } catch (e: any) { toast.error(e.message ?? "failed"); }
    finally { setRunning(false); }
  };

  const counts = findings.reduce<Record<string, number>>((acc, f) => {
    acc[f.severity] = (acc[f.severity] ?? 0) + 1;
    return acc;
  }, {});
  const worst = findings.reduce((acc, f) => Math.max(acc, sevRank[f.severity] ?? 0), 0);
  const tone = worst >= 3 ? "red" : worst >= 2 ? "amber" : "green";
  const Icon = tone === "green" ? ShieldCheck : tone === "amber" ? Shield : ShieldAlert;
  const tonePill =
    tone === "green" ? "bg-green-600/20 text-green-700 dark:text-green-400" :
    tone === "amber" ? "bg-amber-500/20 text-amber-700 dark:text-amber-400" :
    "bg-destructive/20 text-destructive";

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <CardTitle className="text-base flex items-center gap-2">
            <Icon className="h-4 w-4" /> Sentinel Agent
            <Badge className={tonePill}>{tone === "green" ? "all clear" : tone === "amber" ? "watching" : "attention"}</Badge>
          </CardTitle>
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <span>last tick: {lastRun ? new Date(lastRun.created_at).toLocaleString() : "never"}</span>
            <Button size="sm" variant="ghost" onClick={runNow} disabled={running}>
              {running ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : <RefreshCcw className="h-3 w-3 mr-1" />}
              Tick now
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="text-xs text-muted-foreground"><Loader2 className="h-3 w-3 animate-spin inline mr-1" />Loading…</div>
        ) : (
          <>
            <div className="flex flex-wrap gap-2 text-xs mb-3">
              {(["critical", "high", "medium", "low", "info"] as const).map((s) => (
                <Badge key={s} className={sevColor[s]}>{s}: {counts[s] ?? 0}</Badge>
              ))}
            </div>
            {findings.length === 0 ? (
              <p className="text-sm text-muted-foreground">No open findings.</p>
            ) : (
              <ul className="text-sm space-y-2">
                {findings.slice(0, 3).map((f) => {
                  const ref = findingRunsRef(f);
                  const runCount = ref?.runIds.length ?? 0;
                  return (
                  <li key={f.id} className="flex items-start justify-between gap-2 border-b border-border/40 pb-2 last:border-0">
                    <div className="flex-1 min-w-0">
                      <div className="line-clamp-2">{f.summary}</div>
                      <div className="text-xs text-muted-foreground flex items-center gap-2 flex-wrap">
                        <span>{f.kind} · seen {new Date(f.last_seen_at).toLocaleTimeString()}</span>
                        {ref && (
                          <button
                            type="button"
                            onClick={() => setDrawerFinding(f)}
                            className="inline-flex items-center gap-0.5 text-primary hover:underline"
                            title={runCount ? `${runCount} run(s) caused this` : "View runs"}
                          >
                            view {runCount > 0 ? `${runCount} run${runCount === 1 ? "" : "s"}` : "runs"}
                            <ArrowUpRight className="h-3 w-3" />
                          </button>
                        )}
                      </div>
                    </div>
                    <Badge className={sevColor[f.severity]}>{f.severity}</Badge>
                  </li>
                  );
                })}
              </ul>
            )}
            {findings.length > 3 && (
              <div className="text-xs text-muted-foreground mt-2">+{findings.length - 3} more</div>
            )}
          </>
        )}
      </CardContent>
      <FindingRunsDrawer
        open={!!drawerFinding}
        onOpenChange={(o) => { if (!o) setDrawerFinding(null); }}
        job={drawerFinding ? (findingRunsRef(drawerFinding)?.job ?? null) : null}
        runIds={drawerFinding ? (findingRunsRef(drawerFinding)?.runIds ?? []) : []}
        findingSummary={drawerFinding?.summary}
        findingKind={drawerFinding?.kind}
      />
    </Card>
  );
}
