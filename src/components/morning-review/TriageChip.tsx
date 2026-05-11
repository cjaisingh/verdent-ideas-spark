import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Target, RotateCcw, CheckCircle2, MinusCircle } from "lucide-react";
import { toast } from "sonner";
import type { TriageKind, TriageState } from "@/hooks/useMorningReviewTriage";

const OPTIONS: Array<{ value: TriageState; label: string; icon: typeof Target; cls: string }> = [
  { value: "focus", label: "Focus", icon: Target, cls: "bg-primary text-primary-foreground hover:bg-primary/90" },
  { value: "revisit", label: "Revisit", icon: RotateCcw, cls: "bg-amber-500 text-white hover:bg-amber-500/90" },
  { value: "done", label: "Done", icon: CheckCircle2, cls: "bg-emerald-600 text-white hover:bg-emerald-600/90" },
  { value: "skip", label: "Skip", icon: MinusCircle, cls: "bg-muted text-muted-foreground hover:bg-muted/80" },
];

type Props = {
  kind: TriageKind;
  itemRef: string;
  current?: TriageState;
  onChange: (kind: TriageKind, itemRef: string, state: TriageState | null) => Promise<void>;
};

export default function TriageChip({ kind, itemRef, current, onChange }: Props) {
  const handle = async (next: TriageState) => {
    try {
      await onChange(kind, itemRef, current === next ? null : next);
    } catch (e: any) {
      toast.error(e?.message ?? "triage failed");
    }
  };
  return (
    <div className="inline-flex items-center gap-0.5 rounded-md border border-border/60 p-0.5 bg-background/40">
      {OPTIONS.map((o) => {
        const active = current === o.value;
        const Icon = o.icon;
        return (
          <Button
            key={o.value}
            type="button"
            size="sm"
            variant="ghost"
            onClick={() => handle(o.value)}
            title={o.label + (active ? " · click to clear" : "")}
            className={cn(
              "h-6 px-1.5 text-[11px] gap-1 rounded",
              active ? o.cls : "text-muted-foreground hover:text-foreground",
            )}
          >
            <Icon className="h-3 w-3" />
            <span className="hidden md:inline">{o.label}</span>
          </Button>
        );
      })}
    </div>
  );
}
