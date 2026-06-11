import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { Loader2, RefreshCw, X, Plus, Calendar } from "lucide-react";

type Job = {
  id: string;
  kind: string;
  owning_module: string;
  tenant_id: string | null;
  subject_type: string | null;
  subject_id: string | null;
  status: string;
  run_at: string;
  recurrence: string | null;
  attempts: number;
  max_retries: number;
  dedupe_key: string;
  payload: Record<string, unknown>;
  last_error: string | null;
  created_at: string;
};

const STATUS_VARIANTS: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  pending: "secondary",
  running: "default",
  done: "outline",
  failed: "destructive",
  cancelled: "outline",
  auto_blocked: "destructive",
};

export default function AdminScheduler() {
  const { toast } = useToast();
  const [jobs, setJobs] = useState<Job[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [moduleFilter, setModuleFilter] = useState<string>("all");
  const [search, setSearch] = useState("");
  const [createOpen, setCreateOpen] = useState(false);

  // Create-form state
  const [fKind, setFKind] = useState("reminder.send");
  const [fModule, setFModule] = useState("awip_core");
  const [fTenant, setFTenant] = useState("");
  const [fRunAt, setFRunAt] = useState(() =>
    new Date(Date.now() + 60_000).toISOString().slice(0, 16)
  );
  const [fRecurrence, setFRecurrence] = useState("");
  const [fPayload, setFPayload] = useState('{"message":"reminder"}');
  const [fDedupe, setFDedupe] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const load = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("scheduled_jobs")
      .select("*")
      .order("run_at", { ascending: false })
      .limit(200);
    if (error) toast({ title: "Load failed", description: error.message, variant: "destructive" });
    setJobs((data ?? []) as Job[]);
    setLoading(false);
  };

  useEffect(() => {
    load();
    const ch = supabase
      .channel(`admin-scheduler-${crypto.randomUUID()}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "scheduled_jobs" },
        () => load()
      )
      .subscribe();
    return () => { supabase.removeChannel(ch); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const modules = useMemo(() => {
    const s = new Set<string>();
    jobs.forEach((j) => s.add(j.owning_module));
    return Array.from(s).sort();
  }, [jobs]);

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return jobs.filter((j) => {
      if (statusFilter !== "all" && j.status !== statusFilter) return false;
      if (moduleFilter !== "all" && j.owning_module !== moduleFilter) return false;
      if (q && !(`${j.kind} ${j.dedupe_key} ${j.tenant_id ?? ""}`.toLowerCase().includes(q))) return false;
      return true;
    });
  }, [jobs, statusFilter, moduleFilter, search]);

  const cancelJob = async (id: string) => {
    const { error } = await supabase
      .from("scheduled_jobs")
      .update({ status: "cancelled" })
      .eq("id", id)
      .in("status", ["pending", "failed"]);
    if (error) toast({ title: "Cancel failed", description: error.message, variant: "destructive" });
    else toast({ title: "Cancelled" });
  };

  const retryJob = async (id: string) => {
    const { error } = await supabase
      .from("scheduled_jobs")
      .update({ status: "pending", run_at: new Date().toISOString(), last_error: null })
      .eq("id", id)
      .in("status", ["failed", "cancelled"]);
    if (error) toast({ title: "Retry failed", description: error.message, variant: "destructive" });
    else toast({ title: "Requeued" });
  };

  const submitCreate = async () => {
    if (!fKind.trim()) {
      toast({ title: "Job kind is required", variant: "destructive" });
      return;
    }
    setSubmitting(true);
    try {
      let payload: Record<string, unknown> = {};
      try { payload = JSON.parse(fPayload || "{}"); }
      catch { toast({ title: "Payload must be valid JSON", variant: "destructive" }); setSubmitting(false); return; }

      const body = {
        kind: fKind,
        owning_module: fModule,
        tenant_id: fModule === "awip_core" ? null : (fTenant || null),
        payload,
        dedupe_key: fDedupe || `${fKind}:${crypto.randomUUID()}`,
        run_at: new Date(fRunAt).toISOString(),
        recurrence: fRecurrence || null,
      };
      const { data, error } = await supabase.functions.invoke("scheduler-enqueue", { body });
      if (error) throw error;
      toast({ title: "Job enqueued", description: (data as { id?: string })?.id ?? "" });
      setCreateOpen(false);
      load();
    } catch (e) {
      toast({ title: "Enqueue failed", description: e instanceof Error ? e.message : String(e), variant: "destructive" });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="p-6 space-y-6 max-w-[1800px] mx-auto">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold flex items-center gap-2">
            <Calendar className="h-6 w-6" /> Global Scheduler
          </h1>
          <p className="text-sm text-muted-foreground">
            W8.1 substrate. Core + FM jobs in one queue. Operator-only.
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={load} disabled={loading}>
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
          </Button>
          <Dialog open={createOpen} onOpenChange={setCreateOpen}>
            <DialogTrigger asChild>
              <Button><Plus className="h-4 w-4 mr-1" /> Enqueue job</Button>
            </DialogTrigger>
            <DialogContent className="max-w-lg">
              <DialogHeader><DialogTitle>Enqueue scheduled job</DialogTitle></DialogHeader>
              <div className="space-y-3">
                <div>
                  <Label>Kind</Label>
                  <Input value={fKind} onChange={(e) => setFKind(e.target.value)} placeholder="reminder.send" />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label>Owning module</Label>
                    <Input value={fModule} onChange={(e) => setFModule(e.target.value)} placeholder="awip_core" />
                  </div>
                  <div>
                    <Label>Tenant ID {fModule !== "awip_core" && <span className="text-destructive">*</span>}</Label>
                    <Input value={fTenant} onChange={(e) => setFTenant(e.target.value)} placeholder="uuid" />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label>Run at (UTC)</Label>
                    <Input type="datetime-local" value={fRunAt} onChange={(e) => setFRunAt(e.target.value)} />
                  </div>
                  <div>
                    <Label>Recurrence (cron, opt.)</Label>
                    <Input value={fRecurrence} onChange={(e) => setFRecurrence(e.target.value)} placeholder="0 9 * * 1" />
                  </div>
                </div>
                <div>
                  <Label>Dedupe key (optional)</Label>
                  <Input value={fDedupe} onChange={(e) => setFDedupe(e.target.value)} placeholder="auto" />
                </div>
                <div>
                  <Label>Payload (JSON)</Label>
                  <Textarea rows={4} value={fPayload} onChange={(e) => setFPayload(e.target.value)} />
                </div>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setCreateOpen(false)}>Cancel</Button>
                <Button onClick={submitCreate} disabled={submitting}>
                  {submitting && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}Enqueue
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Filters</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-3">
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-44"><SelectValue placeholder="Status" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All statuses</SelectItem>
              {["pending", "running", "done", "failed", "cancelled", "auto_blocked"].map((s) => (
                <SelectItem key={s} value={s}>{s}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={moduleFilter} onValueChange={setModuleFilter}>
            <SelectTrigger className="w-56"><SelectValue placeholder="Module" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All modules</SelectItem>
              {modules.map((m) => <SelectItem key={m} value={m}>{m}</SelectItem>)}
            </SelectContent>
          </Select>
          <Input
            placeholder="Search kind / dedupe / tenant…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-72"
          />
          <span className="text-sm text-muted-foreground self-center ml-auto">
            {filtered.length} / {jobs.length} jobs
          </span>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">Jobs</CardTitle></CardHeader>
        <CardContent className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-muted-foreground border-b">
                <th className="py-2 pr-3">Kind</th>
                <th className="py-2 pr-3">Module</th>
                <th className="py-2 pr-3">Status</th>
                <th className="py-2 pr-3">Run at</th>
                <th className="py-2 pr-3">Attempts</th>
                <th className="py-2 pr-3">Tenant</th>
                <th className="py-2 pr-3">Last error</th>
                <th className="py-2 pr-3"></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((j) => (
                <tr key={j.id} className="border-b hover:bg-muted/40">
                  <td className="py-2 pr-3 font-mono text-xs">{j.kind}</td>
                  <td className="py-2 pr-3">{j.owning_module}</td>
                  <td className="py-2 pr-3">
                    <Badge variant={STATUS_VARIANTS[j.status] ?? "outline"}>{j.status}</Badge>
                    {j.recurrence && <Badge variant="outline" className="ml-1">cron</Badge>}
                  </td>
                  <td className="py-2 pr-3 text-xs">{new Date(j.run_at).toISOString().replace("T", " ").slice(0, 16)}</td>
                  <td className="py-2 pr-3">{j.attempts}/{j.max_retries}</td>
                  <td className="py-2 pr-3 font-mono text-xs">{j.tenant_id?.slice(0, 8) ?? "—"}</td>
                  <td className="py-2 pr-3 text-xs text-destructive truncate max-w-[260px]">{j.last_error ?? ""}</td>
                  <td className="py-2 pr-3 text-right whitespace-nowrap">
                    {["pending", "failed"].includes(j.status) && (
                      <Button size="sm" variant="ghost" onClick={() => cancelJob(j.id)}>
                        <X className="h-3 w-3 mr-1" /> Cancel
                      </Button>
                    )}
                    {["failed", "cancelled"].includes(j.status) && (
                      <Button size="sm" variant="ghost" onClick={() => retryJob(j.id)}>
                        <RefreshCw className="h-3 w-3 mr-1" /> Retry
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
              {!loading && filtered.length === 0 && (
                <tr><td colSpan={8} className="py-8 text-center text-muted-foreground">No jobs match filters.</td></tr>
              )}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  );
}
