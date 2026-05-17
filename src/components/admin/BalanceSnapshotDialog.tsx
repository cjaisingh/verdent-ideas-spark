// Record a current credit balance. Optionally tag against a roadmap phase
// (end-of-phase prompt) or a free-form development unit (label + optional
// discussion-action / roadmap-task link).
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** When set, snapshot is tagged with this phase (end-of-phase prompt). */
  phaseId?: string | null;
  phaseLabel?: string | null;
  onSaved?: () => void;
};

type SubjectKind = "none" | "discussion_action" | "roadmap_task";

type ActionRow = { id: string; title: string };
type TaskRow = { id: string; title: string };

export function BalanceSnapshotDialog({ open, onOpenChange, phaseId, phaseLabel, onSaved }: Props) {
  const [balance, setBalance] = useState("");
  const [source, setSource] = useState("");
  const [note, setNote] = useState("");
  const [label, setLabel] = useState("");
  const [subjectKind, setSubjectKind] = useState<SubjectKind>("none");
  const [subjectId, setSubjectId] = useState<string>("");
  const [actions, setActions] = useState<ActionRow[]>([]);
  const [tasks, setTasks] = useState<TaskRow[]>([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      setBalance(""); setSource(""); setNote(""); setLabel("");
      setSubjectKind("none"); setSubjectId("");
    }
  }, [open]);

  // Load typeahead candidates lazily when the picker opens (and no phase preset)
  useEffect(() => {
    if (!open || phaseId) return;
    let cancelled = false;
    (async () => {
      const [actRes, taskRes] = await Promise.all([
        supabase.from("discussion_actions")
          .select("id,title")
          .neq("status", "done")
          .order("created_at", { ascending: false })
          .limit(20),
        supabase.from("roadmap_tasks")
          .select("id,title")
          .order("updated_at", { ascending: false })
          .limit(20),
      ]);
      if (cancelled) return;
      setActions((actRes.data ?? []) as ActionRow[]);
      setTasks((taskRes.data ?? []) as TaskRow[]);
    })();
    return () => { cancelled = true; };
  }, [open, phaseId]);

  const options = useMemo(() => {
    if (subjectKind === "discussion_action") return actions.map((a) => ({ id: a.id, title: a.title }));
    if (subjectKind === "roadmap_task") return tasks.map((t) => ({ id: t.id, title: t.title }));
    return [];
  }, [subjectKind, actions, tasks]);

  async function save() {
    const n = Number(balance);
    if (!Number.isFinite(n) || n < 0) { toast.error("Enter a valid balance"); return; }
    setSaving(true);
    const { data: u } = await supabase.auth.getUser();

    // Determine subject_type / subject_id
    let subject_type: string | null = null;
    let subject_id: string | null = null;
    if (phaseId) {
      subject_type = "roadmap_phase";
      subject_id = phaseId;
    } else if (subjectKind !== "none" && subjectId) {
      subject_type = subjectKind;
      subject_id = subjectId;
    } else if (label.trim()) {
      subject_type = "dev_turn";
    } else {
      subject_type = "manual";
    }

    const { error } = await supabase.from("credit_balance_snapshots").insert({
      balance_credits: n,
      phase_id: phaseId ?? null,
      label: label.trim() || null,
      subject_type,
      subject_id,
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

          {!phaseId && (
            <>
              <div>
                <Label htmlFor="label">Label (what just happened?)</Label>
                <Input id="label" value={label} onChange={(e) => setLabel(e.target.value)}
                  placeholder="e.g. model picker, worker checklist" />
              </div>
              <div className="grid grid-cols-[140px_1fr] gap-2">
                <div>
                  <Label>Link to…</Label>
                  <Select value={subjectKind} onValueChange={(v) => { setSubjectKind(v as SubjectKind); setSubjectId(""); }}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">Nothing</SelectItem>
                      <SelectItem value="discussion_action">Discussion action</SelectItem>
                      <SelectItem value="roadmap_task">Roadmap task</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                {subjectKind !== "none" && (
                  <div>
                    <Label>Pick one</Label>
                    <Select value={subjectId} onValueChange={setSubjectId}>
                      <SelectTrigger><SelectValue placeholder="Select…" /></SelectTrigger>
                      <SelectContent>
                        {options.map((o) => (
                          <SelectItem key={o.id} value={o.id}>
                            <span className="truncate inline-block max-w-[260px] align-middle">{o.title}</span>
                          </SelectItem>
                        ))}
                        {options.length === 0 && <SelectItem value="__empty__" disabled>No matches</SelectItem>}
                      </SelectContent>
                    </Select>
                  </div>
                )}
              </div>
            </>
          )}

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
