import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { AlertTriangle, CheckCircle2, ShieldAlert } from "lucide-react";
import type { PhaseGate } from "@/hooks/useRoadmapGates";

interface Override {
  rationale?: string | null;
  by?: string | null;
  at?: string | null;
}

interface Props {
  phaseStatus: string;
  gate?: PhaseGate;
  override?: Override;
}

function blockerLines(g: PhaseGate): string[] {
  const lines: string[] = [];
  if (!g.structural_ok) lines.push(`${g.open_tasks} open task(s)`);
  if (!g.qa_ok) {
    if (g.qa_total === 0) lines.push("No QA checks defined for phase");
    if (g.qa_failed > 0) lines.push(`${g.qa_failed} QA check(s) failing`);
    if (g.qa_unknown > 0) lines.push(`${g.qa_unknown} QA check(s) never evaluated`);
  }
  if (!g.night_ok) lines.push(`${g.night_high_open} high-severity night audit(s)`);
  if (!g.approvals_ok) lines.push(`${g.pending_signoffs} pending sign-off(s)`);
  return lines;
}

/** Decide which "Done · …" label to show for a done phase that doesn't pass all gates. */
function doneFailLabel(g: PhaseGate): { label: string; severe: boolean } {
  // Severe = something concrete is wrong (failing checks, blocked tasks, pending sign-offs, high-night audits).
  // Non-severe = only "untested": qa_unknown or qa_total=0, no other blocker.
  const hasReal =
    !g.structural_ok ||
    !g.night_ok ||
    !g.approvals_ok ||
    (!g.qa_ok && g.qa_failed > 0);
  if (hasReal) {
    if (!g.structural_ok && g.qa_ok && g.night_ok && g.approvals_ok)
      return { label: `Done · ${g.open_tasks} task(s) open`, severe: true };
    if (g.qa_failed > 0 && g.structural_ok && g.night_ok && g.approvals_ok)
      return { label: `Done · QA failing`, severe: true };
    if (!g.night_ok && g.structural_ok && g.qa_ok && g.approvals_ok)
      return { label: `Done · night audits`, severe: true };
    if (!g.approvals_ok && g.structural_ok && g.qa_ok && g.night_ok)
      return { label: `Done · sign-off pending`, severe: true };
    return { label: `Done · gates fail`, severe: true };
  }
  // Only QA-unknown or no QA defined → label as untested, not failing
  if (g.qa_total === 0) return { label: `Done · QA not defined`, severe: false };
  return { label: `Done · QA pending`, severe: false };
}

export function PhaseGateBadge({ phaseStatus, gate, override }: Props) {
  const map: Record<string, "default" | "secondary" | "outline" | "destructive"> = {
    done: "default", active: "secondary", planned: "outline", paused: "destructive",
  };
  const baseVariant = map[phaseStatus] ?? "outline";
  const hasOverride = !!override?.rationale;

  // DONE via manual override → amber badge with rationale tooltip
  if (phaseStatus === "done" && hasOverride) {
    return (
      <TooltipProvider delayDuration={150}>
        <Tooltip>
          <TooltipTrigger asChild>
            <Badge variant="outline" className="text-[10px] uppercase border-amber-500 text-amber-600 dark:text-amber-400 gap-1 cursor-help">
              <ShieldAlert className="h-3 w-3" /> Done · override
            </Badge>
          </TooltipTrigger>
          <TooltipContent side="bottom" className="max-w-xs space-y-1">
            <p className="font-medium">Manual override</p>
            <p className="text-xs whitespace-pre-wrap">{override!.rationale}</p>
            <p className="text-[10px] text-muted-foreground">
              by {override!.by ?? "unknown"}
              {override!.at ? ` · ${new Date(override!.at).toLocaleString()}` : ""}
            </p>
            {gate && !gate.all_ok && (
              <div className="pt-1 border-t border-border/60">
                <p className="text-[10px] font-medium mb-0.5">Gates failing at override:</p>
                <ul className="text-[10px] list-disc pl-4">
                  {blockerLines(gate).map((l) => <li key={l}>{l}</li>)}
                </ul>
              </div>
            )}
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    );
  }

  // DONE but not all gates pass (no recorded override) → split severe vs untested
  if (phaseStatus === "done" && gate && !gate.all_ok) {
    const { label, severe } = doneFailLabel(gate);
    const tone = severe
      ? "border-amber-500 text-amber-600 dark:text-amber-400"
      : "border-muted-foreground/40 text-muted-foreground";
    const Icon = severe ? AlertTriangle : ShieldAlert;
    return (
      <TooltipProvider delayDuration={150}>
        <Tooltip>
          <TooltipTrigger asChild>
            <Badge variant="outline" className={`text-[10px] uppercase gap-1 ${tone}`}>
              <Icon className="h-3 w-3" /> {label}
            </Badge>
          </TooltipTrigger>
          <TooltipContent side="bottom" className="max-w-xs">
            <p className="font-medium mb-1">
              {severe ? "Phase marked done but gates fail:" : "Phase marked done; QA not yet evaluated:"}
            </p>
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
