import { GATE_LABEL, type GateResult } from "@/lib/promotion-gates-types";
import { VerdictPill } from "./VerdictPill";

export const PromotionGateRow = ({ gate }: { gate: GateResult }) => (
  <div className="flex items-start gap-3 py-2 border-b border-border last:border-b-0">
    <div className="pt-0.5">
      <VerdictPill verdict={gate.verdict} />
    </div>
    <div className="flex-1 min-w-0">
      <div className="text-sm font-medium">{GATE_LABEL[gate.key]}</div>
      <div className="text-xs text-muted-foreground mt-0.5">{gate.reason}</div>
      {gate.action_hint && gate.verdict !== "pass" && (
        <div className="text-xs text-foreground/80 mt-1 italic">→ {gate.action_hint}</div>
      )}
    </div>
  </div>
);
