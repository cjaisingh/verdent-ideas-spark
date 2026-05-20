// Configurable AI usage attribution: job→module patterns + module→task pins.
// Drives infer_ai_job_module() and backfill_ai_usage_attribution() on the server.
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";
import { Plus, Trash2, Play, Pin } from "lucide-react";

type Mapping = {
  id: string;
  pattern: string;
  module: string;
  priority: number;
  enabled: boolean;
  notes: string | null;
};

type Pin = {
  id: string;
  module: string;
  task_id: string;
  effective_from: string;
  effective_to: string | null;
  notes: string | null;
};

type TaskOpt = { id: string; key: string; title: string; module: string | null };

const AiModuleMappingsPanel = () => {
  const [mappings, setMappings] = useState<Mapping[] | null>(null);
  const [pins, setPins] = useState<Pin[] | null>(null);
  const [tasks, setTasks] = useState<TaskOpt[]>([]);
  const [busy, setBusy] = useState(false);

  // new-row drafts
  const [newMap, setNewMap] = useState({ pattern: "", module: "", priority: 100, notes: "" });
  const [newPin, setNewPin] = useState({ module: "", task_id: "", effective_from: "", effective_to: "", notes: "" });

  const load = async () => {
    const [m, p, t] = await Promise.all([
      supabase.from("ai_module_mappings").select("*").order("priority", { ascending: false }).order("pattern"),
      supabase.from("ai_module_task_pins").select("*").order("effective_from", { ascending: false }),
      supabase.from("roadmap_tasks").select("id,key,title,module").order("key"),
    ]);
    if (m.error) toast.error(`mappings: ${m.error.message}`); else setMappings(m.data as Mapping[]);
    if (p.error) toast.error(`pins: ${p.error.message}`); else setPins(p.data as Pin[]);
    if (t.error) toast.error(`tasks: ${t.error.message}`); else setTasks((t.data ?? []) as TaskOpt[]);
  };

  useEffect(() => { load(); }, []);

  const saveMapping = async (m: Mapping, patch: Partial<Mapping>) => {
    const { error } = await supabase.from("ai_module_mappings").update(patch).eq("id", m.id);
    if (error) toast.error(error.message); else { toast.success("Saved"); load(); }
  };

  const deleteMapping = async (id: string) => {
    if (!confirm("Delete mapping?")) return;
    const { error } = await supabase.from("ai_module_mappings").delete().eq("id", id);
    if (error) toast.error(error.message); else { toast.success("Deleted"); load(); }
  };

  const addMapping = async () => {
    if (!newMap.pattern || !newMap.module) { toast.error("pattern + module required"); return; }
    const { error } = await supabase.from("ai_module_mappings").insert({
      pattern: newMap.pattern, module: newMap.module,
      priority: newMap.priority, notes: newMap.notes || null,
    });
    if (error) toast.error(error.message);
    else { setNewMap({ pattern: "", module: "", priority: 100, notes: "" }); toast.success("Added"); load(); }
  };

  const deletePin = async (id: string) => {
    if (!confirm("Delete pin?")) return;
    const { error } = await supabase.from("ai_module_task_pins").delete().eq("id", id);
    if (error) toast.error(error.message); else { toast.success("Deleted"); load(); }
  };

  const addPin = async () => {
    if (!newPin.module || !newPin.task_id || !newPin.effective_from) {
      toast.error("module + task + effective_from required"); return;
    }
    const { error } = await supabase.from("ai_module_task_pins").insert({
      module: newPin.module,
      task_id: newPin.task_id,
      effective_from: new Date(newPin.effective_from).toISOString(),
      effective_to: newPin.effective_to ? new Date(newPin.effective_to).toISOString() : null,
      notes: newPin.notes || null,
    });
    if (error) toast.error(error.message);
    else { setNewPin({ module: "", task_id: "", effective_from: "", effective_to: "", notes: "" }); toast.success("Added"); load(); }
  };

  const runBackfill = async () => {
    setBusy(true);
    const { data, error } = await supabase.rpc("backfill_ai_usage_attribution");
    setBusy(false);
    if (error) { toast.error(error.message); return; }
    const r = data as { module_backfilled?: number; task_id_backfilled_pin?: number; task_id_backfilled_heur?: number };
    toast.success(
      `Backfill done — module: ${r?.module_backfilled ?? 0}, pin: ${r?.task_id_backfilled_pin ?? 0}, heur: ${r?.task_id_backfilled_heur ?? 0}`
    );
  };

  const taskLabel = (id: string) => {
    const t = tasks.find(x => x.id === id);
    return t ? `${t.key} · ${t.title}` : id.slice(0, 8);
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader className="pb-3 flex flex-row items-start justify-between gap-3">
          <div>
            <CardTitle className="text-base">Module attribution mappings</CardTitle>
            <p className="text-xs text-muted-foreground mt-1">
              Drives <code className="text-[10px]">infer_ai_job_module()</code>. Job name is matched against{" "}
              <code className="text-[10px]">pattern</code> with SQL <code className="text-[10px]">ILIKE</code> — use{" "}
              <code className="text-[10px]">%</code> for wildcards. Highest priority wins; ties broken by longer pattern.
            </p>
          </div>
          <Button size="sm" onClick={runBackfill} disabled={busy}>
            <Play className="h-3.5 w-3.5 mr-1" /> {busy ? "Running…" : "Run backfill"}
          </Button>
        </CardHeader>
        <CardContent className="pt-0">
          {!mappings ? <Skeleton className="h-40 w-full" /> : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Pattern</TableHead>
                    <TableHead>Module</TableHead>
                    <TableHead className="w-24">Priority</TableHead>
                    <TableHead className="w-20">Enabled</TableHead>
                    <TableHead>Notes</TableHead>
                    <TableHead className="w-10"></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {mappings.map(m => (
                    <TableRow key={m.id}>
                      <TableCell>
                        <Input defaultValue={m.pattern} className="h-8 font-mono text-xs"
                          onBlur={e => e.target.value !== m.pattern && saveMapping(m, { pattern: e.target.value })} />
                      </TableCell>
                      <TableCell>
                        <Input defaultValue={m.module} className="h-8 font-mono text-xs"
                          onBlur={e => e.target.value !== m.module && saveMapping(m, { module: e.target.value })} />
                      </TableCell>
                      <TableCell>
                        <Input type="number" defaultValue={m.priority} className="h-8 w-20 text-xs"
                          onBlur={e => Number(e.target.value) !== m.priority && saveMapping(m, { priority: Number(e.target.value) })} />
                      </TableCell>
                      <TableCell>
                        <Switch checked={m.enabled} onCheckedChange={(v) => saveMapping(m, { enabled: v })} />
                      </TableCell>
                      <TableCell>
                        <Input defaultValue={m.notes ?? ""} className="h-8 text-xs"
                          onBlur={e => (e.target.value || null) !== m.notes && saveMapping(m, { notes: e.target.value || null })} />
                      </TableCell>
                      <TableCell>
                        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => deleteMapping(m.id)}>
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                  <TableRow className="bg-muted/30">
                    <TableCell>
                      <Input placeholder="e.g. claims-%" value={newMap.pattern} className="h-8 font-mono text-xs"
                        onChange={e => setNewMap({ ...newMap, pattern: e.target.value })} />
                    </TableCell>
                    <TableCell>
                      <Input placeholder="module slug" value={newMap.module} className="h-8 font-mono text-xs"
                        onChange={e => setNewMap({ ...newMap, module: e.target.value })} />
                    </TableCell>
                    <TableCell>
                      <Input type="number" value={newMap.priority} className="h-8 w-20 text-xs"
                        onChange={e => setNewMap({ ...newMap, priority: Number(e.target.value) })} />
                    </TableCell>
                    <TableCell><Badge variant="outline">on</Badge></TableCell>
                    <TableCell>
                      <Input placeholder="notes" value={newMap.notes} className="h-8 text-xs"
                        onChange={e => setNewMap({ ...newMap, notes: e.target.value })} />
                    </TableCell>
                    <TableCell>
                      <Button variant="ghost" size="icon" className="h-7 w-7" onClick={addMapping}>
                        <Plus className="h-3.5 w-3.5" />
                      </Button>
                    </TableCell>
                  </TableRow>
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Pin className="h-4 w-4 text-muted-foreground" />
            Module → task pins
          </CardTitle>
          <p className="text-xs text-muted-foreground mt-1">
            Pin a module's spend to a specific task within a time window. Pins take precedence over the
            updated_at heuristic during backfill. Use this to attribute historical spend before{" "}
            <code className="text-[10px]">task_id</code> was being passed.
          </p>
        </CardHeader>
        <CardContent className="pt-0">
          {!pins ? <Skeleton className="h-32 w-full" /> : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Module</TableHead>
                    <TableHead>Task</TableHead>
                    <TableHead>From</TableHead>
                    <TableHead>To</TableHead>
                    <TableHead>Notes</TableHead>
                    <TableHead className="w-10"></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {pins.map(p => (
                    <TableRow key={p.id}>
                      <TableCell className="font-mono text-xs">{p.module}</TableCell>
                      <TableCell className="text-xs">{taskLabel(p.task_id)}</TableCell>
                      <TableCell className="text-xs">{new Date(p.effective_from).toLocaleString()}</TableCell>
                      <TableCell className="text-xs">{p.effective_to ? new Date(p.effective_to).toLocaleString() : <span className="text-muted-foreground">open</span>}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">{p.notes ?? ""}</TableCell>
                      <TableCell>
                        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => deletePin(p.id)}>
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                  <TableRow className="bg-muted/30">
                    <TableCell>
                      <Input placeholder="module" value={newPin.module} className="h-8 font-mono text-xs"
                        onChange={e => setNewPin({ ...newPin, module: e.target.value })} />
                    </TableCell>
                    <TableCell>
                      <select
                        value={newPin.task_id}
                        onChange={e => setNewPin({ ...newPin, task_id: e.target.value })}
                        className="h-8 w-full rounded border bg-background text-xs px-2"
                      >
                        <option value="">— pick task —</option>
                        {tasks
                          .filter(t => !newPin.module || !t.module || t.module === newPin.module)
                          .map(t => <option key={t.id} value={t.id}>{t.key} · {t.title}</option>)}
                      </select>
                    </TableCell>
                    <TableCell>
                      <Input type="datetime-local" value={newPin.effective_from} className="h-8 text-xs"
                        onChange={e => setNewPin({ ...newPin, effective_from: e.target.value })} />
                    </TableCell>
                    <TableCell>
                      <Input type="datetime-local" value={newPin.effective_to} className="h-8 text-xs"
                        onChange={e => setNewPin({ ...newPin, effective_to: e.target.value })} />
                    </TableCell>
                    <TableCell>
                      <Input placeholder="notes" value={newPin.notes} className="h-8 text-xs"
                        onChange={e => setNewPin({ ...newPin, notes: e.target.value })} />
                    </TableCell>
                    <TableCell>
                      <Button variant="ghost" size="icon" className="h-7 w-7" onClick={addPin}>
                        <Plus className="h-3.5 w-3.5" />
                      </Button>
                    </TableCell>
                  </TableRow>
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
};

export default AiModuleMappingsPanel;
