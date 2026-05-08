import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ChevronRight, HelpCircle } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/use-toast";
import { decideProceed, type ProceedDecision } from "@/lib/proceed";
import type { PhaseGate } from "@/hooks/useRoadmapGates";

interface NextUp {
  phase: { id: string; key: string; status: string };
  sprint: { id: string; key: string; status: string };
  task: { id: string; status: string; title: string };
}

interface Props {
  nextUp: NextUp | null;
  activePhaseGate?: PhaseGate;
  /** Tasks in the active sprint, used to detect "ready to close". */
  activeSprintAllDone?: boolean;
  onSelectTask: (taskId: string) => void;
}

export function ProceedAction({ nextUp, activePhaseGate, activeSprintAllDone, onSelectTask }: Props) {
  const navigate = useNavigate();
  const [pendingApproval, setPendingApproval] = useState(false);
  const [working, setWorking] = useState(false);

  useEffect(() => {
    if (!nextUp) { setPendingApproval(false); return; }
    let active = true;
    supabase
      .from("approval_queue")
      .select("id")
      .eq("status", "pending")
      .filter("intent_payload->>task_id", "eq", nextUp.task.id)
      .limit(1)
      .then(({ data }) => { if (active) setPendingApproval((data ?? []).length > 0); });
    return () => { active = false; };
  }, [nextUp?.task.id]);

  const decision: ProceedDecision = decideProceed({
    gate: activePhaseGate ?? null,
    nextTaskStatus: nextUp?.task.status ?? null,
    nextTaskHasPendingApproval: pendingApproval,
    activeSprintReadyToClose: activeSprintAllDone && nextUp?.sprint.status === "active",
    noActivePhase: !nextUp && !activePhaseGate,
  });

  const handleClick = async () => {
    if (decision.disabledReason || working) return;
    setWorking(true);
    try {
      switch (decision.action) {
        case "start-task": {
          if (!nextUp) return;
          const { error } = await supabase.from("roadmap_tasks").update({ status: "in_progress" }).eq("id", nextUp.task.id);
          if (error) throw error;
          onSelectTask(nextUp.task.id);
          toast({ title: "Task started" });
          break;
        }
        case "decide-approval":
        case "open-log": {
          if (nextUp) onSelectTask(nextUp.task.id);
          break;
        }
        case "close-sprint": {
          if (!nextUp) return;
          const { error } = await supabase.from("roadmap_sprints").update({ status: "done" }).eq("id", nextUp.sprint.id);
          if (error) throw error;
          toast({ title: "Sprint closed" });
          break;
        }
        case "request-signoff": {
          if (!activePhaseGate) return;
          const snapshotHash = `${activePhaseGate.open_tasks}-${activePhaseGate.qa_pass}-${activePhaseGate.night_high_open}`;
          const { data: u } = await supabase.auth.getUser();
          const { error } = await supabase.from("approval_queue").insert({
            activity: "roadmap.phase_signoff",
            risk: "medium",
            requesting_module: "operator_channel",
            requested_by: u.user?.email ?? "operator",
            idempotency_key: `phase-signoff:${activePhaseGate.phase_id}:${snapshotHash}`,
            intent_payload: {
              phase_id: activePhaseGate.phase_id,
              phase_key: activePhaseGate.phase_key,
              gate_snapshot: activePhaseGate,
            },
          } as never);
          if (error && !/duplicate|unique/i.test(error.message)) throw error;
          toast({
            title: "Sign-off requested",
            description: `Decide in Approvals (phase ${activePhaseGate.phase_key}).`,
          });
          navigate("/admin#approvals");
          break;
        }
      }
    } catch (e) {
      toast({ title: "Proceed failed", description: e instanceof Error ? e.message : String(e), variant: "destructive" });
    } finally {
      setWorking(false);
    }
  };

  const button = (
    <Button
      size="sm"
      variant={decision.disabledReason ? "outline" : "default"}
      onClick={handleClick}
      disabled={!!decision.disabledReason || working}
      className="gap-1.5"
    >
      <ChevronRight className="h-3.5 w-3.5" />
      <span className="text-xs">{decision.label}</span>
    </Button>
  );

  return (
    <div className="flex items-center gap-1">
      {decision.disabledReason ? (
        <TooltipProvider delayDuration={150}>
          <Tooltip>
            <TooltipTrigger asChild><span>{button}</span></TooltipTrigger>
            <TooltipContent side="bottom" className="max-w-xs text-xs">{decision.disabledReason}</TooltipContent>
          </Tooltip>
        </TooltipProvider>
      ) : button}
      <Popover>
        <PopoverTrigger asChild>
          <Button size="icon" variant="ghost" className="h-7 w-7 text-muted-foreground" aria-label="Why this action?">
            <HelpCircle className="h-3.5 w-3.5" />
          </Button>
        </PopoverTrigger>
        <PopoverContent side="bottom" align="end" className="w-72 text-xs space-y-1">
          <p className="font-medium text-foreground">Why “{decision.label}”?</p>
          <p className="text-muted-foreground">{decision.why}</p>
          {activePhaseGate && (
            <div className="mt-2 pt-2 border-t border-border space-y-0.5 text-muted-foreground">
              <div>Tasks open: <span className="text-foreground tabular-nums">{activePhaseGate.open_tasks}</span></div>
              <div>QA pass: <span className="text-foreground tabular-nums">{activePhaseGate.qa_pass}/{activePhaseGate.qa_total}</span></div>
              <div>Night high: <span className="text-foreground tabular-nums">{activePhaseGate.night_high_open}</span></div>
              <div>Pending sign-offs: <span className="text-foreground tabular-nums">{activePhaseGate.pending_signoffs}</span></div>
            </div>
          )}
        </PopoverContent>
      </Popover>
    </div>
  );
}
