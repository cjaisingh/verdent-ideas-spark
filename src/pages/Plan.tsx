import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Progress } from "@/components/ui/progress";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import { CheckCircle2, Circle, AlertCircle, Loader2, ChevronDown, ChevronRight } from "lucide-react";

type Status = "todo" | "in_progress" | "blocked" | "done";

type Workstream = {
  id: string;
  slug: string;
  title: string;
  summary: string | null;
  target_week: number | null;
  sort_order: number;
  status: Status;
  updated_at: string;
};

type Task = {
  id: string;
  workstream_id: string;
  title: string;
  detail: string | null;
  area: string | null;
  status: Status;
  notes: string | null;
  sort_order: number;
  updated_by_label: string | null;
  updated_at: string;
};

const STATUS_VARIANT: Record<Status, "default" | "secondary" | "destructive" | "outline"> = {
  todo: "outline",
  in_progress: "secondary",
  blocked: "destructive",
  done: "default",
};

const STATUS_LABEL: Record<Status, string> = {
  todo: "To do",
  in_progress: "In progress",
  blocked: "Blocked",
  done: "Done",
};

const STATUS_ICON: Record<Status, typeof Circle> = {
  todo: Circle,
  in_progress: Loader2,
  blocked: AlertCircle,
  done: CheckCircle2,
};

const Plan = () => {
  const [workstreams, setWorkstreams] = useState<Workstream[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [openWs, setOpenWs] = useState<Set<string>>(new Set());
  const [editingNotes, setEditingNotes] = useState<Record<string, string>>({});

  const refresh = async () => {
    setLoading(true);
    const [ws, ts] = await Promise.all([
      supabase.from("plan_workstreams").select("*").order("sort_order"),
      supabase.from("plan_tasks").select("*").order("sort_order"),
    ]);
    setLoading(false);
    if (ws.error) {
      toast.error("Failed to load workstreams", { description: ws.error.message });
      return;
    }
    if (ts.error) {
      toast.error("Failed to load tasks", { description: ts.error.message });
      return;
    }
    setWorkstreams((ws.data ?? []) as Workstream[]);
    setTasks((ts.data ?? []) as Task[]);
  };

  useEffect(() => {
    refresh();
    const ch = supabase
      .channel("plan-dashboard")
      .on("postgres_changes", { event: "*", schema: "public", table: "plan_workstreams" }, refresh)
      .on("postgres_changes", { event: "*", schema: "public", table: "plan_tasks" }, refresh)
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, []);

  const tasksByWs = useMemo(() => {
    const m = new Map<string, Task[]>();
    for (const t of tasks) {
      const list = m.get(t.workstream_id) ?? [];
      list.push(t);
      m.set(t.workstream_id, list);
    }
    return m;
  }, [tasks]);

  const totals = useMemo(() => {
    const t = { todo: 0, in_progress: 0, blocked: 0, done: 0, total: tasks.length };
    for (const x of tasks) t[x.status]++;
    return t;
  }, [tasks]);

  const wsProgress = (wsId: string): { pct: number; counts: Record<Status, number> } => {
    const list = tasksByWs.get(wsId) ?? [];
    const counts: Record<Status, number> = { todo: 0, in_progress: 0, blocked: 0, done: 0 };
    for (const t of list) counts[t.status]++;
    const pct = list.length === 0 ? 0 : Math.round((counts.done / list.length) * 100);
    return { pct, counts };
  };

  const toggleOpen = (id: string) =>
    setOpenWs((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });

  const setTaskStatus = async (task: Task, status: Status) => {
    const { data: { user } } = await supabase.auth.getUser();
    const label = user?.email ?? null;
    const { error } = await supabase
      .from("plan_tasks")
      .update({ status, updated_by: user?.id ?? null, updated_by_label: label })
      .eq("id", task.id);
    if (error) toast.error("Update failed", { description: error.message });
  };

  const setWorkstreamStatus = async (ws: Workstream, status: Status) => {
    const { error } = await supabase.from("plan_workstreams").update({ status }).eq("id", ws.id);
    if (error) toast.error("Update failed", { description: error.message });
  };

  const saveNotes = async (task: Task) => {
    const notes = editingNotes[task.id] ?? "";
    const { data: { user } } = await supabase.auth.getUser();
    const { error } = await supabase
      .from("plan_tasks")
      .update({ notes, updated_by: user?.id ?? null, updated_by_label: user?.email ?? null })
      .eq("id", task.id);
    if (error) {
      toast.error("Note save failed", { description: error.message });
      return;
    }
    setEditingNotes((s) => { const next = { ...s }; delete next[task.id]; return next; });
    toast.success("Note saved");
  };

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold">Plan</h1>
        <p className="text-sm text-muted-foreground">
          Six workstreams that close the operational loops in the AWIP ecosystem. Status updates persist
          and stream live across sessions. Source of truth lives in <code className="font-mono">.lovable/plan.md</code>.
          {" "}Objective definitions of "done" and "healthy" per workstream live in{" "}
          <code className="font-mono">docs/workstream-success-metrics.md</code>.
        </p>
      </header>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <KpiCard label="Total tasks" value={totals.total} />
        <KpiCard label="Done" value={totals.done} tone="default" />
        <KpiCard label="In progress" value={totals.in_progress} tone="secondary" />
        <KpiCard label="Blocked" value={totals.blocked} tone="destructive" />
      </div>

      {loading && workstreams.length === 0 && (
        <p className="text-sm text-muted-foreground">Loading…</p>
      )}

      <div className="space-y-3">
        {workstreams.map((ws) => {
          const { pct, counts } = wsProgress(ws.id);
          const open = openWs.has(ws.id);
          const wsTasks = tasksByWs.get(ws.id) ?? [];
          return (
            <Card key={ws.id} className="p-4 space-y-3">
              <div className="flex items-start gap-3">
                <button
                  type="button"
                  onClick={() => toggleOpen(ws.id)}
                  className="mt-0.5 text-muted-foreground hover:text-foreground"
                  aria-label={open ? "Collapse" : "Expand"}
                >
                  {open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                </button>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    {ws.target_week != null && (
                      <Badge variant="outline" className="font-mono text-xs">W{ws.target_week}</Badge>
                    )}
                    <h2 className="text-base font-medium truncate">{ws.title}</h2>
                    <Badge variant={STATUS_VARIANT[ws.status]}>{STATUS_LABEL[ws.status]}</Badge>
                    <span className="ml-auto text-xs text-muted-foreground tabular-nums">
                      {counts.done}/{wsTasks.length} done · {pct}%
                    </span>
                  </div>
                  {ws.summary && (
                    <p className="text-sm text-muted-foreground mt-1">{ws.summary}</p>
                  )}
                  <div className="mt-2 flex items-center gap-3">
                    <Progress value={pct} className="h-1.5 flex-1" />
                    <Select value={ws.status} onValueChange={(v) => setWorkstreamStatus(ws, v as Status)}>
                      <SelectTrigger className="h-7 w-32 text-xs">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {(["todo","in_progress","blocked","done"] as Status[]).map((s) => (
                          <SelectItem key={s} value={s} className="text-xs">{STATUS_LABEL[s]}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              </div>

              {open && (
                <div className="border-t border-border pt-3 space-y-2">
                  {wsTasks.length === 0 && (
                    <p className="text-sm text-muted-foreground">No tasks yet.</p>
                  )}
                  {wsTasks.map((t) => {
                    const Icon = STATUS_ICON[t.status];
                    const editing = editingNotes[t.id] !== undefined;
                    return (
                      <div key={t.id} className="rounded-md border border-border p-3 space-y-2">
                        <div className="flex items-start gap-3">
                          <Icon
                            className={`h-4 w-4 mt-0.5 shrink-0 ${
                              t.status === "done" ? "text-primary" :
                              t.status === "blocked" ? "text-destructive" :
                              t.status === "in_progress" ? "text-foreground animate-spin" :
                              "text-muted-foreground"
                            }`}
                          />
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className={`text-sm font-medium ${t.status === "done" ? "line-through text-muted-foreground" : ""}`}>
                                {t.title}
                              </span>
                              <Badge variant={STATUS_VARIANT[t.status]} className="text-[10px] py-0 px-1.5">
                                {STATUS_LABEL[t.status]}
                              </Badge>
                            </div>
                            {t.detail && (
                              <p className="text-xs text-muted-foreground mt-0.5">{t.detail}</p>
                            )}
                            {t.area && (
                              <p className="text-[11px] font-mono text-muted-foreground mt-0.5 break-all">{t.area}</p>
                            )}
                            {t.notes && !editing && (
                              <p className="text-xs mt-1 p-1.5 bg-muted/40 rounded">{t.notes}</p>
                            )}
                            {editing && (
                              <div className="mt-1 space-y-1">
                                <Textarea
                                  value={editingNotes[t.id] ?? ""}
                                  onChange={(e) => setEditingNotes((s) => ({ ...s, [t.id]: e.target.value }))}
                                  rows={2}
                                  className="text-xs"
                                  placeholder="Status note, blocker, decision…"
                                />
                                <div className="flex gap-2">
                                  <Button size="sm" variant="default" className="h-7 text-xs" onClick={() => saveNotes(t)}>Save</Button>
                                  <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => setEditingNotes((s) => { const n = { ...s }; delete n[t.id]; return n; })}>Cancel</Button>
                                </div>
                              </div>
                            )}
                            {t.updated_by_label && (
                              <p className="text-[10px] text-muted-foreground mt-1">
                                updated by {t.updated_by_label} · {new Date(t.updated_at).toLocaleString()}
                              </p>
                            )}
                          </div>
                          <div className="flex flex-col gap-1.5 items-end shrink-0">
                            <Select value={t.status} onValueChange={(v) => setTaskStatus(t, v as Status)}>
                              <SelectTrigger className="h-7 w-32 text-xs">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                {(["todo","in_progress","blocked","done"] as Status[]).map((s) => (
                                  <SelectItem key={s} value={s} className="text-xs">{STATUS_LABEL[s]}</SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                            {!editing && (
                              <Button
                                size="sm" variant="ghost" className="h-6 text-xs px-2"
                                onClick={() => setEditingNotes((s) => ({ ...s, [t.id]: t.notes ?? "" }))}
                              >
                                {t.notes ? "Edit note" : "Add note"}
                              </Button>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </Card>
          );
        })}
      </div>
    </div>
  );
};

const KpiCard = ({ label, value, tone }: { label: string; value: number; tone?: "default" | "secondary" | "destructive" }) => (
  <Card className="p-3">
    <div className="text-xs text-muted-foreground">{label}</div>
    <div className="mt-1 flex items-center gap-2">
      <span className="text-2xl font-semibold tabular-nums">{value}</span>
      {tone && <Badge variant={tone} className="text-[10px]">{tone === "default" ? "✓" : tone === "secondary" ? "…" : "!"}</Badge>}
    </div>
  </Card>
);

export default Plan;
