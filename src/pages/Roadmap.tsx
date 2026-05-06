import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/hooks/use-toast";
import { ChevronDown, ChevronRight, Check, Minus, Clock, CircleAlert, Circle, MessageSquare } from "lucide-react";

type Phase = { id: string; key: string; title: string; summary: string | null; order: number; status: string };
type Sprint = { id: string; phase_id: string; key: string; title: string; goal: string | null; order: number; status: string };
type Task = {
  id: string; sprint_id: string; key: string; title: string; description: string | null;
  acceptance: string | null; status: string; owner: string | null; module: string | null;
  capability_id: string | null; order: number; updated_at: string; created_at: string;
};
type Comment = { id: string; task_id: string; author: string; body: string; kind: string; resolved: boolean; created_at: string };

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

// Tri-state checkbox: empty / indeterminate / checked
const TriCheckbox = ({ state, onClick }: { state: "empty" | "partial" | "full"; onClick?: (e: React.MouseEvent) => void }) => {
  const base = "h-4 w-4 rounded-[4px] border flex items-center justify-center shrink-0 transition";
  if (state === "full")
    return <button onClick={onClick} className={`${base} bg-primary border-primary text-primary-foreground`}><Check className="h-3 w-3" /></button>;
  if (state === "partial")
    return <button onClick={onClick} className={`${base} bg-muted border-muted-foreground/40 text-muted-foreground`}><Minus className="h-3 w-3" /></button>;
  return <button onClick={onClick} className={`${base} border-muted-foreground/40 hover:border-foreground`} />;
};

const Roadmap = () => {
  const [phases, setPhases] = useState<Phase[]>([]);
  const [sprints, setSprints] = useState<Sprint[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [comments, setComments] = useState<Comment[]>([]);
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState<Set<string>>(() => {
    try { return new Set(JSON.parse(localStorage.getItem("roadmap.collapsed") ?? "[]")); } catch { return new Set(); }
  });
  const [newComment, setNewComment] = useState("");
  const [commentKind, setCommentKind] = useState<"comment" | "question" | "decision">("comment");

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
    const [p, s, t, c] = await Promise.all([
      supabase.from("roadmap_phases").select("*").order("order"),
      supabase.from("roadmap_sprints").select("*").order("order"),
      supabase.from("roadmap_tasks").select("*").order("order"),
      supabase.from("roadmap_comments").select("*").order("created_at"),
    ]);
    if (p.data) setPhases(p.data as Phase[]);
    if (s.data) setSprints(s.data as Sprint[]);
    if (t.data) setTasks(t.data as Task[]);
    if (c.data) setComments(c.data as Comment[]);
  };

  useEffect(() => {
    loadAll();
    const ch = supabase
      .channel("roadmap")
      .on("postgres_changes", { event: "*", schema: "public", table: "roadmap_tasks" }, loadAll)
      .on("postgres_changes", { event: "*", schema: "public", table: "roadmap_comments" }, loadAll)
      .on("postgres_changes", { event: "*", schema: "public", table: "roadmap_sprints" }, loadAll)
      .on("postgres_changes", { event: "*", schema: "public", table: "roadmap_phases" }, loadAll)
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

  // Tri-state for sprint based on task children
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

  const nextUp = useMemo(() => {
    const activePhase = phases.find((p) => p.status === "active");
    if (!activePhase) return null;
    const sps = (sprintsByPhase.get(activePhase.id) ?? []).filter((s) => s.status !== "done");
    for (const s of sps) {
      const ts = tasksBySprint.get(s.id) ?? [];
      const t = ts.find((x) => x.status === "todo" || x.status === "in_progress");
      if (t) return { phase: activePhase, sprint: s, task: t };
    }
    return null;
  }, [phases, sprintsByPhase, tasksBySprint]);

  return (
    <div className="space-y-6">
      <div className="flex items-end justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Roadmap</h1>
          <p className="text-sm text-muted-foreground">Phases, sprints, tasks. Click a checkbox to cycle status.</p>
        </div>
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
                  <div className="flex items-center gap-3 mb-3 pl-6">
                    <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{phase.title}</div>
                    {phaseStatusBadge(phase.status)}
                  </div>
                  {sps.map((sprint) => {
                    const ts = tasksBySprint.get(sprint.id) ?? [];
                    return (
                      <div key={sprint.id} className="mb-4">
                        <div className="flex items-center gap-2 mb-2 pl-6">
                          <div className="text-[11px] font-mono text-muted-foreground">{sprint.key}</div>
                          <div className="text-xs">{sprint.title}</div>
                        </div>
                        {ts.map((task) => {
                          const cs = commentsByTask.get(task.id) ?? [];
                          const isSel = selectedTaskId === task.id;
                          return (
                            <div key={task.id} className="relative pl-6 py-1.5">
                              <div className="absolute left-0 top-2.5 bg-background p-0.5">
                                {taskMarker(task.status)}
                              </div>
                              <button
                                onClick={() => setSelectedTaskId(task.id)}
                                className={`text-left w-full rounded px-2 py-1 transition ${
                                  isSel ? "bg-primary/10" : "hover:bg-muted/30"
                                }`}
                              >
                                <div className="flex items-center gap-2">
                                  <span className="text-[10px] font-mono text-muted-foreground tabular-nums">
                                    {new Date(task.updated_at).toLocaleDateString()}
                                  </span>
                                  <span className="text-sm font-medium">{task.title}</span>
                                  {task.module && (
                                    <span className="text-[10px] font-mono text-muted-foreground">· {task.module}</span>
                                  )}
                                  {cs.length > 0 && (
                                    <span className="ml-auto text-[10px] text-muted-foreground flex items-center gap-0.5">
                                      <MessageSquare className="h-3 w-3" />{cs.length}
                                    </span>
                                  )}
                                </div>
                                {isSel && (
                                  <div className="mt-2 space-y-2">
                                    {task.description && (
                                      <p className="text-xs text-muted-foreground whitespace-pre-wrap">{task.description}</p>
                                    )}
                                    {task.acceptance && (
                                      <div className="text-xs">
                                        <span className="font-semibold">Acceptance: </span>
                                        <span className="text-muted-foreground">{task.acceptance}</span>
                                      </div>
                                    )}
                                    <div className="flex flex-wrap gap-1">
                                      {TASK_STATUSES.map((s) => (
                                        <button
                                          key={s}
                                          onClick={(e) => {
                                            e.stopPropagation();
                                            supabase.from("roadmap_tasks").update({ status: s }).eq("id", task.id);
                                          }}
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
                                    <div className="space-y-1.5 border-t border-border pt-2">
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
                                      <div onClick={(e) => e.stopPropagation()} className="space-y-1 pt-1">
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
                                  </div>
                                )}
                              </button>
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
