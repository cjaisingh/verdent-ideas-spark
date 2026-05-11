import { useEffect, useMemo, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";
import { ChevronLeft } from "lucide-react";
import OvernightCandidatesCard from "@/components/roadmap/OvernightCandidatesCard";

type Phase = { id: string; key: string; title: string; summary: string | null; order: number; status: string };
type Sprint = { id: string; phase_id: string; key: string; title: string; goal: string | null; order: number; status: string };
type Task = {
  id: string; sprint_id: string; key: string; title: string; description: string | null;
  acceptance: string | null; status: string; owner: string | null; module: string | null; order: number;
};

const VISION = `A modular, capability-driven operator platform: every business function is a registered capability with explicit inputs, outputs, owning module, approvals, and observability. Operators steer the system through approvals, comments, and a roadmap that doubles as a real-time control plane.`;

const statusBadge = (s: string) => {
  const map: Record<string, "default" | "secondary" | "outline" | "destructive"> = {
    done: "default", active: "secondary", in_progress: "secondary",
    planned: "outline", todo: "outline", review: "outline",
    blocked: "destructive", paused: "destructive", wont_do: "outline",
  };
  return <Badge variant={map[s] ?? "outline"} className="text-[10px] uppercase">{s.replace("_", " ")}</Badge>;
};

const taskAnchor = (sprintKey: string, taskKey: string) => `${sprintKey}-${taskKey}`;

const MasterPlan = () => {
  const [phases, setPhases] = useState<Phase[]>([]);
  const [sprints, setSprints] = useState<Sprint[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const { hash } = useLocation();

  useEffect(() => {
    (async () => {
      const [p, s, t] = await Promise.all([
        supabase.from("roadmap_phases").select("*").order("order"),
        supabase.from("roadmap_sprints").select("*").order("order"),
        supabase.from("roadmap_tasks").select("*").order("order"),
      ]);
      if (p.data) setPhases(p.data as Phase[]);
      if (s.data) setSprints(s.data as Sprint[]);
      if (t.data) setTasks(t.data as Task[]);
    })();
  }, []);

  // Scroll to hash once data is loaded
  useEffect(() => {
    if (!hash || phases.length === 0) return;
    const id = hash.slice(1);
    const el = document.getElementById(id);
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "start" });
      el.classList.add("ring-2", "ring-primary", "ring-offset-2", "rounded");
      setTimeout(() => el.classList.remove("ring-2", "ring-primary", "ring-offset-2", "rounded"), 2000);
    }
  }, [hash, phases.length]);

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

  return (
    <div className="max-w-4xl mx-auto space-y-8">
      <div>
        <Link to="/roadmap" className="text-xs text-muted-foreground hover:text-foreground inline-flex items-center gap-1">
          <ChevronLeft className="h-3 w-3" /> Back to roadmap
        </Link>
        <h1 className="text-3xl font-semibold mt-2">Master plan</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Single source of truth for what we're building. Live state — generated from the roadmap.
        </p>
      </div>

      <OvernightCandidatesCard />

      <section id="vision" className="space-y-2">
        <h2 className="text-xl font-semibold">Vision</h2>
        <p className="text-sm text-foreground/90">{VISION}</p>
      </section>

      <section id="phases" className="space-y-6">
        <h2 className="text-xl font-semibold">Phases</h2>
        {phases.map((phase) => {
          const sps = sprintsByPhase.get(phase.id) ?? [];
          return (
            <div key={phase.id} id={phase.key} className="space-y-3 scroll-mt-20 p-3 -mx-3 rounded transition">
              <div className="flex items-center gap-2">
                <h3 className="text-lg font-semibold">{phase.title}</h3>
                {statusBadge(phase.status)}
                <a href={`#${phase.key}`} className="text-xs text-muted-foreground hover:text-foreground">#{phase.key}</a>
              </div>
              {phase.summary && <p className="text-sm text-muted-foreground italic">{phase.summary}</p>}

              <div className="space-y-4 pl-4 border-l border-border">
                {sps.map((sprint) => {
                  const ts = tasksBySprint.get(sprint.id) ?? [];
                  return (
                    <div key={sprint.id} id={sprint.key} className="scroll-mt-20 p-2 -mx-2 rounded transition">
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-xs text-muted-foreground">{sprint.key}</span>
                        <h4 className="text-sm font-semibold">{sprint.title}</h4>
                        {statusBadge(sprint.status)}
                        <a href={`#${sprint.key}`} className="text-[10px] text-muted-foreground hover:text-foreground">#</a>
                      </div>
                      {sprint.goal && <p className="text-xs text-muted-foreground mt-0.5">{sprint.goal}</p>}
                      <ul className="mt-2 space-y-1.5">
                        {ts.map((task) => {
                          const anchor = taskAnchor(sprint.key, task.key);
                          return (
                            <li key={task.id} id={anchor} className="text-xs scroll-mt-20 p-1.5 rounded transition">
                              <div className="flex items-center gap-2 flex-wrap">
                                <span className="font-mono text-muted-foreground">{task.key}</span>
                                <span className="font-medium">{task.title}</span>
                                {statusBadge(task.status)}
                                {task.owner && <span className="text-muted-foreground">· {task.owner}</span>}
                                {task.module && <span className="text-muted-foreground font-mono">· {task.module}</span>}
                                <a href={`#${anchor}`} className="text-[10px] text-muted-foreground hover:text-foreground ml-auto">#{anchor}</a>
                              </div>
                              {task.description && <p className="text-muted-foreground mt-1 whitespace-pre-wrap">{task.description}</p>}
                              {task.acceptance && (
                                <p className="mt-1"><span className="font-semibold">Acceptance:</span>{" "}
                                  <span className="text-muted-foreground">{task.acceptance}</span></p>
                              )}
                            </li>
                          );
                        })}
                      </ul>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </section>

      <section id="working-agreements" className="space-y-2 pb-12">
        <h2 className="text-xl font-semibold">Working agreements</h2>
        <ul className="text-sm space-y-1 list-disc pl-5 text-foreground/90">
          <li>Every AI work session against a roadmap task logs <code>started_at</code>, <code>ended_at</code>, <code>duration_ms</code>, <code>tokens_*</code>, plus a one-line summary and any issues/fixes.</li>
          <li>Every epic (phase) has a one-paragraph summary visible on the roadmap.</li>
          <li>UK English in all user-facing copy.</li>
        </ul>
      </section>
    </div>
  );
};

export default MasterPlan;
