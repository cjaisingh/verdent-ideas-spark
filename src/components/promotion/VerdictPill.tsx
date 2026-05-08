import { Badge } from "@/components/ui/badge";
import type { GateVerdict } from "@/lib/promotion-gates-types";

const variant: Record<GateVerdict, "default" | "secondary" | "outline" | "destructive"> = {
  pass: "default",
  warn: "secondary",
  fail: "destructive",
};

export const VerdictPill = ({ verdict, children }: { verdict: GateVerdict; children?: React.ReactNode }) => (
  <Badge variant={variant[verdict]} className="font-mono text-[10px] uppercase">
    {children ?? verdict}
  </Badge>
);
