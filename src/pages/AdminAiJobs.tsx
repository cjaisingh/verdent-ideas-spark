// /admin/ai-jobs — operator review surface for the local Ollama worker queue.
// Tabs: Jobs (queue health + per-job detail), Drafts (ready_for_review outputs),
// Workers (registered Ollama boxes). Operator-only via RLS; realtime updates.

import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import { RefreshCw, Copy, CheckCircle2, XCircle, Clock, AlertTriangle } from "lucide-react";
import { toast } from "sonner";
import { AiJobsSentinelAlerts } from "@/components/admin/AiJobsSentinelAlerts";

type Job = {
  id: string;
  kind: string;
  status: string;
  priority: number;
  attempts: number;
  max_retries: number;
  requested_model: string | null;
  required_model_tags: string[];
  claimed_by: string | null;
  claimed_at: string | null;
  heartbeat_at: string | null;
  last_error: string | null;
  idempotency_key: string | null;
  input_json: Record<string, unknown>;
  created_at: string;
  updated_at: string;
};

type Draft = {
  id: string;
  job_id: string;
  kind: string;
  status: string;
  body_md: string;
  target_ref: Record<string, unknown>;
  review_note: string | null;
  reviewed_at: string | null;
  created_at: string;
};

type Worker = {
  id: string;
  name: string;
  enabled: boolean;
  model_tags: string[];
  default_model: string | null;
  last_seen_at: string | null;
  created_at: string;
};

type Result = {
  id: string;
  attempt: number;
  model: string | null;
  output_text: string | null;
  error: string | null;
  latency_ms: number | null;
  tokens_in: number | null;
  tokens_out: number | null;
  worker_id: string | null;
  created_at: string;
};

const STATUSES = ["all", "queued", "claimed", "running", "succeeded", "failed", "auto_blocked"];
const ALL = "all";

function statusBadge(s: string) {
  const map: Record<string, { v: "default" | "secondary" | "destructive" | "outline"; icon: typeof Clock }> = {
    queued: { v: "secondary", icon: Clock },
    claimed: { v: "outline", icon: Clock },
    running: { v: "outline", icon: RefreshCw },
    succeeded: { v: "default", icon: CheckCircle2 },
    failed: { v: "destructive", icon: XCircle },
    auto_blocked: { v: "destructive", icon: AlertTriangle },
    ready_for_review: { v: "secondary", icon: Clock },
    approved: { v: "default", icon: CheckCircle2 },
    rejected: { v: "destructive", icon: XCircle },
    applied: { v: "default", icon: CheckCircle2 },
  };
  const cfg = map[s] ?? { v: "outline" as const, icon: Clock };
  const Icon = cfg.icon;
  return (
    <Badge variant={cfg.v} className="gap-1">
      <Icon className="h-3 w-3" />
      {s}
    </Badge>
  );
}

function fmtTime(iso: string | null) {
  if (!iso) return "—";
  const d = new Date(iso);
  const diff = Date.now() - d.getTime();
  if (diff < 60_000) return `${Math.floor(diff / 1000)}s ago`;
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return d.toLocaleString();
}

export default function AdminAiJobs() {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [workers, setWorkers] = useState<Worker[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<string>(ALL);
  const [kindFilter, setKindFilter] = useState<string>(ALL);
  const [selectedJob, setSelectedJob] = useState<Job | null>(null);
  const [selectedJobResults, setSelectedJobResults] = useState<Result[]>([]);
  const [selectedDraft, setSelectedDraft] = useState<Draft | null>(null);
  const [reviewNote, setReviewNote] = useState("");

  const load = async () => {
    setLoading(true);
    const [j, d, w] = await Promise.all([
      supabase.from("ai_jobs").select("*").order("created_at", { ascending: false }).limit(200),
      supabase.from("ai_draft_outputs").select("*").order("created_at", { ascending: false }).limit(100),
      supabase.from("ai_workers").select("*").order("created_at", { ascending: false }),
    ]);
    if (j.error) toast.error("Jobs: " + j.error.message);
    else setJobs((j.data ?? []) as Job[]);
    if (d.error) toast.error("Drafts: " + d.error.message);
    else setDrafts((d.data ?? []) as Draft[]);
    if (w.error) toast.error("Workers: " + w.error.message);
    else setWorkers((w.data ?? []) as Worker[]);
    setLoading(false);
  };

  useEffect(() => {
    load();
    const mountId = Math.random().toString(36).slice(2, 8);
    const ch = supabase
      .channel(`admin-ai-jobs-${mountId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "ai_jobs" }, load)
      .on("postgres_changes", { event: "*", schema: "public", table: "ai_draft_outputs" }, load)
      .on("postgres_changes", { event: "*", schema: "public", table: "ai_workers" }, load)
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const kinds = useMemo(() => {
    const s = new Set<string>();
    jobs.forEach((j) => s.add(j.kind));
    return [ALL, ...Array.from(s).sort()];
  }, [jobs]);

  const filteredJobs = useMemo(
    () =>
      jobs.filter(
        (j) =>
          (statusFilter === ALL || j.status === statusFilter) &&
          (kindFilter === ALL || j.kind === kindFilter),
      ),
    [jobs, statusFilter, kindFilter],
  );

  const counts = useMemo(() => {
    const c: Record<string, number> = { queued: 0, claimed: 0, running: 0, succeeded: 0, failed: 0, auto_blocked: 0 };
    jobs.forEach((j) => (c[j.status] = (c[j.status] ?? 0) + 1));
    return c;
  }, [jobs]);

  const draftsReady = drafts.filter((d) => d.status === "ready_for_review");

  const openJob = async (job: Job) => {
    setSelectedJob(job);
    setSelectedJobResults([]);
    const { data, error } = await supabase
      .from("ai_job_results")
      .select("*")
      .eq("job_id", job.id)
      .order("attempt", { ascending: false });
    if (error) toast.error("Results: " + error.message);
    else setSelectedJobResults((data ?? []) as Result[]);
  };

  const openDraft = (d: Draft) => {
    setSelectedDraft(d);
    setReviewNote(d.review_note ?? "");
  };

  const reviewDraft = async (status: "approved" | "rejected") => {
    if (!selectedDraft) return;
    const { data: u } = await supabase.auth.getUser();
    const { error } = await supabase
      .from("ai_draft_outputs")
      .update({
        status,
        review_note: reviewNote || null,
        reviewed_at: new Date().toISOString(),
        reviewed_by: u.user?.id ?? null,
      })
      .eq("id", selectedDraft.id);
    if (error) toast.error(error.message);
    else {
      toast.success(`Draft ${status}`);
      setSelectedDraft(null);
      setReviewNote("");
    }
  };

  const copyBody = async () => {
    if (!selectedDraft) return;
    await navigator.clipboard.writeText(selectedDraft.body_md);
    toast.success("Copied to clipboard");
  };

  return (
    <div className="space-y-6 p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">AI Jobs (local Ollama worker)</h1>
          <p className="text-sm text-muted-foreground">
            Queue health, per-job attempts, and drafts awaiting operator review. Outputs apply only after approval.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={load}>
          <RefreshCw className="h-4 w-4 mr-2" />
          Refresh
        </Button>
      </div>

      <AiJobsSentinelAlerts />

      <div className="grid grid-cols-2 md:grid-cols-6 gap-2">
        {Object.entries(counts).map(([k, v]) => (
          <Card key={k}>
            <CardContent className="p-3">
              <div className="text-xs text-muted-foreground capitalize">{k.replace("_", " ")}</div>
              <div className="text-2xl font-semibold">{v}</div>
            </CardContent>
          </Card>
        ))}
      </div>

      <Tabs defaultValue="jobs">
        <TabsList>
          <TabsTrigger value="jobs">Jobs ({jobs.length})</TabsTrigger>
          <TabsTrigger value="drafts">
            Drafts {draftsReady.length > 0 && <Badge className="ml-2" variant="secondary">{draftsReady.length}</Badge>}
          </TabsTrigger>
          <TabsTrigger value="workers">Workers ({workers.length})</TabsTrigger>
        </TabsList>

        <TabsContent value="jobs" className="space-y-3">
          <div className="flex gap-2">
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-[180px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                {STATUSES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={kindFilter} onValueChange={setKindFilter}>
              <SelectTrigger className="w-[260px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                {kinds.map((k) => <SelectItem key={k} value={k}>{k}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <Card>
            <CardContent className="p-0">
              {loading ? (
                <div className="p-4 space-y-2">
                  {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-8 w-full" />)}
                </div>
              ) : filteredJobs.length === 0 ? (
                <div className="p-8 text-center text-sm text-muted-foreground">No jobs match.</div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Kind</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Attempts</TableHead>
                      <TableHead>Model</TableHead>
                      <TableHead>Heartbeat</TableHead>
                      <TableHead>Created</TableHead>
                      <TableHead>Error</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredJobs.map((j) => (
                      <TableRow key={j.id} className="cursor-pointer" onClick={() => openJob(j)}>
                        <TableCell className="font-mono text-xs">{j.kind}</TableCell>
                        <TableCell>{statusBadge(j.status)}</TableCell>
                        <TableCell>{j.attempts}/{j.max_retries}</TableCell>
                        <TableCell className="text-xs">{j.requested_model ?? "—"}</TableCell>
                        <TableCell className="text-xs">{fmtTime(j.heartbeat_at)}</TableCell>
                        <TableCell className="text-xs">{fmtTime(j.created_at)}</TableCell>
                        <TableCell className="text-xs max-w-[280px] truncate text-destructive">
                          {j.last_error ?? ""}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="drafts" className="space-y-3">
          <Card>
            <CardContent className="p-0">
              {loading ? (
                <div className="p-4 space-y-2">
                  {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-8 w-full" />)}
                </div>
              ) : drafts.length === 0 ? (
                <div className="p-8 text-center text-sm text-muted-foreground">No drafts yet.</div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Kind</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Target</TableHead>
                      <TableHead>Created</TableHead>
                      <TableHead>Reviewed</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {drafts.map((d) => (
                      <TableRow key={d.id} className="cursor-pointer" onClick={() => openDraft(d)}>
                        <TableCell className="font-mono text-xs">{d.kind}</TableCell>
                        <TableCell>{statusBadge(d.status)}</TableCell>
                        <TableCell className="text-xs max-w-[400px] truncate">
                          {JSON.stringify(d.target_ref)}
                        </TableCell>
                        <TableCell className="text-xs">{fmtTime(d.created_at)}</TableCell>
                        <TableCell className="text-xs">{fmtTime(d.reviewed_at)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="workers" className="space-y-3">
          <OllamaConfigSummary workers={workers} loading={loading} />
          <Card>
            <CardContent className="p-0">
              {loading ? (
                <div className="p-4 space-y-2">
                  {Array.from({ length: 2 }).map((_, i) => <Skeleton key={i} className="h-8 w-full" />)}
                </div>
              ) : workers.length === 0 ? (
                <div className="p-8 text-center text-sm text-muted-foreground">
                  No workers registered. Start the Ollama worker script to register one.
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Name</TableHead>
                      <TableHead>Enabled</TableHead>
                      <TableHead>Default model</TableHead>
                      <TableHead>Available tags</TableHead>
                      <TableHead>Last seen</TableHead>
                      <TableHead>Created</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {workers.map((w) => (
                      <TableRow key={w.id}>
                        <TableCell className="font-medium">{w.name}</TableCell>
                        <TableCell>{w.enabled ? <Badge>on</Badge> : <Badge variant="outline">off</Badge>}</TableCell>
                        <TableCell className="text-xs font-mono">{w.default_model ?? "—"}</TableCell>
                        <TableCell className="text-xs">
                          <div className="flex flex-wrap gap-1">
                            {w.model_tags.length === 0
                              ? <span className="text-muted-foreground">—</span>
                              : w.model_tags.map((t) => (
                                  <Badge key={t} variant="outline" className="font-mono text-[10px]">{t}</Badge>
                                ))}
                          </div>
                        </TableCell>
                        <TableCell className="text-xs">{fmtTime(w.last_seen_at)}</TableCell>
                        <TableCell className="text-xs">{fmtTime(w.created_at)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Job detail dialog */}
      <Dialog open={!!selectedJob} onOpenChange={(o) => !o && setSelectedJob(null)}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <span className="font-mono text-sm">{selectedJob?.kind}</span>
              {selectedJob && statusBadge(selectedJob.status)}
            </DialogTitle>
          </DialogHeader>
          {selectedJob && (
            <ScrollArea className="max-h-[70vh]">
              <div className="space-y-4 pr-4">
                <div className="grid grid-cols-2 gap-2 text-xs">
                  <div><span className="text-muted-foreground">id:</span> <span className="font-mono">{selectedJob.id}</span></div>
                  <div><span className="text-muted-foreground">priority:</span> {selectedJob.priority}</div>
                  <div><span className="text-muted-foreground">attempts:</span> {selectedJob.attempts}/{selectedJob.max_retries}</div>
                  <div><span className="text-muted-foreground">model:</span> {selectedJob.requested_model ?? "—"}</div>
                  <div><span className="text-muted-foreground">claimed_by:</span> {selectedJob.claimed_by ?? "—"}</div>
                  <div><span className="text-muted-foreground">heartbeat:</span> {fmtTime(selectedJob.heartbeat_at)}</div>
                  <div><span className="text-muted-foreground">idempotency:</span> <span className="font-mono">{selectedJob.idempotency_key ?? "—"}</span></div>
                  <div><span className="text-muted-foreground">created:</span> {fmtTime(selectedJob.created_at)}</div>
                </div>
                {selectedJob.last_error && (
                  <div>
                    <div className="text-xs font-semibold mb-1 text-destructive">Last error</div>
                    <pre className="text-xs bg-muted p-2 rounded whitespace-pre-wrap">{selectedJob.last_error}</pre>
                  </div>
                )}
                <div>
                  <div className="text-xs font-semibold mb-1">Input</div>
                  <pre className="text-xs bg-muted p-2 rounded whitespace-pre-wrap">
                    {JSON.stringify(selectedJob.input_json, null, 2)}
                  </pre>
                </div>
                <div>
                  <div className="text-xs font-semibold mb-1">Attempts ({selectedJobResults.length})</div>
                  {selectedJobResults.length === 0 ? (
                    <div className="text-xs text-muted-foreground">No attempts recorded yet.</div>
                  ) : (
                    <div className="space-y-2">
                      {selectedJobResults.map((r) => (
                        <div key={r.id} className="border rounded p-2 text-xs space-y-1">
                          <div className="flex justify-between">
                            <span>
                              attempt #{r.attempt} · {r.model ?? "?"} · {r.latency_ms ?? 0}ms · {r.tokens_in ?? 0}→{r.tokens_out ?? 0} tok
                            </span>
                            <span className="text-muted-foreground">{fmtTime(r.created_at)}</span>
                          </div>
                          {r.error && <pre className="bg-destructive/10 p-2 rounded whitespace-pre-wrap text-destructive">{r.error}</pre>}
                          {r.output_text && (
                            <pre className="bg-muted p-2 rounded whitespace-pre-wrap max-h-[200px] overflow-auto">{r.output_text}</pre>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </ScrollArea>
          )}
        </DialogContent>
      </Dialog>

      {/* Draft review dialog */}
      <Dialog open={!!selectedDraft} onOpenChange={(o) => !o && setSelectedDraft(null)}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <span className="font-mono text-sm">{selectedDraft?.kind}</span>
              {selectedDraft && statusBadge(selectedDraft.status)}
            </DialogTitle>
          </DialogHeader>
          {selectedDraft && (
            <ScrollArea className="max-h-[70vh]">
              <div className="space-y-3 pr-4">
                <div className="text-xs">
                  <span className="text-muted-foreground">target:</span>{" "}
                  <span className="font-mono">{JSON.stringify(selectedDraft.target_ref)}</span>
                </div>
                <div>
                  <div className="text-xs font-semibold mb-1">Draft markdown</div>
                  <pre className="text-xs bg-muted p-3 rounded whitespace-pre-wrap">{selectedDraft.body_md}</pre>
                </div>
                <div>
                  <div className="text-xs font-semibold mb-1">Review note (optional)</div>
                  <Textarea value={reviewNote} onChange={(e) => setReviewNote(e.target.value)} rows={2} />
                </div>
                <div className="flex gap-2">
                  <Button size="sm" variant="outline" onClick={copyBody}>
                    <Copy className="h-4 w-4 mr-1" /> Copy
                  </Button>
                  <div className="flex-1" />
                  {selectedDraft.status === "ready_for_review" && (
                    <>
                      <Button size="sm" variant="destructive" onClick={() => reviewDraft("rejected")}>
                        <XCircle className="h-4 w-4 mr-1" /> Reject
                      </Button>
                      <Button size="sm" onClick={() => reviewDraft("approved")}>
                        <CheckCircle2 className="h-4 w-4 mr-1" /> Approve
                      </Button>
                    </>
                  )}
                </div>
              </div>
            </ScrollArea>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
