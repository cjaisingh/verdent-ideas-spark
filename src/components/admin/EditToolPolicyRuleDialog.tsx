import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { toast } from "sonner";
import { TASK_TYPES, TOOL_LABELS, type Tool, type ToolPolicyRule } from "@/lib/toolPolicy";

type Phase = { id: string; title: string };

export function EditToolPolicyRuleDialog({
  rule, phases, open, onClose, onSaved,
}: {
  rule: ToolPolicyRule | null;
  phases: Phase[];
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState(rule?.name ?? "");
  const [precedence, setPrecedence] = useState(rule?.precedence ?? 100);
  const [taskTypes, setTaskTypes] = useState<string[]>(rule?.task_types ?? []);
  const [phaseIds, setPhaseIds] = useState<string[]>(rule?.phase_ids ?? []);
  const [minRem, setMinRem] = useState<string>(rule?.min_credits_remaining_pct?.toString() ?? "");
  const [maxRem, setMaxRem] = useState<string>(rule?.max_credits_remaining_pct?.toString() ?? "");
  const [minBurn, setMinBurn] = useState<string>(rule?.min_burn_rate_per_day?.toString() ?? "");
  const [tool, setTool] = useState<Tool>(rule?.recommended_tool ?? "lovable");
  const [reasoning, setReasoning] = useState(rule?.reasoning ?? "");
  const [saving, setSaving] = useState(false);

  const toggleTask = (v: string) =>
    setTaskTypes((prev) => prev.includes(v) ? prev.filter((x) => x !== v) : [...prev, v]);
  const togglePhase = (v: string) =>
    setPhaseIds((prev) => prev.includes(v) ? prev.filter((x) => x !== v) : [...prev, v]);

  async function save() {
    if (!name.trim()) { toast.error("Name required"); return; }
    setSaving(true);
    const payload = {
      name: name.trim(),
      precedence,
      task_types: taskTypes,
      phase_ids: phaseIds.length > 0 ? phaseIds : null,
      min_credits_remaining_pct: minRem === "" ? null : parseInt(minRem, 10),
      max_credits_remaining_pct: maxRem === "" ? null : parseInt(maxRem, 10),
      min_burn_rate_per_day: minBurn === "" ? null : parseFloat(minBurn),
      recommended_tool: tool,
      reasoning,
    };
    const { error } = rule
      ? await supabase.from("tool_policy_rules").update(payload).eq("id", rule.id)
      : await supabase.from("tool_policy_rules").insert(payload);
    setSaving(false);
    if (error) toast.error(error.message);
    else { toast.success(rule ? "Updated" : "Created"); onSaved(); }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader><DialogTitle>{rule ? "Edit rule" : "New rule"}</DialogTitle></DialogHeader>
        <div className="space-y-4">
          <div className="grid grid-cols-[1fr_120px] gap-3">
            <div className="space-y-1">
              <Label>Name</Label>
              <Input value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label>Precedence</Label>
              <Input type="number" value={precedence} onChange={(e) => setPrecedence(parseInt(e.target.value, 10) || 0)} />
            </div>
          </div>

          <div className="space-y-1">
            <Label>Task types (any of)</Label>
            <div className="grid grid-cols-3 gap-2 text-sm">
              {TASK_TYPES.map((t) => (
                <label key={t.value} className="flex items-center gap-2 cursor-pointer">
                  <Checkbox checked={taskTypes.includes(t.value)} onCheckedChange={() => toggleTask(t.value)} />
                  {t.label}
                </label>
              ))}
            </div>
            <p className="text-xs text-muted-foreground">Leave empty to match any task.</p>
          </div>

          {phases.length > 0 && (
            <div className="space-y-1">
              <Label>Phases (optional scope)</Label>
              <div className="grid grid-cols-2 gap-2 text-sm max-h-32 overflow-y-auto border rounded p-2">
                {phases.map((p) => (
                  <label key={p.id} className="flex items-center gap-2 cursor-pointer">
                    <Checkbox checked={phaseIds.includes(p.id)} onCheckedChange={() => togglePhase(p.id)} />
                    <span className="truncate">{p.title}</span>
                  </label>
                ))}
              </div>
            </div>
          )}

          <div className="grid grid-cols-3 gap-3">
            <div className="space-y-1">
              <Label>Credits ≥ %</Label>
              <Input type="number" min="0" max="100" placeholder="any" value={minRem} onChange={(e) => setMinRem(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label>Credits ≤ %</Label>
              <Input type="number" min="0" max="100" placeholder="any" value={maxRem} onChange={(e) => setMaxRem(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label>Burn ≥ /day</Label>
              <Input type="number" step="0.5" placeholder="any" value={minBurn} onChange={(e) => setMinBurn(e.target.value)} />
            </div>
          </div>

          <div className="space-y-1">
            <Label>Recommended tool</Label>
            <Select value={tool} onValueChange={(v) => setTool(v as Tool)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {(Object.keys(TOOL_LABELS) as Tool[]).map((t) => (
                  <SelectItem key={t} value={t}>{TOOL_LABELS[t]}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1">
            <Label>Reasoning</Label>
            <Textarea value={reasoning} onChange={(e) => setReasoning(e.target.value)} rows={3} placeholder="Shown to the operator when this rule fires." />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={save} disabled={saving}>{saving ? "Saving…" : "Save"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
