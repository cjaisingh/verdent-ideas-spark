import { useState } from "react";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import type { CapabilityPromotionStatus } from "@/lib/promotion-gates-types";
import { GATE_LABEL } from "@/lib/promotion-gates-types";

type Props = {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  status: CapabilityPromotionStatus | null;
  onConfirm: (rationale: string) => Promise<void>;
};

export const PromoteDialog = ({ open, onOpenChange, status, onConfirm }: Props) => {
  const [rationale, setRationale] = useState("");
  const [busy, setBusy] = useState(false);

  if (!status) return null;
  const warns = status.gates.filter((g) => g.verdict === "warn");

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Promote {status.capability.name ?? status.capability.id}</DialogTitle>
          <DialogDescription>
            This will set <code className="font-mono">status='available'</code> and emit a{" "}
            <code className="font-mono">promoted_to_available</code> event.
          </DialogDescription>
        </DialogHeader>

        {warns.length > 0 && (
          <div className="space-y-2">
            <div className="text-sm font-medium">Acknowledge warnings</div>
            <ul className="text-xs text-muted-foreground space-y-1">
              {warns.map((w) => (
                <li key={w.key}>· <strong>{GATE_LABEL[w.key]}:</strong> {w.reason}</li>
              ))}
            </ul>
            <Textarea
              value={rationale}
              onChange={(e) => setRationale(e.target.value)}
              placeholder="Why are these warnings acceptable for promotion?"
              rows={3}
            />
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>Cancel</Button>
          <Button
            onClick={async () => {
              setBusy(true);
              try { await onConfirm(rationale); } finally { setBusy(false); }
            }}
            disabled={busy || (warns.length > 0 && !rationale.trim())}
          >
            {busy ? "Promoting…" : "Promote to available"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
