import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import { ShieldAlert } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/use-toast";
import type { PhaseGate } from "@/hooks/useRoadmapGates";

interface Props {
  phaseId: string;
  phaseKey: string;
  phaseStatus: string;
  gate?: PhaseGate;
}

const MIN_RATIONALE = 10;

export function PhaseOverrideButton({ phaseId, phaseKey, phaseStatus, gate }: Props) {
  const [open, setOpen] = useState(false);
  const [rationale, setRationale] = useState("");
  const [working, setWorking] = useState(false);

  // Only meaningful when phase isn't already done AND gates are NOT all green
  // (when gates are green, the operator should use the normal sign-off flow).
  if (phaseStatus === "done") return null;
  if (gate?.all_ok) return null;

  const submit = async () => {
    if (rationale.trim().length < MIN_RATIONALE) {
      toast({
        title: "Rationale too short",
        description: `Please write at least ${MIN_RATIONALE} characters explaining why.`,
        variant: "destructive",
      });
      return;
    }
    setWorking(true);
    try {
      const { data: u } = await supabase.auth.getUser();
      const actor = u.user?.email ?? "operator";

      const { error: upErr } = await supabase
        .from("roadmap_phases")
        .update({
          status: "done",
          manual_override_rationale: rationale.trim(),
          manual_override_by: actor,
          manual_override_at: new Date().toISOString(),
        })
        .eq("id", phaseId);
      if (upErr) throw upErr;

      // Audit row (no approval_id — operator override)
      await supabase.from("roadmap_phase_signoffs").insert({
        phase_id: phaseId,
        phase_key: phaseKey,
        approval_id: null,
        approver: actor,
        approver_user_id: u.user?.id ?? null,
        decided_at: new Date().toISOString(),
        gate_snapshot: (gate ?? {}) as never,
        override_rationale: rationale.trim(),
        notes: "manual override",
      } as never);

      await supabase.from("capability_events").insert({
        capability_id: "operator_channel.roadmap",
        event_type: "phase.signed_off",
        actor,
        payload: {
          phase_id: phaseId, phase_key: phaseKey,
          override: true, rationale: rationale.trim(),
        } as never,
      } as never);

      toast({ title: `Phase ${phaseKey} marked done (override)` });
      setOpen(false);
      setRationale("");
    } catch (e) {
      toast({
        title: "Override failed",
        description: e instanceof Error ? e.message : String(e),
        variant: "destructive",
      });
    } finally {
      setWorking(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button
          size="sm"
          variant="ghost"
          className="h-6 px-2 text-[10px] text-amber-600 hover:text-amber-700 dark:text-amber-400 gap-1"
          title="Mark phase done with manual override"
        >
          <ShieldAlert className="h-3 w-3" /> Override
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Manual override · phase {phaseKey}</DialogTitle>
          <DialogDescription>
            Mark this phase done even though one or more gates are failing. The rationale is recorded
            in the audit trail and surfaced on the badge tooltip.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="rounded-md border border-amber-500/40 bg-amber-500/5 p-2 text-xs text-amber-700 dark:text-amber-300 space-y-0.5">
            <div className="font-medium">Failing gates at override time:</div>
            {gate ? (
              <ul className="list-disc pl-4">
                {!gate.structural_ok && <li>{gate.open_tasks} open task(s)</li>}
                {!gate.qa_ok && <li>{gate.qa_total === 0 ? "No QA checks defined" : `${gate.qa_total - gate.qa_pass} QA check(s) not passing`}</li>}
                {!gate.night_ok && <li>{gate.night_high_open} high-severity night audit(s)</li>}
                {!gate.approvals_ok && <li>{gate.pending_signoffs} pending sign-off(s)</li>}
              </ul>
            ) : <div>Gate status unknown.</div>}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="override-rationale" className="text-xs">Rationale (required, ≥ {MIN_RATIONALE} chars)</Label>
            <Textarea
              id="override-rationale"
              value={rationale}
              onChange={(e) => setRationale(e.target.value)}
              placeholder="e.g. QA suite blocked by external vendor outage; phase work itself is verified manually."
              rows={4}
              className="text-sm"
            />
            <div className="text-[10px] text-muted-foreground text-right">
              {rationale.trim().length}/{MIN_RATIONALE}
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)} disabled={working}>Cancel</Button>
          <Button
            onClick={submit}
            disabled={working || rationale.trim().length < MIN_RATIONALE}
            className="bg-amber-600 hover:bg-amber-700 text-white"
          >
            {working ? "Saving…" : "Mark done with override"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
