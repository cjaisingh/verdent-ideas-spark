import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import {
  Sheet, SheetContent, SheetFooter, SheetHeader, SheetTitle, SheetDescription,
} from "@/components/ui/sheet";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Bot, Plus, ShieldAlert } from "lucide-react";
import { toast } from "sonner";
import { useCopilotAgents, type CopilotAgent } from "@/hooks/useCopilotAgents";

const RISKS = ["low", "medium", "high"] as const;

function csv(arr: string[]) { return arr.join(", "); }
function parseCsv(s: string) {
  return s.split(",").map((x) => x.trim()).filter(Boolean);
}

export default function CopilotAgents() {
  const { agents } = useCopilotAgents();
  const [isAdmin, setIsAdmin] = useState(false);
  const [editing, setEditing] = useState<Partial<CopilotAgent> | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const { data } = await supabase
        .from("user_roles")
        .select("role")
        .eq("user_id", user.id);
      setIsAdmin(!!data?.some((r) => r.role === "admin"));
    })();
  }, []);

  const openNew = () => setEditing({
    slug: "", name: "", wake_word: "", description: "",
    system_prompt: "", tts_voice: "aura-2-orion-en", language: "en",
    default_greeting: "Copilot ready.",
    allowed_capability_ids: [], allowed_tables: [],
    max_risk: "medium", enabled: true, order: agents.length + 1,
  });

  const save = async () => {
    if (!editing) return;
    if (!editing.slug || !editing.name || !editing.wake_word) {
      toast.error("slug, name, and wake word are required");
      return;
    }
    setSaving(true);
    try {
      const row = {
        ...editing,
        wake_word: editing.wake_word!.toLowerCase(),
      };
      const { error } = editing.id
        ? await supabase.from("copilot_agents").update(row).eq("id", editing.id)
        : await supabase.from("copilot_agents").insert(row as any);
      if (error) throw error;
      toast.success(editing.id ? "Agent updated" : "Agent created");
      setEditing(null);
    } catch (e: any) {
      toast.error(e.message || "Save failed");
    } finally {
      setSaving(false);
    }
  };

  const remove = async (id: string) => {
    if (!confirm("Delete this agent? Per-user overrides will also be removed.")) return;
    const { error } = await supabase.from("copilot_agents").delete().eq("id", id);
    if (error) toast.error(error.message);
    else toast.success("Agent deleted");
  };

  if (!isAdmin) {
    return (
      <div className="p-6 max-w-lg">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <ShieldAlert className="size-5" /> Admin only
            </CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            You need the admin role to manage Copilot agents.
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold flex items-center gap-2">
            <Bot className="size-6" /> Copilot agents
          </h1>
          <p className="text-sm text-muted-foreground">
            Shared catalog of Copilot personas. Operators pick one per session, or switch via wake word.
          </p>
        </div>
        <Button onClick={openNew}><Plus className="size-4 mr-2" /> New agent</Button>
      </div>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Wake</TableHead>
                <TableHead>Voice</TableHead>
                <TableHead>Risk</TableHead>
                <TableHead>Tools</TableHead>
                <TableHead>Tables</TableHead>
                <TableHead>Enabled</TableHead>
                <TableHead className="w-32" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {agents.map((a) => (
                <TableRow key={a.id} className="cursor-pointer" onClick={() => setEditing(a)}>
                  <TableCell>
                    <div className="font-medium">{a.name}</div>
                    <div className="text-xs text-muted-foreground font-mono">/{a.slug}</div>
                  </TableCell>
                  <TableCell className="font-mono text-xs">{a.wake_word}</TableCell>
                  <TableCell className="font-mono text-xs">{a.tts_voice}</TableCell>
                  <TableCell><Badge variant="outline">{a.max_risk}</Badge></TableCell>
                  <TableCell className="text-xs">{a.allowed_capability_ids.length}</TableCell>
                  <TableCell className="text-xs">{a.allowed_tables.length}</TableCell>
                  <TableCell>{a.enabled ? "yes" : "no"}</TableCell>
                  <TableCell onClick={(e) => e.stopPropagation()}>
                    <Button size="sm" variant="ghost" onClick={() => remove(a.id)}>Delete</Button>
                  </TableCell>
                </TableRow>
              ))}
              {agents.length === 0 && (
                <TableRow><TableCell colSpan={8} className="text-center text-sm text-muted-foreground py-6">
                  No agents yet.
                </TableCell></TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Sheet open={!!editing} onOpenChange={(o) => !o && setEditing(null)}>
        <SheetContent className="w-full sm:max-w-lg overflow-y-auto">
          <SheetHeader>
            <SheetTitle>{editing?.id ? "Edit agent" : "New agent"}</SheetTitle>
            <SheetDescription>
              Capabilities and tables are comma-separated. The edge function gates calls to whatever you list here.
            </SheetDescription>
          </SheetHeader>
          {editing && (
            <div className="py-5 space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label className="text-xs">Slug</Label>
                  <Input value={editing.slug ?? ""} onChange={(e) => setEditing({ ...editing, slug: e.target.value })} />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">Name</Label>
                  <Input value={editing.name ?? ""} onChange={(e) => setEditing({ ...editing, name: e.target.value })} />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label className="text-xs">Wake word</Label>
                  <Input value={editing.wake_word ?? ""} onChange={(e) => setEditing({ ...editing, wake_word: e.target.value })} />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">Max risk</Label>
                  <Select value={editing.max_risk ?? "medium"} onValueChange={(v) => setEditing({ ...editing, max_risk: v as any })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {RISKS.map((r) => <SelectItem key={r} value={r}>{r}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Description</Label>
                <Input value={editing.description ?? ""} onChange={(e) => setEditing({ ...editing, description: e.target.value })} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label className="text-xs">TTS voice</Label>
                  <Input value={editing.tts_voice ?? ""} onChange={(e) => setEditing({ ...editing, tts_voice: e.target.value })} />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">Language</Label>
                  <Input value={editing.language ?? ""} onChange={(e) => setEditing({ ...editing, language: e.target.value })} />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Default greeting</Label>
                <Input value={editing.default_greeting ?? ""} onChange={(e) => setEditing({ ...editing, default_greeting: e.target.value })} />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">System prompt</Label>
                <Textarea
                  rows={5}
                  value={editing.system_prompt ?? ""}
                  onChange={(e) => setEditing({ ...editing, system_prompt: e.target.value })}
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Allowed capability IDs (comma-separated)</Label>
                <Textarea
                  rows={2}
                  value={csv(editing.allowed_capability_ids ?? [])}
                  onChange={(e) => setEditing({ ...editing, allowed_capability_ids: parseCsv(e.target.value) })}
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Allowed tables (comma-separated)</Label>
                <Textarea
                  rows={2}
                  value={csv(editing.allowed_tables ?? [])}
                  onChange={(e) => setEditing({ ...editing, allowed_tables: parseCsv(e.target.value) })}
                />
              </div>
              <div className="flex items-center justify-between">
                <Label className="text-xs">Enabled</Label>
                <Switch
                  checked={editing.enabled ?? true}
                  onCheckedChange={(v) => setEditing({ ...editing, enabled: v })}
                />
              </div>
            </div>
          )}
          <SheetFooter>
            <Button variant="ghost" onClick={() => setEditing(null)}>Cancel</Button>
            <Button onClick={save} disabled={saving}>{saving ? "Saving…" : "Save"}</Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>
    </div>
  );
}
