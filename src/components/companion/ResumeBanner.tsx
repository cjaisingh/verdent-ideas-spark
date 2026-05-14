import { Button } from "@/components/ui/button";
import { AlertTriangle } from "lucide-react";

type Props = {
  chars: number;
  onResume: () => void;
  onDiscard: () => void;
  busy?: boolean;
};

export function ResumeBanner({ chars, onResume, onDiscard, busy }: Props) {
  return (
    <div className="mx-3 my-2 flex items-center gap-3 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm">
      <AlertTriangle className="h-4 w-4 text-amber-500 shrink-0" />
      <div className="flex-1 text-foreground">
        Last reply was interrupted ({chars} chars received). Resume to retry the
        same prompt.
      </div>
      <Button size="sm" variant="default" onClick={onResume} disabled={busy}>
        {busy ? "Resuming…" : "Resume"}
      </Button>
      <Button size="sm" variant="ghost" onClick={onDiscard} disabled={busy}>
        Discard
      </Button>
    </div>
  );
}
