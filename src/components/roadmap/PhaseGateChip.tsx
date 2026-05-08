import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { AlertTriangle, CheckCircle2 } from "lucide-react";
import type { PhaseGate } from "@/hooks/useRoadmapGates";

interface Props {
  phaseStatus: string;
  gate?: PhaseGate;
}

function blockerLines(g: PhaseGate): string[] {
  const lines: string[] = [];
  if (!g.structural_ok) lines.push(`${g.open_tasks} open task(s)`);
  if (!g.qa_ok) lines.push(g.qa_total === 0 ? "No QA checks defined for phase" : `${g.qa_total - g.qa_pass} QA check(s) not passing`);
  if (!g.night_ok) lines.push(`${g.night_high_open} high-severity night audit(s)`);
  if (!g.approvals_ok) lines.push(`${g.pending_signoffs} pending sign-off(s)`);
  return lines;
}

export function PhaseGateBadge({ phaseStatus, gate }: Props) {
  const map: Record<string, "default" | "secondary" | "outline" | "destructive"> = {
    done: "default", active: "secondary", planned: "outline", paused: "destructive",
  };
  const baseVariant = map[phaseStatus] ?? "outline";

  // DONE but not all gates pass: amber warn variant
  if (phaseStatus === "done" && gate && !gate.all_ok) {
    return (
      <TooltipProvider delayDuration={150}>
        <Tooltip>
          <TooltipTrigger asChild>
            <Badge variant="outline" className="text-[10px] uppercase border-amber-500 text-amber-600 dark:text-amber-400 gap-1">
              <AlertTriangle className="h-3 w-3" /> Done · gates fail
            </Badge>
          </TooltipTrigger>
          <TooltipContent side="bottom" className="max-w-xs">
            <p className="font-medium mb-1">Phase marked done but gates fail:</p>
            <ul className="text-xs space-y-0.5 list-disc pl-4">
              {blockerLines(gate).map((l) => <li key={l}>{l}</li>)}
            </ul>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    );
  }

  // Active and ready to sign off
  if (phaseStatus === "active" && gate?.all_ok) {
    return (
      <Badge variant="outline" className="text-[10px] uppercase border-emerald-500 text-emerald-600 dark:text-emerald-400 gap-1">
        <CheckCircle2 className="h-3 w-3" /> Ready to sign off
      </Badge>
    );
  }

  return <Badge variant={baseVariant} className="text-[10px] uppercase">{phaseStatus}</Badge>;
}

export function PhaseGateChip({ gate }: { gate?: PhaseGate }) {
  if (!gate) return null;
  if (gate.all_ok) {
    return (
      <div className="flex items-center gap-1.5 text-xs text-emerald-600 dark:text-emerald-400">
        <CheckCircle2 className="h-3.5 w-3.5" />
        <span>All gates pass — ready for sign-off</span>
      </div>
    );
  }
  const lines = blockerLines(gate);
  if (lines.length === 0) return null;
  return (
    <div className="flex items-start gap-1.5 text-xs text-muted-foreground">
      <AlertTriangle className="h-3.5 w-3.5 mt-0.5 text-amber-500 shrink-0" />
      <div>
        <div className="font-medium text-foreground/80 mb-0.5">Gate blockers</div>
        <ul className="space-y-0.5">
          {lines.map((l) => <li key={l}>· {l}</li>)}
        </ul>
      </div>
    </div>
  );
}
