// Record a current credit balance. Optionally tag against a roadmap phase
// (used when prompted at the end of a phase of work).
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** When set, snapshot is tagged with this phase (end-of-phase prompt). */
  phaseId?: string | null;
  phaseLabel?: string | null;
  onSaved?: () => void;
};

export function BalanceSnapshotDialog({ open, onOpenChange, phaseId, phaseLabel, onSaved }: Props) {
  const [balance, setBalance] = useState("");
  const [source, setSource] = useState("");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) { setBalance(""); setSource(""); setNote(""); }
  }, [open]);

  async function save() {
    const n = Number(balance);
    if (!Number.isFinite(n) || n < 0) { toast.error("Enter a valid balance"); return; }
    setSaving(true);
    const { data: u } = await supabase.auth.getUser();
    const { error } = await supabase.from("credit_balance_snapshots").insert({
      balance_credits: n,
      phase_id: phaseId ?? null,
      source: source.trim() || (phaseId ? "phase-close prompt" : "manual"),
      note: note.trim() || null,
      created_by: u.user?.id ?? null,
    });
    setSaving(false);
    if (error) { toast.error(error.message); return; }
    toast.success(phaseId ? "Phase balance recorded" : "Balance recorded");
    onSaved?.();
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            {phaseId ? `Record balance · end of ${phaseLabel ?? "phase"}` : "Record current credit balance"}
          </DialogTitle>
          <DialogDescription>
            Open your Lovable workspace credit bar and enter what's left. We subtract logged spend from this point forward to estimate runway.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3 py-2">
          <div>
            <Label htmlFor="balance">Remaining credits</Label>
            <Input id="balance" type="number" inputMode="decimal" step="0.01" min="0"
              value={balance} onChange={(e) => setBalance(e.target.value)} autoFocus placeholder="e.g. 1240" />
          </div>
          <div>
            <Label htmlFor="source">Source (optional)</Label>
            <Input id="source" value={source} onChange={(e) => setSource(e.target.value)}
              placeholder="Lovable dashboard, 17 May 15:00 UTC" />
          </div>
          <div>
            <Label htmlFor="note">Note (optional)</Label>
            <Textarea id="note" value={note} onChange={(e) => setNote(e.target.value)} rows={2} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>Cancel</Button>
          <Button onClick={save} disabled={saving}>{saving ? "Saving…" : "Save snapshot"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
