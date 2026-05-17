// Manual credit entry form. Operator logs real credits spent against a task/step.

import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { WORK_CATEGORIES, type WorkCategory } from "@/lib/workCategory";

type Task = { id: string; key: string; title: string; sprint_id: string; default_category: WorkCategory | null };
type Sprint = { id: string; phase_id: string };

const UNASSIGNED = "__unassigned__";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
}

export function AddCreditEntryDialog({ open, onOpenChange, onSaved }: Props) {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [sprints, setSprints] = useState<Sprint[]>([]);
  const [taskId, setTaskId] = useState<string>(UNASSIGNED);
  const [stepLabel, setStepLabel] = useState("");
  const [credits, setCredits] = useState("");
  const [mode, setMode] = useState("build");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    (async () => {
      const [tRes, sRes] = await Promise.all([
        supabase.from("roadmap_tasks").select("id,key,title,sprint_id").order("updated_at", { ascending: false }).limit(200),
        supabase.from("roadmap_sprints").select("id,phase_id"),
      ]);
      setTasks((tRes.data ?? []) as Task[]);
      setSprints((sRes.data ?? []) as Sprint[]);
    })();
  }, [open]);

  async function save() {
    const c = Number(credits);
    if (!stepLabel.trim()) {
      toast.error("Step label required");
      return;
    }
    if (!Number.isFinite(c) || c < 0) {
      toast.error("Credits must be a non-negative number");
      return;
    }
    setSaving(true);
    const phaseId = taskId !== UNASSIGNED
      ? sprints.find((s) => s.id === tasks.find((t) => t.id === taskId)?.sprint_id)?.phase_id ?? null
      : null;
    const { error } = await supabase.from("credit_entries").insert({
      task_id: taskId === UNASSIGNED ? null : taskId,
      phase_id: phaseId,
      step_label: stepLabel.trim(),
      credits: c,
      mode,
      note: note.trim() || null,
    });
    setSaving(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success("Credit entry saved");
    setStepLabel("");
    setCredits("");
    setNote("");
    setTaskId(UNASSIGNED);
    setMode("build");
    onOpenChange(false);
    onSaved();
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Log credits spent</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label>Step label</Label>
            <Input value={stepLabel} onChange={(e) => setStepLabel(e.target.value)} placeholder="W7 sidebar chip" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Credits</Label>
              <Input type="number" step="0.01" min="0" value={credits} onChange={(e) => setCredits(e.target.value)} placeholder="3.5" />
            </div>
            <div>
              <Label>Mode</Label>
              <Select value={mode} onValueChange={setMode}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="build">build</SelectItem>
                  <SelectItem value="plan">plan</SelectItem>
                  <SelectItem value="try-to-fix">try-to-fix</SelectItem>
                  <SelectItem value="other">other</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div>
            <Label>Roadmap task (optional)</Label>
            <Select value={taskId} onValueChange={setTaskId}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value={UNASSIGNED}>— unassigned —</SelectItem>
                {tasks.map((t) => (
                  <SelectItem key={t.id} value={t.id}>{t.key} · {t.title.slice(0, 60)}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Note (optional)</Label>
            <Textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>Cancel</Button>
          <Button onClick={save} disabled={saving}>{saving ? "Saving…" : "Save"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
