import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "@/hooks/use-toast";
import { Trash2, Plus, RefreshCw, GraduationCap, Pencil, Check, X } from "lucide-react";
import { Textarea } from "@/components/ui/textarea";

type Lesson = {
  id: string;
  lesson: string;
  scope: "global" | "notebook" | "approvals" | "voice_style";
  source: "voice" | "manual";
  active: boolean;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

const SCOPES = ["global", "notebook", "approvals", "voice_style"] as const;

const Lessons = () => {
  const [lessons, setLessons] = useState<Lesson[]>([]);
  const [loading, setLoading] = useState(false);
  const [newLesson, setNewLesson] = useState("");
  const [newScope, setNewScope] = useState<typeof SCOPES[number]>("global");
  const [saving, setSaving] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editText, setEditText] = useState("");
  const [editScope, setEditScope] = useState<typeof SCOPES[number]>("global");

  const startEdit = (l: Lesson) => {
    setEditingId(l.id);
    setEditText(l.lesson);
    setEditScope(l.scope);
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditText("");
  };

  const saveEdit = async (id: string) => {
    const text = editText.trim();
    if (!text) return;
    if (text.length > 500) {
      toast({ title: "Too long", description: "Keep lessons under 500 characters.", variant: "destructive" });
      return;
    }
    const { error } = await supabase
      .from("copilot_lessons")
      .update({ lesson: text, scope: editScope })
      .eq("id", id);
    if (error) {
      toast({ title: "Update failed", description: error.message, variant: "destructive" });
      return;
    }
    cancelEdit();
    load();
  };

  const load = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("copilot_lessons")
      .select("*")
      .order("created_at", { ascending: false });
    setLoading(false);
    if (error) {
      toast({ title: "Failed to load lessons", description: error.message, variant: "destructive" });
      return;
    }
    setLessons((data ?? []) as Lesson[]);
  };

  useEffect(() => { load(); }, []);

  const create = async () => {
    const text = newLesson.trim();
    if (!text) return;
    if (text.length > 500) {
      toast({ title: "Too long", description: "Keep lessons under 500 characters.", variant: "destructive" });
      return;
    }
    setSaving(true);
    const { error } = await supabase.from("copilot_lessons").insert({
      lesson: text, scope: newScope, source: "manual", active: true,
    });
    setSaving(false);
    if (error) {
      toast({ title: "Couldn't save", description: error.message, variant: "destructive" });
      return;
    }
    setNewLesson("");
    load();
  };

  const toggle = async (id: string, active: boolean) => {
    const { error } = await supabase.from("copilot_lessons").update({ active }).eq("id", id);
    if (error) toast({ title: "Update failed", description: error.message, variant: "destructive" });
    else load();
  };

  const remove = async (id: string) => {
    const { error } = await supabase.from("copilot_lessons").delete().eq("id", id);
    if (error) toast({ title: "Delete failed", description: error.message, variant: "destructive" });
    else load();
  };

  return (
    <div className="space-y-6 p-6 max-w-4xl mx-auto">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold flex items-center gap-2">
            <GraduationCap className="h-6 w-6" /> Copilot Lessons
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Durable rules Copilot honours on every voice turn. Say "learn from this" or "remember that" while speaking, or add manually below.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={load} disabled={loading}>
          <RefreshCw className={`h-4 w-4 mr-2 ${loading ? "animate-spin" : ""}`} /> Refresh
        </Button>
      </header>

      <Card>
        <CardHeader><CardTitle className="text-base">Add a lesson</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <Input
            placeholder="e.g. Always summarise approvals in one sentence before asking to confirm."
            value={newLesson}
            onChange={(e) => setNewLesson(e.target.value)}
            maxLength={500}
          />
          <div className="flex items-center gap-3">
            <Select value={newScope} onValueChange={(v) => setNewScope(v as typeof SCOPES[number])}>
              <SelectTrigger className="w-48"><SelectValue /></SelectTrigger>
              <SelectContent>
                {SCOPES.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
              </SelectContent>
            </Select>
            <span className="text-xs text-muted-foreground">{newLesson.length}/500</span>
            <Button onClick={create} disabled={saving || !newLesson.trim()} className="ml-auto">
              <Plus className="h-4 w-4 mr-2" /> Save lesson
            </Button>
          </div>
        </CardContent>
      </Card>

      <div className="space-y-2">
        {lessons.length === 0 && !loading && (
          <p className="text-sm text-muted-foreground text-center py-12">No lessons yet. Teach Copilot something.</p>
        )}
        {lessons.map((l) => (
          <Card key={l.id} className={l.active ? "" : "opacity-60"}>
            <CardContent className="py-3 flex items-center gap-3">
              <Switch checked={l.active} onCheckedChange={(v) => toggle(l.id, v)} />
              <div className="flex-1">
                <p className="text-sm">{l.lesson}</p>
                <div className="flex items-center gap-2 mt-1">
                  <Badge variant="outline" className="text-xs">{l.scope}</Badge>
                  <Badge variant="outline" className="text-xs">{l.source}</Badge>
                  <span className="text-xs text-muted-foreground">{new Date(l.created_at).toLocaleString()}</span>
                </div>
              </div>
              <Button variant="ghost" size="icon" onClick={() => remove(l.id)}>
                <Trash2 className="h-4 w-4" />
              </Button>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
};

export default Lessons;
