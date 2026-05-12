import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "sonner";
import { Loader2, Play, ShieldCheck, AlertTriangle, CheckCircle2 } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { DiscussThisButton } from "@/components/discussions/DiscussThisButton";

type Severity = "info" | "low" | "medium" | "high" | "critical";

type Finding = {
  module: string;
  severity: Severity;
  title: string;
  detail?: string;
  evidence?: Record<string, unknown>;
};

type ModuleResult = {
  module: string;
  status: "ok" | "warn" | "fail";
  checked: number;
  findings: Finding[];
  metrics?: Record<string, number>;
};

type Run = {
  id: string;
  cadence: string;
  triggered_by: string;
  started_at: string;
  finished_at: string | null;
  status: "running" | "ok" | "warn" | "fail";
  summary: Record<string, number> & { promoted_lessons?: number; promoted_findings?: number };
  modules: ModuleResult[];
  findings: Finding[];
};

const sevColor: Record<Severity, string> = {
  critical: "bg-destructive text-destructive-foreground",
  high: "bg-destructive/80 text-destructive-foreground",
  medium: "bg-amber-500 text-white",
  low: "bg-muted text-muted-foreground",
  info: "bg-muted text-muted-foreground",
};

const statusIcon = (s: Run["status"]) => {
  if (s === "ok") return <CheckCircle2 className="h-4 w-4 text-green-500" />;
  if (s === "warn") return <AlertTriangle className="h-4 w-4 text-amber-500" />;
  if (s === "fail") return <AlertTriangle className="h-4 w-4 text-destructive" />;
  return <Loader2 className="h-4 w-4 animate-spin" />;
};

export default function Audits() {
  const [runs, setRuns] = useState<Run[]>([]);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("deep_audit_runs")
      .select("*")
      .order("started_at", { ascending: false })
      .limit(50);
    if (error) toast.error(error.message);
    const list = (data ?? []) as unknown as Run[];
    setRuns(list);
    if (list.length > 0 && !selectedId) setSelectedId(list[0].id);
    setLoading(false);
  };

  useEffect(() => {
    load();
    const ch = supabase
      .channel("deep-audit-live")
      .on("postgres_changes", { event: "*", schema: "public", table: "deep_audit_runs" }, load)
      .subscribe();
    return () => { supabase.removeChannel(ch); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const triggerRun = async (cadence: "weekly" | "monthly" | "manual") => {
    setRunning(true);
    try {
      const { data, error } = await supabase.functions.invoke("deep-audit", {
        body: { cadence },
      });
      if (error) throw error;
      toast.success(`Audit ${data?.status ?? "started"}`);
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to run audit");
    } finally {
      setRunning(false);
    }
  };

  const selected = runs.find((r) => r.id === selectedId) ?? runs[0];

  const latestByCadence = (cadence: "weekly" | "monthly"): Run | undefined =>
    runs.find((r) => r.cadence === cadence);

  const cadenceMaxAgeMs: Record<"weekly" | "monthly", number> = {
    weekly: 8 * 24 * 60 * 60 * 1000,
    monthly: 32 * 24 * 60 * 60 * 1000,
  };

  type Health = "pass" | "fail" | "stale" | "running" | "missing";
  const healthOf = (cadence: "weekly" | "monthly"): { run?: Run; health: Health } => {
    const run = latestByCadence(cadence);
    if (!run) return { health: "missing" };
    if (run.status === "running" || !run.finished_at) return { run, health: "running" };
    if (run.status === "fail") return { run, health: "fail" };
    const age = Date.now() - new Date(run.started_at).getTime();
    if (age > cadenceMaxAgeMs[cadence]) return { run, health: "stale" };
    return { run, health: "pass" };
  };

  const healthBadge = (h: Health) => {
    const map: Record<Health, { label: string; cls: string }> = {
      pass: { label: "Pass", cls: "bg-green-500 text-white" },
      fail: { label: "Fail", cls: "bg-destructive text-destructive-foreground" },
      stale: { label: "Stale", cls: "bg-amber-500 text-white" },
      running: { label: "Running", cls: "bg-muted text-muted-foreground" },
      missing: { label: "No runs", cls: "bg-muted text-muted-foreground" },
    };
    const m = map[h];
    return <Badge className={m.cls}>{m.label}</Badge>;
  };

  const StatusTile = ({ cadence, label }: { cadence: "weekly" | "monthly"; label: string }) => {
    const { run, health } = healthOf(cadence);
    const high = run?.summary?.high ?? 0;
    const crit = run?.summary?.critical ?? 0;
    return (
      <button
        type="button"
        onClick={() => run && setSelectedId(run.id)}
        className="text-left border rounded-md p-3 hover:bg-accent transition w-full"
        disabled={!run}
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="font-medium text-sm">{label}</span>
            {healthBadge(health)}
          </div>
          <div className="flex items-center gap-1 text-xs text-muted-foreground">
            {run ? statusIcon(run.status) : null}
            <span>
              {crit > 0 || high > 0 ? `${crit}c · ${high}h` : run ? "clean" : "—"}
            </span>
          </div>
        </div>
        <div className="text-xs text-muted-foreground mt-1">
          {run
            ? `Last run ${formatDistanceToNow(new Date(run.started_at), { addSuffix: true })}${
                run.finished_at
                  ? ` · ${((new Date(run.finished_at).getTime() - new Date(run.started_at).getTime()) / 1000).toFixed(1)}s`
                  : ""
              }`
            : "Never run"}
        </div>
      </button>
    );
  };

  return (
    <div className="container mx-auto p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold flex items-center gap-2">
            <ShieldCheck className="h-7 w-7" />
            Deep Audits
          </h1>
          <p className="text-muted-foreground mt-1">
            Weekly + monthly platform-wide audits across secrets, RBAC, automation, RLS, and retention.
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => triggerRun("manual")} disabled={running}>
            {running ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Play className="h-4 w-4 mr-2" />}
            Run now
          </Button>
        </div>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm flex items-center gap-2">
            <ShieldCheck className="h-4 w-4" />
            Automated audit health
          </CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <StatusTile cadence="weekly" label="W5 · Weekly deep audit" />
          <StatusTile cadence="monthly" label="W6 · Monthly deep audit" />
        </CardContent>
      </Card>

      {loading && runs.length === 0 ? (
        <div className="flex items-center justify-center py-20 text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin mr-2" /> Loading audit runs…
        </div>
      ) : runs.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            No audit runs yet. Click <strong>Run now</strong> or wait for the weekly Sunday 04:00 UTC cron.
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-[280px_1fr] gap-6">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm">Recent runs</CardTitle>
            </CardHeader>
            <CardContent className="p-0 max-h-[600px] overflow-y-auto">
              {runs.map((r) => (
                <button
                  key={r.id}
                  onClick={() => setSelectedId(r.id)}
                  className={`w-full text-left p-3 border-b hover:bg-accent transition ${
                    r.id === selected?.id ? "bg-accent" : ""
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      {statusIcon(r.status)}
                      <span className="font-medium capitalize text-sm">{r.cadence}</span>
                    </div>
                    <Badge variant="outline" className="text-xs">
                      {r.summary?.high ?? 0}h · {r.summary?.critical ?? 0}c
                    </Badge>
                  </div>
                  <div className="text-xs text-muted-foreground mt-1">
                    {formatDistanceToNow(new Date(r.started_at), { addSuffix: true })}
                  </div>
                </button>
              ))}
            </CardContent>
          </Card>

          {selected && (
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardTitle className="flex items-center gap-2">
                    {statusIcon(selected.status)}
                    <span className="capitalize">{selected.cadence} audit</span>
                    <Badge
                      className={
                        selected.status === "ok"
                          ? "bg-green-500"
                          : selected.status === "warn"
                          ? "bg-amber-500"
                          : "bg-destructive"
                      }
                    >
                      {selected.status}
                    </Badge>
                  </CardTitle>
                  <div className="text-xs text-muted-foreground">
                    {selected.finished_at
                      ? `${new Date(selected.started_at).toLocaleString()} (${
                          ((new Date(selected.finished_at).getTime() - new Date(selected.started_at).getTime()) / 1000).toFixed(1)
                        }s)`
                      : "running…"}
                  </div>
                </div>
                <div className="flex gap-2 flex-wrap mt-3">
                  {(["critical", "high", "medium", "low", "info"] as Severity[]).map((s) => {
                    const n = selected.summary?.[s] ?? 0;
                    if (n === 0) return null;
                    return (
                      <Badge key={s} className={sevColor[s]}>
                        {n} {s}
                      </Badge>
                    );
                  })}
                  {selected.summary?.promoted_lessons ? (
                    <Badge variant="outline">{selected.summary.promoted_lessons} → lessons</Badge>
                  ) : null}
                </div>
              </CardHeader>
              <CardContent>
                <Tabs defaultValue="findings">
                  <TabsList>
                    <TabsTrigger value="findings">
                      Findings ({selected.findings?.length ?? 0})
                    </TabsTrigger>
                    <TabsTrigger value="modules">Modules</TabsTrigger>
                  </TabsList>

                  <TabsContent value="findings" className="space-y-2 mt-4">
                    {(selected.findings ?? []).length === 0 ? (
                      <div className="text-sm text-muted-foreground py-4">No findings — clean run.</div>
                    ) : (
                      selected.findings.map((f, i) => (
                        <div key={i} className="border rounded-md p-3 flex items-start justify-between gap-3">
                          <div className="flex-1">
                            <div className="flex items-center gap-2">
                              <Badge className={sevColor[f.severity]}>{f.severity}</Badge>
                              <span className="text-xs text-muted-foreground">{f.module}</span>
                            </div>
                            <div className="font-medium mt-1">{f.title}</div>
                            {f.detail && <div className="text-sm text-muted-foreground mt-1">{f.detail}</div>}
                            {f.evidence && (
                              <pre className="text-xs bg-muted p-2 rounded mt-2 overflow-x-auto">
                                {JSON.stringify(f.evidence, null, 2)}
                              </pre>
                            )}
                          </div>
                        </div>
                      ))
                    )}
                  </TabsContent>

                  <TabsContent value="modules" className="space-y-2 mt-4">
                    {(selected.modules ?? []).map((m) => (
                      <div key={m.module} className="border rounded-md p-3">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            {statusIcon(m.status as Run["status"])}
                            <span className="font-medium capitalize">{m.module}</span>
                          </div>
                          <span className="text-xs text-muted-foreground">
                            {m.checked} checked · {m.findings.length} findings
                          </span>
                        </div>
                        {m.metrics && Object.keys(m.metrics).length > 0 && (
                          <div className="text-xs text-muted-foreground mt-2 flex gap-3 flex-wrap">
                            {Object.entries(m.metrics).map(([k, v]) => (
                              <span key={k}>
                                {k}: <strong className="text-foreground">{v}</strong>
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                    ))}
                  </TabsContent>
                </Tabs>
              </CardContent>
            </Card>
          )}
        </div>
      )}
    </div>
  );
}
