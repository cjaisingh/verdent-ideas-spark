import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "@/hooks/use-toast";
import { Brain, Check, Pencil, X } from "lucide-react";

export type PendingLesson = {
  id: string; // local id
  scope: "global" | "notebook" | "approvals" | "voice_style";
  lesson: string;
};

export function PendingLessonsTray({
  pending, onChange,
}: { pending: PendingLesson[]; onChange: (next: PendingLesson[]) => void }) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");

  if (pending.length === 0) return null;

  const remove = (id: string) => onChange(pending.filter((p) => p.id !== id));

  const save = async (p: PendingLesson) => {
    const text = (editingId === p.id ? draft : p.lesson).trim();
    if (!text) return;
    const { data: u } = await supabase.auth.getUser();
    const { error } = await supabase.from("copilot_lessons").insert({
      lesson: text.slice(0, 500),
      scope: p.scope,
      source: "voice",
      created_by: u.user?.id ?? null,
      active: true,
    });
    if (error) { toast({ title: "Save failed", description: error.message, variant: "destructive" }); return; }
    toast({ title: "Lesson saved", description: text.slice(0, 80) });
    setEditingId(null);
    remove(p.id);
  };

  return (
    <div className="mb-2 rounded-md border border-dashed p-2 space-y-1.5">
      <div className="flex items-center gap-1.5 text-xs font-medium">
        <Brain className="h-3.5 w-3.5 text-primary" />
        Pending lessons ({pending.length})
        <button
          onClick={() => onChange([])}
          className="ml-auto text-[10px] text-muted-foreground hover:text-foreground"
        >Discard all</button>
      </div>
      {pending.map((p) => (
        <div key={p.id} className="flex items-center gap-1.5 text-xs">
          <Select value={p.scope} onValueChange={(v) => onChange(pending.map((x) => x.id === p.id ? { ...x, scope: v as PendingLesson["scope"] } : x))}>
            <SelectTrigger className="h-7 w-28 text-[10px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="global">global</SelectItem>
              <SelectItem value="notebook">notebook</SelectItem>
              <SelectItem value="approvals">approvals</SelectItem>
              <SelectItem value="voice_style">voice_style</SelectItem>
            </SelectContent>
          </Select>
          {editingId === p.id ? (
            <Input value={draft} onChange={(e) => setDraft(e.target.value)} className="h-7 text-xs flex-1" maxLength={500} autoFocus />
          ) : (
            <span className="flex-1 truncate" title={p.lesson}>{p.lesson}</span>
          )}
          <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={() => save(p)} title="Save">
            <Check className="h-3.5 w-3.5 text-emerald-500" />
          </Button>
          <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={() => { setEditingId(p.id); setDraft(p.lesson); }} title="Edit">
            <Pencil className="h-3.5 w-3.5" />
          </Button>
          <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={() => remove(p.id)} title="Discard">
            <X className="h-3.5 w-3.5 text-destructive" />
          </Button>
        </div>
      ))}
    </div>
  );
}
