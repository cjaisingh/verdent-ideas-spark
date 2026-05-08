import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { AlertTriangle, ShieldCheck, RefreshCw, Search, MessagesSquare, Sparkles } from "lucide-react";
import { toast } from "@/hooks/use-toast";
import { CopilotDiscussionSheet } from "@/components/risk/CopilotDiscussionSheet";
import { NoCopilotDiscussModal } from "@/components/risk/NoCopilotDiscussModal";

type RiskRow = {
  id: string;
  task_id: string;
  label: string;
  checked: boolean;
  note: string | null;
  task_key: string;
  task_title: string;
  task_status: string;
  task_review_status: string;
  module: string | null;
  sprint_key: string;
  phase_key: string;
  phase_title: string;
  phase_order: number;
};

type Finding = {
  id: string;
  title: string;
  body: string | null;
  severity: string;
  category: string | null;
  area: string | null;
  acknowledged: boolean;
  reviewed_at: string;
  reviewer_model: string;
  diff_window_start: string | null;
  diff_window_end: string | null;
  discussion_status: string | null;
  decision_outcome: string | null;
  decision_summary: string | null;
};

type Group = {
  key: string;
  title: string;
  total: number;
  open: number;
  resolved: number;
  rows: RiskRow[];
};

const sevWeight = (s: string) => ({ critical: 4, high: 3, medium: 2, low: 1, info: 0 } as Record<string, number>)[s] ?? 0;
const sevVariant = (s: string): "destructive" | "secondary" | "outline" =>
  s === "critical" || s === "high" ? "destructive" : s === "medium" ? "secondary" : "outline";


export default function RiskDashboard() {
  const [rows, setRows] = useState<RiskRow[]>([]);
  const [findings, setFindings] = useState<Finding[]>([]);
  const [loading, setLoading] = useState(true);
  const [groupBy, setGroupBy] = useState<"phase" | "module">("phase");
  const [showResolved, setShowResolved] = useState(false);
  const [showAcknowledged, setShowAcknowledged] = useState(false);
  const [copilotFor, setCopilotFor] = useState<Finding | null>(null);
  const [chatFor, setChatFor] = useState<Finding | null>(null);

  const load = async () => {
    setLoading(true);
    const [{ data: checks }, { data: fnd }] = await Promise.all([
      supabase.from("roadmap_task_checklist").select("id,task_id,label,checked,note,category").eq("category", "risk"),
      supabase.from("roadmap_review_findings").select("*").order("reviewed_at", { ascending: false }),
    ]);
    setFindings((fnd ?? []) as Finding[]);

    const taskIds = Array.from(new Set((checks ?? []).map((c) => c.task_id)));
    const { data: tasks } = taskIds.length
      ? await supabase
          .from("roadmap_tasks")
          .select("id,key,title,status,review_status,module,sprint_id")
          .in("id", taskIds)
      : { data: [] as any[] };
    const sprintIds = Array.from(new Set((tasks ?? []).map((t) => t.sprint_id)));
    const { data: sprints } = sprintIds.length
      ? await supabase.from("roadmap_sprints").select("id,key,phase_id").in("id", sprintIds)
      : { data: [] as any[] };
    const phaseIds = Array.from(new Set((sprints ?? []).map((s) => s.phase_id)));
    const { data: phases } = phaseIds.length
      ? await supabase.from("roadmap_phases").select("id,key,title,order").in("id", phaseIds)
      : { data: [] as any[] };

    const sprintById = new Map((sprints ?? []).map((s: any) => [s.id, s]));
    const phaseById = new Map((phases ?? []).map((p: any) => [p.id, p]));
    const taskById = new Map((tasks ?? []).map((t: any) => [t.id, t]));

    const merged: RiskRow[] = (checks ?? []).flatMap((c: any) => {
      const t = taskById.get(c.task_id);
      if (!t) return [];
      const sp = sprintById.get(t.sprint_id);
      const ph = sp ? phaseById.get(sp.phase_id) : null;
      return [{
        id: c.id, task_id: c.task_id, label: c.label, checked: c.checked, note: c.note,
        task_key: t.key, task_title: t.title, task_status: t.status, task_review_status: t.review_status,
        module: t.module, sprint_key: sp?.key ?? "—",
        phase_key: ph?.key ?? "—", phase_title: ph?.title ?? "Unassigned", phase_order: ph?.order ?? 999,
      }];
    });
    setRows(merged);
    setLoading(false);
  };

  useEffect(() => {
    load();
    const ch = supabase
      .channel("risk-dashboard")
      .on("postgres_changes", { event: "*", schema: "public", table: "roadmap_task_checklist" }, () => load())
      .on("postgres_changes", { event: "*", schema: "public", table: "roadmap_tasks" }, () => load())
      .on("postgres_changes", { event: "*", schema: "public", table: "roadmap_review_findings" }, () => load())
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, []);

  const acknowledge = async (id: string, value: boolean) => {
    const { error } = await supabase.from("roadmap_review_findings").update({ acknowledged: value }).eq("id", id);
    if (error) { toast({ title: "Failed", description: error.message, variant: "destructive" }); return; }
    setFindings((prev) => prev.map((f) => (f.id === id ? { ...f, acknowledged: value } : f)));
  };

  const visibleFindings = useMemo(
    () => findings
      .filter((f) => showAcknowledged || !f.acknowledged)
      .sort((a, b) => sevWeight(b.severity) - sevWeight(a.severity) || +new Date(b.reviewed_at) - +new Date(a.reviewed_at)),
    [findings, showAcknowledged],
  );

  const findingCounts = useMemo(() => {
    const out: Record<string, number> = { critical: 0, high: 0, medium: 0, low: 0, info: 0 };
    for (const f of findings) if (!f.acknowledged) out[f.severity] = (out[f.severity] ?? 0) + 1;
    return out;
  }, [findings]);

  const visible = useMemo(() => rows.filter((r) => showResolved || !r.checked), [rows, showResolved]);

  const groups: Group[] = useMemo(() => {
    const map = new Map<string, Group>();
    for (const r of visible) {
      const key = groupBy === "phase" ? `${r.phase_order}|${r.phase_key}` : r.module ?? "(no module)";
      const title = groupBy === "phase" ? `${r.phase_key} · ${r.phase_title}` : (r.module ?? "(no module)");
      if (!map.has(key)) map.set(key, { key, title, total: 0, open: 0, resolved: 0, rows: [] });
      const g = map.get(key)!;
      g.total += 1;
      if (r.checked) g.resolved += 1; else g.open += 1;
      g.rows.push(r);
    }
    return Array.from(map.values()).sort((a, b) => b.open - a.open || a.title.localeCompare(b.title));
  }, [visible, groupBy]);

  const totalOpen = rows.filter((r) => !r.checked).length;
  const totalResolved = rows.filter((r) => r.checked).length;
  const tasksAtRisk = new Set(rows.filter((r) => !r.checked).map((r) => r.task_id)).size;
  const openFindingsCount = findings.filter((f) => !f.acknowledged).length;
  const highSeverityOpen = findings.filter((f) => !f.acknowledged && (f.severity === "high" || f.severity === "critical")).length;

  return (
    <div className="container py-6 space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Risk dashboard</h1>
          <p className="text-sm text-muted-foreground">
            Code-review findings from the latest roadmap update plus aggregated risk-flag checklist items.
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <div className="inline-flex rounded-md border p-0.5">
            <Button size="sm" variant={groupBy === "phase" ? "default" : "ghost"} onClick={() => setGroupBy("phase")}>By phase</Button>
            <Button size="sm" variant={groupBy === "module" ? "default" : "ghost"} onClick={() => setGroupBy("module")}>By module</Button>
          </div>
          <Button size="sm" variant="outline" onClick={() => setShowAcknowledged((v) => !v)}>
            {showAcknowledged ? "Hide ack’d" : "Show ack’d"}
          </Button>
          <Button size="sm" variant="outline" onClick={() => setShowResolved((v) => !v)}>
            {showResolved ? "Hide resolved" : "Show resolved"}
          </Button>
          <Button size="sm" variant="ghost" onClick={load}><RefreshCw className="h-4 w-4" /></Button>
        </div>
      </header>

      <div className="grid gap-3 sm:grid-cols-4">
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm text-muted-foreground">Open findings</CardTitle></CardHeader>
          <CardContent className="text-3xl font-bold flex items-center gap-2">
            <Search className="h-6 w-6 text-destructive" /> {openFindingsCount}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm text-muted-foreground">High / critical</CardTitle></CardHeader>
          <CardContent className="text-3xl font-bold flex items-center gap-2">
            <AlertTriangle className="h-6 w-6 text-destructive" /> {highSeverityOpen}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm text-muted-foreground">Open risk flags</CardTitle></CardHeader>
          <CardContent className="text-3xl font-bold flex items-center gap-2">
            <AlertTriangle className="h-6 w-6 text-destructive" /> {totalOpen}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm text-muted-foreground">Tasks at risk</CardTitle></CardHeader>
          <CardContent className="text-3xl font-bold flex items-center gap-2">
            <ShieldCheck className="h-6 w-6 text-primary" /> {tasksAtRisk}
          </CardContent>
        </Card>
      </div>

      <section className="space-y-3">
        <div className="flex items-baseline justify-between gap-3 flex-wrap">
          <h2 className="text-lg font-semibold">Code review findings</h2>
          <div className="flex items-center gap-1 text-xs text-muted-foreground">
            {(["critical", "high", "medium", "low", "info"] as const).map((s) =>
              findingCounts[s] ? (
                <Badge key={s} variant={sevVariant(s)} className="text-[10px]">{s}: {findingCounts[s]}</Badge>
              ) : null,
            )}
          </div>
        </div>
        {loading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : visibleFindings.length === 0 ? (
          <Card><CardContent className="py-8 text-center text-sm text-muted-foreground">
            No {showAcknowledged ? "" : "open "}findings from the scheduled code review.
          </CardContent></Card>
        ) : (
          <div className="space-y-2">
            {visibleFindings.map((f) => (
              <Card key={f.id} id={`finding-${f.id}`} className={f.acknowledged ? "opacity-60" : ""}>
                <CardContent className="pt-4 space-y-2">
                  <div className="flex items-start justify-between gap-3 flex-wrap">
                    <div className="space-y-1 min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <Badge variant={sevVariant(f.severity)} className="text-[10px] uppercase">{f.severity}</Badge>
                        {f.category && <Badge variant="outline" className="text-[10px]">{f.category}</Badge>}
                        {f.area && <Badge variant="outline" className="text-[10px]">{f.area}</Badge>}
                        <span className="text-[10px] text-muted-foreground">{new Date(f.reviewed_at).toLocaleString()}</span>
                        <span className="text-[10px] text-muted-foreground">· {f.reviewer_model}</span>
                        {f.discussion_status === "in_lovable_chat" && (
                          <Badge variant="secondary" className="text-[10px]">discussing in Lovable chat</Badge>
                        )}
                        {f.discussion_status === "copilot_open" && (
                          <Badge variant="secondary" className="text-[10px]">Copilot session open</Badge>
                        )}
                        {f.decision_outcome && (
                          <Badge variant="default" className="text-[10px]">decision: {f.decision_outcome}</Badge>
                        )}
                      </div>
                      <div className="font-medium">{f.title}</div>
                      {f.body && <div className="text-xs text-muted-foreground whitespace-pre-wrap">{f.body}</div>}
                      {f.decision_summary && (
                        <div className="text-xs italic text-muted-foreground">Rationale: {f.decision_summary}</div>
                      )}
                    </div>
                    <div className="flex flex-col gap-2 min-w-[200px] shrink-0">
                      <Button size="sm" variant="outline" onClick={() => setCopilotFor(f)}>
                        <Sparkles className="h-4 w-4 mr-1" /> Discuss with Copilot
                      </Button>
                      <Button size="sm" variant="outline" onClick={() => setChatFor(f)}>
                        <MessagesSquare className="h-4 w-4 mr-1" /> Discuss (no Copilot)
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="mt-6"
                        onClick={() => acknowledge(f.id, !f.acknowledged)}
                      >
                        {f.acknowledged ? "Reopen" : f.decision_outcome ? "Acknowledge & close" : "Acknowledge"}
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">Checklist risk flags</h2>
        {loading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : groups.length === 0 ? (
          <Card><CardContent className="py-8 text-center text-sm text-muted-foreground">
            No checklist items tagged <code>risk</code> {showResolved ? "" : "open"}. Add risk items to a task’s review checklist to track them here.
          </CardContent></Card>
        ) : (
          <div className="space-y-4">
            {groups.map((g) => (
              <Card key={g.key}>
                <CardHeader className="flex flex-row items-center justify-between gap-3 pb-3">
                  <CardTitle className="text-base">{g.title}</CardTitle>
                  <div className="flex items-center gap-2 text-xs">
                    <Badge variant="destructive">{g.open} open</Badge>
                    <Badge variant="secondary">{g.resolved} resolved</Badge>
                    <Badge variant="outline">{g.total} total</Badge>
                  </div>
                </CardHeader>
                <CardContent className="space-y-2">
                  {g.rows
                    .sort((a, b) => Number(a.checked) - Number(b.checked) || a.task_key.localeCompare(b.task_key))
                    .map((r) => (
                      <div key={r.id} className="flex items-start justify-between gap-3 rounded-md border p-3">
                        <div className="space-y-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <Badge variant={r.checked ? "secondary" : "destructive"} className="text-[10px]">
                              {r.checked ? "resolved" : "open"}
                            </Badge>
                            <span className="font-mono text-xs text-muted-foreground">{r.task_key}</span>
                            {r.module && <Badge variant="outline" className="text-[10px]">{r.module}</Badge>}
                            <Badge variant="outline" className="text-[10px]">{r.phase_key}/{r.sprint_key}</Badge>
                            <Badge variant="outline" className="text-[10px]">review: {r.task_review_status}</Badge>
                          </div>
                          <div className="text-sm font-medium">{r.label}</div>
                          <div className="text-xs text-muted-foreground truncate">{r.task_title}</div>
                          {r.note && <div className="text-xs text-muted-foreground italic">{r.note}</div>}
                        </div>
                        <Link to={`/roadmap#task-${r.task_id}`} className="shrink-0">
                          <Button size="sm" variant="outline">Open</Button>
                        </Link>
                      </div>
                    ))}
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </section>

      {copilotFor && (
        <CopilotDiscussionSheet
          open={!!copilotFor}
          onOpenChange={(o) => { if (!o) { setCopilotFor(null); load(); } }}
          findingId={copilotFor.id}
          findingTitle={copilotFor.title}
          severity={copilotFor.severity}
          onDecisionRecorded={load}
        />
      )}
      {chatFor && (
        <NoCopilotDiscussModal
          open={!!chatFor}
          onOpenChange={(o) => { if (!o) { setChatFor(null); load(); } }}
          finding={chatFor}
          onMarked={load}
        />
      )}
    </div>
  );
}
