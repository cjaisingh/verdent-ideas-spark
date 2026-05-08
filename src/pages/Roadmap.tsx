import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/hooks/use-toast";
import { InlineEdit } from "@/components/InlineEdit";
import { TurnTracker } from "@/components/TurnTracker";
import { WorkLogPulse } from "@/components/WorkLogPulse";
import { AutomationPanel } from "@/components/AutomationPanel";
import { DailyPlanCard } from "@/components/DailyPlanCard";
import { AutoLogSettings } from "@/components/AutoLogSettings";
import { EvidencePanel } from "@/components/EvidencePanel";
import { ReviewChecklistEditor } from "@/components/ReviewChecklistEditor";
import { TaskApprovalPanel } from "@/components/TaskApprovalPanel";
import {
  ChevronDown, ChevronRight, Check, Minus, Clock, CircleAlert, Circle,
  MessageSquare, ExternalLink, Timer, Coins,
} from "lucide-react";

type Phase = { id: string; key: string; title: string; summary: string | null; order: number; status: string };
type Sprint = { id: string; phase_id: string; key: string; title: string; goal: string | null; order: number; status: string };
type Task = {
  id: string; sprint_id: string; key: string; title: string; description: string | null;
  acceptance: string | null; status: string; owner: string | null; module: string | null;
  capability_id: string | null; order: number; updated_at: string; created_at: string;
  review_status?: "pending" | "approved" | "rejected" | "changes_requested" | null;
  reviewed_by?: string | null; reviewed_at?: string | null; review_notes?: string | null;
};
type Comment = { id: string; task_id: string; author: string; body: string; kind: string; resolved: boolean; created_at: string };
type WorkLog = {
  id: string; task_id: string; started_at: string; ended_at: string | null;
  duration_ms: number | null; tokens_in: number | null; tokens_out: number | null;
  tokens_total: number | null; model: string | null; model_provider: string | null;
  summary: string | null; issues: string | null; fixes: string | null;
  author: string | null; created_at: string; source: string | null;
  prompt_preview: string | null; response_preview: string | null;
  request_meta: Record<string, unknown> | null; response_meta: Record<string, unknown> | null;
};
type Activity = {
  id: string; task_id: string; field: string;
  old_value: string | null; new_value: string | null;
  author_label: string | null; created_at: string;
};
const TASK_STATUSES = ["todo", "in_progress", "blocked", "review", "done", "wont_do"] as const;

const taskMarker = (status: string) => {
  switch (status) {
    case "done": return <div className="h-3 w-3 rounded-full bg-emerald-500 ring-2 ring-emerald-500/30" />;
    case "in_progress": return <Clock className="h-4 w-4 text-blue-500" />;
    case "blocked": return <CircleAlert className="h-4 w-4 text-destructive" />;
    case "review": return <div className="h-3 w-3 rounded-full border-2 border-amber-500" />;
    case "wont_do": return <div className="h-3 w-3 rounded-full bg-muted" />;
    default: return <Circle className="h-3.5 w-3.5 text-muted-foreground" />;
  }
};

const phaseStatusBadge = (s: string) => {
  const map: Record<string, "default" | "secondary" | "outline" | "destructive"> = {
    done: "default", active: "secondary", planned: "outline", paused: "destructive",
  };
  return <Badge variant={map[s] ?? "outline"} className="text-[10px] uppercase">{s}</Badge>;
};

const TriCheckbox = ({ state, onClick }: { state: "empty" | "partial" | "full"; onClick?: (e: React.MouseEvent) => void }) => {
  const base = "h-4 w-4 rounded-[4px] border flex items-center justify-center shrink-0 transition";
  if (state === "full")
    return <button onClick={onClick} className={`${base} bg-primary border-primary text-primary-foreground`}><Check className="h-3 w-3" /></button>;
  if (state === "partial")
    return <button onClick={onClick} className={`${base} bg-muted border-muted-foreground/40 text-muted-foreground`}><Minus className="h-3 w-3" /></button>;
  return <button onClick={onClick} className={`${base} border-muted-foreground/40 hover:border-foreground`} />;
};

const fmtDuration = (ms: number | null) => {
  if (!ms || ms < 0) return "—";
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m`;
};

const Roadmap = () => {
  const [phases, setPhases] = useState<Phase[]>([]);
  const [sprints, setSprints] = useState<Sprint[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [comments, setComments] = useState<Comment[]>([]);
  const [workLogs, setWorkLogs] = useState<WorkLog[]>([]);
  const [activity, setActivity] = useState<Activity[]>([]);
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState<Set<string>>(() => {
    try { return new Set(JSON.parse(localStorage.getItem("roadmap.collapsed") ?? "[]")); } catch { return new Set(); }
  });
  const [newComment, setNewComment] = useState("");
  const [commentKind, setCommentKind] = useState<"comment" | "question" | "decision">("comment");

  // Work-log form state
  const [logForm, setLogForm] = useState({
    started_at: "", ended_at: "", tokens_in: "", tokens_out: "",
    model: "", summary: "", issues: "", fixes: "",
  });

  const persistCollapsed = (s: Set<string>) => {
    setCollapsed(new Set(s));
    localStorage.setItem("roadmap.collapsed", JSON.stringify([...s]));
  };
  const toggleCollapse = (id: string) => {
    const next = new Set(collapsed);
    next.has(id) ? next.delete(id) : next.add(id);
    persistCollapsed(next);
  };

  const loadAll = async () => {
    const [p, s, t, c, w, a] = await Promise.all([
      supabase.from("roadmap_phases").select("*").order("order"),
      supabase.from("roadmap_sprints").select("*").order("order"),
      supabase.from("roadmap_tasks").select("*").order("order"),
      supabase.from("roadmap_comments").select("*").order("created_at"),
      supabase.from("roadmap_work_log").select("*").order("started_at", { ascending: false }),
      supabase.from("roadmap_task_activity").select("*").order("created_at", { ascending: false }),
    ]);
    if (p.data) setPhases(p.data as Phase[]);
    if (s.data) setSprints(s.data as Sprint[]);
    if (t.data) setTasks(t.data as Task[]);
    if (c.data) setComments(c.data as Comment[]);
    if (w.data) setWorkLogs(w.data as WorkLog[]);
    if (a.data) setActivity(a.data as Activity[]);
  };

  useEffect(() => {
    loadAll();
    const ch = supabase
      .channel("roadmap")
      .on("postgres_changes", { event: "*", schema: "public", table: "roadmap_tasks" }, loadAll)
      .on("postgres_changes", { event: "*", schema: "public", table: "roadmap_comments" }, loadAll)
      .on("postgres_changes", { event: "*", schema: "public", table: "roadmap_sprints" }, loadAll)
      .on("postgres_changes", { event: "*", schema: "public", table: "roadmap_phases" }, loadAll)
      .on("postgres_changes", { event: "*", schema: "public", table: "roadmap_work_log" }, loadAll)
      .on("postgres_changes", { event: "*", schema: "public", table: "roadmap_task_activity" }, loadAll)
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, []);

  const sprintsByPhase = useMemo(() => {
    const m = new Map<string, Sprint[]>();
    for (const s of sprints) {
      if (!m.has(s.phase_id)) m.set(s.phase_id, []);
      m.get(s.phase_id)!.push(s);
    }
    return m;
  }, [sprints]);

  const tasksBySprint = useMemo(() => {
    const m = new Map<string, Task[]>();
    for (const t of tasks) {
      if (!m.has(t.sprint_id)) m.set(t.sprint_id, []);
      m.get(t.sprint_id)!.push(t);
    }
    return m;
  }, [tasks]);

  const commentsByTask = useMemo(() => {
    const m = new Map<string, Comment[]>();
    for (const c of comments) {
      if (!m.has(c.task_id)) m.set(c.task_id, []);
      m.get(c.task_id)!.push(c);
    }
    return m;
  }, [comments]);

  const logsByTask = useMemo(() => {
    const m = new Map<string, WorkLog[]>();
    for (const l of workLogs) {
      if (!m.has(l.task_id)) m.set(l.task_id, []);
      m.get(l.task_id)!.push(l);
    }
    return m;
  }, [workLogs]);

  const activityByTask = useMemo(() => {
    const m = new Map<string, Activity[]>();
    for (const a of activity) {
      if (!m.has(a.task_id)) m.set(a.task_id, []);
      m.get(a.task_id)!.push(a);
    }
    return m;
  }, [activity]);

  const sprintTriState = (sprintId: string): "empty" | "partial" | "full" => {
    const ts = tasksBySprint.get(sprintId) ?? [];
    if (ts.length === 0) return "empty";
    const done = ts.filter((t) => t.status === "done" || t.status === "wont_do").length;
    if (done === ts.length) return "full";
    if (done === 0 && !ts.some((t) => t.status === "in_progress" || t.status === "review")) return "empty";
    return "partial";
  };
  const phaseTriState = (phaseId: string): "empty" | "partial" | "full" => {
    const sps = sprintsByPhase.get(phaseId) ?? [];
    if (sps.length === 0) return "empty";
    const states = sps.map((s) => sprintTriState(s.id));
    if (states.every((x) => x === "full")) return "full";
    if (states.every((x) => x === "empty")) return "empty";
    return "partial";
  };

  const cycleTaskStatus = async (task: Task) => {
    const idx = TASK_STATUSES.indexOf(task.status as typeof TASK_STATUSES[number]);
    const next = TASK_STATUSES[(idx + 1) % TASK_STATUSES.length];
    const { error } = await supabase.from("roadmap_tasks").update({ status: next }).eq("id", task.id);
    if (error) toast({ title: "Update failed", description: error.message, variant: "destructive" });
  };

  const updateTaskField = async (taskId: string, field: "title" | "description" | "acceptance", value: string) => {
    const patch: { title?: string; description?: string | null; acceptance?: string | null } =
      field === "title" ? { title: value } : field === "description" ? { description: value || null } : { acceptance: value || null };
    const { error } = await supabase.from("roadmap_tasks").update(patch).eq("id", taskId);
    if (error) toast({ title: "Save failed", description: error.message, variant: "destructive" });
  };
  const updatePhaseSummary = async (phaseId: string, value: string) => {
    const { error } = await supabase.from("roadmap_phases").update({ summary: value || null }).eq("id", phaseId);
    if (error) toast({ title: "Save failed", description: error.message, variant: "destructive" });
  };
  const updateSprintGoal = async (sprintId: string, value: string) => {
    const { error } = await supabase.from("roadmap_sprints").update({ goal: value || null }).eq("id", sprintId);
    if (error) toast({ title: "Save failed", description: error.message, variant: "destructive" });
  };

  const selected = tasks.find((t) => t.id === selectedTaskId) ?? null;

  const submitComment = async () => {
    if (!selected || !newComment.trim()) return;
    const { data: u } = await supabase.auth.getUser();
    const author = u.user?.email ?? "operator";
    const { error } = await supabase.from("roadmap_comments").insert({
      task_id: selected.id, author, body: newComment.trim(), kind: commentKind,
    });
    if (error) {
      toast({ title: "Comment failed", description: error.message, variant: "destructive" });
      return;
    }
    setNewComment("");
  };

  const submitWorkLog = async () => {
    if (!selected) return;
    if (!logForm.started_at) {
      toast({ title: "Start time required", variant: "destructive" });
      return;
    }
    const started = new Date(logForm.started_at);
    const ended = logForm.ended_at ? new Date(logForm.ended_at) : null;
    const duration_ms = ended ? ended.getTime() - started.getTime() : null;
    const tokens_in = logForm.tokens_in ? parseInt(logForm.tokens_in, 10) : null;
    const tokens_out = logForm.tokens_out ? parseInt(logForm.tokens_out, 10) : null;
    const tokens_total = (tokens_in ?? 0) + (tokens_out ?? 0) || null;
    const { data: u } = await supabase.auth.getUser();
    const { error } = await supabase.from("roadmap_work_log").insert({
      task_id: selected.id,
      started_at: started.toISOString(),
      ended_at: ended?.toISOString() ?? null,
      duration_ms,
      tokens_in, tokens_out, tokens_total,
      model: logForm.model || null,
      summary: logForm.summary || null,
      issues: logForm.issues || null,
      fixes: logForm.fixes || null,
      author: u.user?.email ?? "operator",
    });
    if (error) {
      toast({ title: "Log failed", description: error.message, variant: "destructive" });
      return;
    }
    setLogForm({ started_at: "", ended_at: "", tokens_in: "", tokens_out: "", model: "", summary: "", issues: "", fixes: "" });
    toast({ title: "Work logged" });
  };

  const nextUp = useMemo(() => {
    const activePhase = phases.find((p) => p.status === "active");
    if (!activePhase) return null;
    const sps = (sprintsByPhase.get(activePhase.id) ?? []).filter((s) => s.status !== "done");
    // Prefer any in_progress task across the active phase.
    for (const s of sps) {
      const ts = tasksBySprint.get(s.id) ?? [];
      const t = ts.find((x) => x.status === "in_progress");
      if (t) return { phase: activePhase, sprint: s, task: t };
    }
    // Fallback: first todo in earliest sprint.
    for (const s of sps) {
      const ts = tasksBySprint.get(s.id) ?? [];
      const t = ts.find((x) => x.status === "todo");
      if (t) return { phase: activePhase, sprint: s, task: t };
    }
    return null;
  }, [phases, sprintsByPhase, tasksBySprint]);

  return (
    <div className="space-y-6">
      <div className="flex items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Roadmap</h1>
          <p className="text-sm text-muted-foreground">
            Phases, sprints, tasks. Click a checkbox to cycle status. Click any text to edit.
          </p>
          <Link
            to="/master-plan"
            className="text-xs text-muted-foreground hover:text-foreground inline-flex items-center gap-1 mt-1"
          >
            View master plan <ExternalLink className="h-3 w-3" />
          </Link>
        </div>
        <div className="flex items-center gap-2">
          <AutoLogSettings />
          <WorkLogPulse />
          <TurnTracker nextUpTaskId={nextUp?.task.id ?? null} />
          {nextUp && (
            <button
              onClick={() => setSelectedTaskId(nextUp.task.id)}
              className="text-left rounded-md border border-border bg-muted/40 hover:bg-muted px-3 py-2 transition"
            >
              <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Next up</div>
              <div className="text-sm font-medium">{nextUp.task.title}</div>
              <div className="text-xs text-muted-foreground font-mono">{nextUp.phase.key} · {nextUp.sprint.key}</div>
            </button>
          )}
        </div>
      </div>

      <DailyPlanCard />
      <AutomationPanel />

      <div className="grid grid-cols-12 gap-4">
        {/* TREE */}
        <div className="col-span-5 border border-border rounded-md p-2 max-h-[75vh] overflow-auto">
          {phases.map((phase) => {
            const phaseCollapsed = collapsed.has(phase.id);
            const sps = sprintsByPhase.get(phase.id) ?? [];
            return (
              <div key={phase.id} className="select-none">
                <div className="flex items-center gap-2 py-1.5 px-1 hover:bg-muted/40 rounded">
                  <button onClick={() => toggleCollapse(phase.id)} className="text-muted-foreground">
                    {phaseCollapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                  </button>
                  <TriCheckbox state={phaseTriState(phase.id)} />
                  <span className="text-sm font-medium flex-1 truncate">{phase.title}</span>
                  {phaseStatusBadge(phase.status)}
                </div>
                {!phaseCollapsed && sps.map((sprint) => {
                  const sprintCollapsed = collapsed.has(sprint.id);
                  const ts = tasksBySprint.get(sprint.id) ?? [];
                  return (
                    <div key={sprint.id} className="ml-6">
                      <div className="flex items-center gap-2 py-1 px-1 hover:bg-muted/40 rounded">
                        <button onClick={() => toggleCollapse(sprint.id)} className="text-muted-foreground">
                          {sprintCollapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                        </button>
                        <TriCheckbox state={sprintTriState(sprint.id)} />
                        <span className="text-sm flex-1 truncate">{sprint.title}</span>
                        <span className="text-[10px] font-mono text-muted-foreground">
                          {ts.filter((t) => t.status === "done").length}/{ts.length}
                        </span>
                      </div>
                      {!sprintCollapsed && ts.map((task) => {
                        const cs = commentsByTask.get(task.id) ?? [];
                        const isSel = selectedTaskId === task.id;
                        const isDone = task.status === "done" || task.status === "wont_do";
                        return (
                          <div
                            key={task.id}
                            onClick={() => setSelectedTaskId(task.id)}
                            className={`ml-6 flex items-center gap-2 py-1 px-2 rounded cursor-pointer ${
                              isSel ? "bg-primary/10" : "hover:bg-muted/40"
                            }`}
                          >
                            <TriCheckbox
                              state={isDone ? "full" : task.status === "in_progress" || task.status === "review" ? "partial" : "empty"}
                              onClick={(e) => { e.stopPropagation(); cycleTaskStatus(task); }}
                            />
                            <span className={`text-sm flex-1 truncate ${isDone ? "text-muted-foreground line-through" : ""}`}>
                              {task.title}
                            </span>
                            {cs.length > 0 && (
                              <span className="text-[10px] text-muted-foreground flex items-center gap-0.5">
                                <MessageSquare className="h-3 w-3" />{cs.length}
                              </span>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>

        {/* TIMELINE */}
        <div className="col-span-7 border border-border rounded-md p-4 max-h-[75vh] overflow-auto">
          <div className="relative">
            <div className="absolute left-[7px] top-0 bottom-0 w-px bg-border" aria-hidden />
            {phases.map((phase) => {
              const sps = sprintsByPhase.get(phase.id) ?? [];
              return (
                <div key={phase.id} className="mb-6">
                  <div className="flex items-center gap-3 mb-1 pl-6">
                    <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{phase.title}</div>
                    {phaseStatusBadge(phase.status)}
                    <Link
                      to={`/master-plan#${phase.key}`}
                      className="text-[10px] text-muted-foreground hover:text-foreground inline-flex items-center gap-0.5"
                      title="Open in master plan"
                    >
                      <ExternalLink className="h-3 w-3" />
                    </Link>
                  </div>
                  <div className="pl-6 mb-3 text-xs">
                    <InlineEdit
                      value={phase.summary}
                      onSave={(v) => updatePhaseSummary(phase.id, v)}
                      multiline
                      placeholder="Add an epic description…"
                      textClassName="text-muted-foreground italic"
                    />
                  </div>
                  {sps.map((sprint) => {
                    const ts = tasksBySprint.get(sprint.id) ?? [];
                    return (
                      <div key={sprint.id} className="mb-4">
                        <div className="flex items-center gap-2 mb-1 pl-6">
                          <div className="text-[11px] font-mono text-muted-foreground">{sprint.key}</div>
                          <div className="text-xs">{sprint.title}</div>
                          <Link
                            to={`/master-plan#${sprint.key}`}
                            className="text-[10px] text-muted-foreground hover:text-foreground"
                            title="Open in master plan"
                          >
                            <ExternalLink className="h-3 w-3" />
                          </Link>
                        </div>
                        <div className="pl-6 mb-2 text-[11px]">
                          <InlineEdit
                            value={sprint.goal}
                            onSave={(v) => updateSprintGoal(sprint.id, v)}
                            multiline
                            placeholder="Add a sprint goal…"
                            textClassName="text-muted-foreground"
                          />
                        </div>
                        {ts.map((task) => {
                          const cs = commentsByTask.get(task.id) ?? [];
                          const ls = logsByTask.get(task.id) ?? [];
                          const totalMs = ls.reduce((acc, l) => acc + (l.duration_ms ?? 0), 0);
                          const totalTokens = ls.reduce((acc, l) => acc + (l.tokens_total ?? 0), 0);
                          const isSel = selectedTaskId === task.id;
                          return (
                            <div key={task.id} className="relative pl-6 py-1.5">
                              <div className="absolute left-0 top-2.5 bg-background p-0.5">
                                {taskMarker(task.status)}
                              </div>
                              <div
                                onClick={() => setSelectedTaskId(task.id)}
                                className={`text-left w-full rounded px-2 py-1 transition cursor-pointer ${
                                  isSel ? "bg-primary/10" : "hover:bg-muted/30"
                                }`}
                              >
                                <div className="flex items-center gap-2 flex-wrap">
                                  <span className="text-[10px] font-mono text-muted-foreground tabular-nums">
                                    {new Date(task.updated_at).toLocaleDateString()}
                                  </span>
                                  {isSel ? (
                                    <div className="flex-1 min-w-[200px]" onClick={(e) => e.stopPropagation()}>
                                      <InlineEdit
                                        value={task.title}
                                        onSave={(v) => updateTaskField(task.id, "title", v)}
                                        placeholder="Task title"
                                        textClassName="text-sm font-medium"
                                      />
                                    </div>
                                  ) : (
                                    <span className="text-sm font-medium">{task.title}</span>
                                  )}
                                  {task.module && (
                                    <span className="text-[10px] font-mono text-muted-foreground">· {task.module}</span>
                                  )}
                                  {task.review_status && task.review_status !== "pending" && (
                                    <span
                                      className={`text-[9px] uppercase font-mono px-1 py-0 rounded border ${
                                        task.review_status === "approved"
                                          ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-700"
                                          : task.review_status === "rejected"
                                          ? "border-destructive/40 bg-destructive/10 text-destructive"
                                          : "border-amber-500/40 bg-amber-500/10 text-amber-700"
                                      }`}
                                      title={task.reviewed_by ? `${task.review_status} by ${task.reviewed_by}` : task.review_status}
                                    >
                                      {task.review_status === "changes_requested" ? "changes" : task.review_status}
                                    </span>
                                  )}
                                  <div className="ml-auto flex items-center gap-2 text-[10px] text-muted-foreground">
                                    {totalMs > 0 && (
                                      <span className="flex items-center gap-0.5"><Timer className="h-3 w-3" />{fmtDuration(totalMs)}</span>
                                    )}
                                    {totalTokens > 0 && (
                                      <span className="flex items-center gap-0.5"><Coins className="h-3 w-3" />{totalTokens.toLocaleString()}</span>
                                    )}
                                    {cs.length > 0 && (
                                      <span className="flex items-center gap-0.5"><MessageSquare className="h-3 w-3" />{cs.length}</span>
                                    )}
                                    <Link
                                      to={`/master-plan#${sprint.key}-${task.key}`}
                                      onClick={(e) => e.stopPropagation()}
                                      className="hover:text-foreground"
                                      title="Open in master plan"
                                    >
                                      <ExternalLink className="h-3 w-3" />
                                    </Link>
                                  </div>
                                </div>

                                {isSel && (
                                  <div className="mt-3 space-y-3" onClick={(e) => e.stopPropagation()}>
                                    <div>
                                      <div className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1">Description</div>
                                      <div className="text-xs">
                                        <InlineEdit
                                          value={task.description}
                                          onSave={(v) => updateTaskField(task.id, "description", v)}
                                          multiline
                                          placeholder="Add a description…"
                                          textClassName="text-muted-foreground"
                                        />
                                      </div>
                                    </div>
                                    <div>
                                      <div className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1">Acceptance criteria</div>
                                      <div className="text-xs">
                                        <InlineEdit
                                          value={task.acceptance}
                                          onSave={(v) => updateTaskField(task.id, "acceptance", v)}
                                          multiline
                                          placeholder="Add acceptance criteria…"
                                          textClassName="text-muted-foreground"
                                        />
                                      </div>
                                    </div>

                                    <div className="flex flex-wrap gap-1">
                                      {TASK_STATUSES.map((s) => (
                                        <button
                                          key={s}
                                          onClick={() =>
                                            supabase.from("roadmap_tasks").update({ status: s }).eq("id", task.id)
                                          }
                                          className={`text-[10px] px-1.5 py-0.5 rounded border ${
                                            task.status === s
                                              ? "bg-primary text-primary-foreground border-primary"
                                              : "border-border text-muted-foreground hover:text-foreground"
                                          }`}
                                        >
                                          {s}
                                        </button>
                                      ))}
                                    </div>

                                    {/* Comments */}
                                    <div className="space-y-1.5 border-t border-border pt-2">
                                      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Comments</div>
                                      {cs.map((c) => (
                                        <div key={c.id} className="text-xs">
                                          <span className={`font-mono mr-1 ${
                                            c.kind === "question" ? "text-amber-500" :
                                            c.kind === "decision" ? "text-emerald-500" : "text-muted-foreground"
                                          }`}>[{c.kind}]</span>
                                          <span className="font-medium">{c.author}:</span>{" "}
                                          <span className="text-muted-foreground">{c.body}</span>
                                        </div>
                                      ))}
                                      <div className="space-y-1 pt-1">
                                        <Textarea
                                          value={newComment}
                                          onChange={(e) => setNewComment(e.target.value)}
                                          placeholder="Add a comment, question, or decision…"
                                          className="text-xs min-h-[60px]"
                                        />
                                        <div className="flex gap-1 items-center">
                                          {(["comment", "question", "decision"] as const).map((k) => (
                                            <button
                                              key={k}
                                              onClick={() => setCommentKind(k)}
                                              className={`text-[10px] px-2 py-0.5 rounded border ${
                                                commentKind === k
                                                  ? "bg-secondary text-secondary-foreground border-secondary"
                                                  : "border-border text-muted-foreground"
                                              }`}
                                            >
                                              {k}
                                            </button>
                                          ))}
                                          <Button size="sm" className="ml-auto h-7 text-xs" onClick={submitComment} disabled={!newComment.trim()}>
                                            Post
                                          </Button>
                                        </div>
                                      </div>
                                    </div>

                                    {/* Review checklist */}
                                    <div className="border-t border-border pt-2">
                                      <ReviewChecklistEditor taskId={task.id} />
                                    </div>

                                    {/* Research evidence */}
                                    <div className="border-t border-border pt-2">
                                      <EvidencePanel taskId={task.id} />
                                    </div>
                                    {(() => {
                                      const acts = activityByTask.get(task.id) ?? [];
                                      if (acts.length === 0) return null;
                                      const trunc = (v: string | null) => {
                                        if (!v) return <span className="italic text-muted-foreground">empty</span>;
                                        const s = v.length > 60 ? v.slice(0, 60) + "…" : v;
                                        return <span className="font-mono">"{s}"</span>;
                                      };
                                      return (
                                        <div className="space-y-1.5 border-t border-border pt-2">
                                          <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Activity</div>
                                          <div className="space-y-1 max-h-48 overflow-auto">
                                            {acts.map((a) => (
                                              <div key={a.id} className="text-[11px] flex gap-2 items-start">
                                                <span className="font-mono text-muted-foreground tabular-nums shrink-0">
                                                  {new Date(a.created_at).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}
                                                </span>
                                                <span className="text-muted-foreground">{a.author_label ?? "system"}</span>
                                                <span className="flex-1">
                                                  {a.field === "status" ? (
                                                    <>changed <span className="font-semibold">status</span> from <span className="font-mono">{a.old_value ?? "—"}</span> to <span className="font-mono">{a.new_value ?? "—"}</span></>
                                                  ) : (
                                                    <>edited <span className="font-semibold">{a.field}</span>: {trunc(a.old_value)} → {trunc(a.new_value)}</>
                                                  )}
                                                </span>
                                              </div>
                                            ))}
                                          </div>
                                        </div>
                                      );
                                    })()}

                                    {/* Work log */}
                                    <div className="space-y-2 border-t border-border pt-2">
                                      <div className="flex items-center justify-between">
                                        <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Work log</div>
                                        <div className="text-[10px] text-muted-foreground">
                                          {ls.length} entries · {fmtDuration(totalMs)} · {totalTokens.toLocaleString()} tokens
                                        </div>
                                      </div>
                                      {ls.length > 0 && (
                                        <div className="space-y-1">
                                          {ls.map((l) => (
                                            <div key={l.id} className="text-[11px] border border-border rounded p-1.5 bg-muted/20">
                                              <div className="flex items-center gap-2 flex-wrap text-muted-foreground">
                                                <span className="font-mono">{new Date(l.started_at).toLocaleString()}</span>
                                                <span>· {fmtDuration(l.duration_ms)}</span>
                                                {l.tokens_total != null && <span>· {l.tokens_total.toLocaleString()} tok</span>}
                                                {(l.tokens_in != null || l.tokens_out != null) && (
                                                  <span className="opacity-70">({l.tokens_in ?? 0}↑ / {l.tokens_out ?? 0}↓)</span>
                                                )}
                                                {l.model && (
                                                  <span>· <span className="font-mono">{l.model}</span>
                                                    {l.model_provider && <span className="opacity-70"> [{l.model_provider}]</span>}
                                                  </span>
                                                )}
                                                {l.source && <span className="px-1 rounded bg-muted">{l.source}</span>}
                                                {l.author && <span>· {l.author}</span>}
                                              </div>
                                              {l.summary && <div className="mt-0.5">{l.summary}</div>}
                                              {(l.issues || l.fixes) && (
                                                <div className="mt-0.5 grid grid-cols-2 gap-2 text-muted-foreground">
                                                  {l.issues && <div><span className="font-semibold">Issues:</span> {l.issues}</div>}
                                                  {l.fixes && <div><span className="font-semibold">Fixes:</span> {l.fixes}</div>}
                                                </div>
                                              )}
                                              {(l.prompt_preview || l.response_preview || (l.request_meta && Object.keys(l.request_meta).length) || (l.response_meta && Object.keys(l.response_meta).length)) && (
                                                <details className="mt-1">
                                                  <summary className="cursor-pointer text-muted-foreground hover:text-foreground">Audit metadata</summary>
                                                  <div className="mt-1 space-y-1 pl-2 border-l border-border">
                                                    {l.prompt_preview && (
                                                      <div><div className="text-[10px] uppercase text-muted-foreground">Prompt</div>
                                                        <div className="font-mono whitespace-pre-wrap break-words">{l.prompt_preview}</div></div>
                                                    )}
                                                    {l.response_preview && (
                                                      <div><div className="text-[10px] uppercase text-muted-foreground">Response</div>
                                                        <div className="font-mono whitespace-pre-wrap break-words">{l.response_preview}</div></div>
                                                    )}
                                                    {l.request_meta && Object.keys(l.request_meta).length > 0 && (
                                                      <div><div className="text-[10px] uppercase text-muted-foreground">Request meta</div>
                                                        <pre className="font-mono text-[10px] whitespace-pre-wrap break-words">{JSON.stringify(l.request_meta, null, 2)}</pre></div>
                                                    )}
                                                    {l.response_meta && Object.keys(l.response_meta).length > 0 && (
                                                      <div><div className="text-[10px] uppercase text-muted-foreground">Response meta</div>
                                                        <pre className="font-mono text-[10px] whitespace-pre-wrap break-words">{JSON.stringify(l.response_meta, null, 2)}</pre></div>
                                                    )}
                                                  </div>
                                                </details>
                                              )}
                                            </div>
                                          ))}
                                        </div>
                                      )}
                                      <div className="grid grid-cols-2 gap-1.5 pt-1">
                                        <div>
                                          <label className="text-[10px] text-muted-foreground">Start</label>
                                          <Input type="datetime-local" value={logForm.started_at}
                                            onChange={(e) => setLogForm({ ...logForm, started_at: e.target.value })}
                                            className="h-7 text-xs" />
                                        </div>
                                        <div>
                                          <label className="text-[10px] text-muted-foreground">End</label>
                                          <Input type="datetime-local" value={logForm.ended_at}
                                            onChange={(e) => setLogForm({ ...logForm, ended_at: e.target.value })}
                                            className="h-7 text-xs" />
                                        </div>
                                        <div>
                                          <label className="text-[10px] text-muted-foreground">Tokens in</label>
                                          <Input type="number" value={logForm.tokens_in}
                                            onChange={(e) => setLogForm({ ...logForm, tokens_in: e.target.value })}
                                            className="h-7 text-xs" />
                                        </div>
                                        <div>
                                          <label className="text-[10px] text-muted-foreground">Tokens out</label>
                                          <Input type="number" value={logForm.tokens_out}
                                            onChange={(e) => setLogForm({ ...logForm, tokens_out: e.target.value })}
                                            className="h-7 text-xs" />
                                        </div>
                                        <div className="col-span-2">
                                          <label className="text-[10px] text-muted-foreground">Model</label>
                                          <Input value={logForm.model} placeholder="e.g. claude-sonnet-4.5"
                                            onChange={(e) => setLogForm({ ...logForm, model: e.target.value })}
                                            className="h-7 text-xs" />
                                        </div>
                                        <div className="col-span-2">
                                          <label className="text-[10px] text-muted-foreground">Summary</label>
                                          <Textarea value={logForm.summary}
                                            onChange={(e) => setLogForm({ ...logForm, summary: e.target.value })}
                                            placeholder="What was done"
                                            className="text-xs min-h-[40px]" />
                                        </div>
                                        <div>
                                          <label className="text-[10px] text-muted-foreground">Issues</label>
                                          <Textarea value={logForm.issues}
                                            onChange={(e) => setLogForm({ ...logForm, issues: e.target.value })}
                                            className="text-xs min-h-[40px]" />
                                        </div>
                                        <div>
                                          <label className="text-[10px] text-muted-foreground">Fixes</label>
                                          <Textarea value={logForm.fixes}
                                            onChange={(e) => setLogForm({ ...logForm, fixes: e.target.value })}
                                            className="text-xs min-h-[40px]" />
                                        </div>
                                      </div>
                                      <Button size="sm" className="h-7 text-xs" onClick={submitWorkLog}>
                                        Log work
                                      </Button>
                                    </div>
                                  </div>
                                )}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    );
                  })}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
};

export default Roadmap;
