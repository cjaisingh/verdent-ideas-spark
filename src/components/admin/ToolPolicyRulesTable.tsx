import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Pencil, Trash2, Plus } from "lucide-react";
import { toast } from "sonner";
import { TOOL_LABELS, type ToolPolicyRule } from "@/lib/toolPolicy";
import { EditToolPolicyRuleDialog } from "./EditToolPolicyRuleDialog";

type Phase = { id: string; title: string };

export function ToolPolicyRulesTable({ rules, phases, onChange }: { rules: ToolPolicyRule[]; phases: Phase[]; onChange: () => void }) {
  const [editing, setEditing] = useState<ToolPolicyRule | "new" | null>(null);

  async function toggle(r: ToolPolicyRule) {
    const { error } = await supabase.from("tool_policy_rules").update({ enabled: !r.enabled }).eq("id", r.id);
    if (error) toast.error(error.message); else onChange();
  }

  async function remove(r: ToolPolicyRule) {
    if (!confirm(`Delete rule "${r.name}"?`)) return;
    const { error } = await supabase.from("tool_policy_rules").delete().eq("id", r.id);
    if (error) toast.error(error.message); else { toast.success("Rule deleted"); onChange(); }
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between pb-3">
        <CardTitle className="text-base">Rules ({rules.length})</CardTitle>
        <Button size="sm" onClick={() => setEditing("new")}><Plus className="h-4 w-4 mr-2" /> Add rule</Button>
      </CardHeader>
      <CardContent className="p-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-[60px]">#</TableHead>
              <TableHead>Name</TableHead>
              <TableHead>When</TableHead>
              <TableHead>Tool</TableHead>
              <TableHead className="w-[80px]">On</TableHead>
              <TableHead className="w-[100px]"></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rules.length === 0 && (
              <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground py-8">No rules. Add one to start.</TableCell></TableRow>
            )}
            {rules.map((r) => (
              <TableRow key={r.id} className={!r.enabled ? "opacity-50" : ""}>
                <TableCell className="font-mono tabular-nums">{r.precedence}</TableCell>
                <TableCell className="font-medium">{r.name}</TableCell>
                <TableCell className="text-xs text-muted-foreground space-y-0.5">
                  {r.task_types.length > 0 && <div>task: {r.task_types.join(", ")}</div>}
                  {r.min_credits_remaining_pct != null && <div>credits ≥ {r.min_credits_remaining_pct}%</div>}
                  {r.max_credits_remaining_pct != null && <div>credits ≤ {r.max_credits_remaining_pct}%</div>}
                  {r.min_burn_rate_per_day != null && <div>burn ≥ {r.min_burn_rate_per_day}/day</div>}
                  {r.phase_ids && r.phase_ids.length > 0 && <div>{r.phase_ids.length} phase(s)</div>}
                  {r.task_types.length === 0 && r.min_credits_remaining_pct == null && r.max_credits_remaining_pct == null && r.min_burn_rate_per_day == null && !r.phase_ids?.length && <div>always</div>}
                </TableCell>
                <TableCell><Badge variant="outline">{TOOL_LABELS[r.recommended_tool]}</Badge></TableCell>
                <TableCell><Switch checked={r.enabled} onCheckedChange={() => toggle(r)} /></TableCell>
                <TableCell className="text-right">
                  <Button variant="ghost" size="icon" onClick={() => setEditing(r)}><Pencil className="h-4 w-4" /></Button>
                  <Button variant="ghost" size="icon" onClick={() => remove(r)}><Trash2 className="h-4 w-4" /></Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>

      {editing && (
        <EditToolPolicyRuleDialog
          rule={editing === "new" ? null : editing}
          phases={phases}
          open
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); onChange(); }}
        />
      )}
    </Card>
  );
}
