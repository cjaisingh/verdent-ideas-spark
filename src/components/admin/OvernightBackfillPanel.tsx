import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { toast } from "@/hooks/use-toast";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";

// "Backfill" = recreate fresh `queued` rows in roadmap_phase_overnight_runs
// for phases whose previous run was lost or stuck because of an outage
// (e.g. the AWIP_SERVICE_TOKEN auth-failure window). The original rows are
// preserved for audit; we insert new ones and immediately invoke the
// overnight-phase-runner so they don't have to wait for the next 15-min tick.
//
// Eligible candidates:
//   - status = 'failed'    (errored last run)
//   - status = 'cancelled' (operator cancelled while broken)
//   - status = 'running'   AND started_at < now() - 60min  (stuck)
//   - status = 'queued'    AND requested_at < now() - 2h   (never picked up)
type RunRow = {
  id: string;
  phase_id: string;
  phase_key: string;
  status: string;
  scheduled_for: string;
  requested_at: string;
  started_at: string | null;
  finished_at: string | null;
  error: string | null;
};

type Collision = "hard" | "active" | "recent" | "clean";

type ExistingRef = {
  id: string;
  status: string;
  scheduled_for: string;
  requested_at: string;
  started_at: string | null;
  finished_at: string | null;
};

type AnnotatedInsert = {
  phase_id: string;
  phase_key: string;
  scheduled_for: string;
  collision: Collision;
  existing: ExistingRef[];
};

const STATUS_VARIANT: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  failed: "destructive",
  cancelled: "outline",
  running: "secondary",
  queued: "secondary",
  done: "default",
};

const COLLISION_VARIANT: Record<Collision, "default" | "secondary" | "destructive" | "outline"> = {
  hard: "destructive",
  active: "secondary",
  recent: "outline",
  clean: "default",
};

const COLLISION_LABEL: Record<Collision, string> = {
  hard: "hard duplicate",
  active: "active elsewhere",
  recent: "recently done",
  clean: "clean",
};

const isStuck = (r: RunRow) => {
  if (r.status === "failed" || r.status === "cancelled") return true;
  if (r.status === "running" && r.started_at && Date.now() - new Date(r.started_at).getTime() > 60 * 60_000) return true;
  if (r.status === "queued" && Date.now() - new Date(r.requested_at).getTime() > 2 * 60 * 60_000) return true;
  return false;
};

const fmtAge = (iso: string | null) => {
  if (!iso) return "";
  const ms = Date.now() - new Date(iso).getTime();
  const m = Math.round(ms / 60_000);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
};

const OvernightBackfillPanel = () => {
  const [rows, setRows] = useState<RunRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [excluded, setExcluded] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [dryRun, setDryRun] = useState(true);
  const [lastResult, setLastResult] = useState<unknown>(null);
  const [annotated, setAnnotated] = useState<AnnotatedInsert[] | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [pendingHardCount, setPendingHardCount] = useState(0);

  const refresh = async () => {
    setLoading(true);
    const since = new Date(Date.now() - 7 * 24 * 3600_000).toISOString();
    const { data, error } = await supabase
      .from("roadmap_phase_overnight_runs")
      .select("id, phase_id, phase_key, status, scheduled_for, requested_at, started_at, finished_at, error")
      .gte("requested_at", since)
      .order("requested_at", { ascending: false })
      .limit(50);
    setLoading(false);
    if (error) {
      toast({ title: "Failed to load overnight runs", description: error.message, variant: "destructive" });
      return;
    }
    setRows((data ?? []) as RunRow[]);
    setSelected(new Set());
    setExcluded(new Set());
    setAnnotated(null);
    setLastResult(null);
  };

  useEffect(() => { refresh(); }, []);

  const candidates = useMemo(() => rows.filter(isStuck), [rows]);
  // De-dupe by phase_id — re-queueing the same phase twice in one shot makes no sense.
  const selectableByPhase = useMemo(() => {
    const m = new Map<string, RunRow>();
    for (const r of candidates) if (!m.has(r.phase_id)) m.set(r.phase_id, r);
    return Array.from(m.values());
  }, [candidates]);

  const toggle = (id: string) => {
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };
  const toggleExclude = (phaseId: string) => {
    setExcluded((s) => {
      const next = new Set(s);
      if (next.has(phaseId)) next.delete(phaseId); else next.add(phaseId);
      return next;
    });
  };
  const selectAll = () => setSelected(new Set(selectableByPhase.map((r) => r.id)));
  const clearAll = () => setSelected(new Set());

  // Build the annotated plan: planned inserts + collision class against existing rows.
  const buildPlan = async (): Promise<AnnotatedInsert[]> => {
    const picks = selectableByPhase.filter((r) => selected.has(r.id));
    if (picks.length === 0) return [];
    const today = new Date().toISOString().slice(0, 10);
    const phaseIds = Array.from(new Set(picks.map((p) => p.phase_id)));
    const since24h = new Date(Date.now() - 24 * 3600_000).toISOString();
    const recentSince = new Date(Date.now() - 6 * 3600_000).toISOString();

    const { data: existing, error } = await supabase
      .from("roadmap_phase_overnight_runs")
      .select("id, phase_id, status, scheduled_for, requested_at, started_at, finished_at")
      .in("phase_id", phaseIds)
      .gte("requested_at", since24h);
    if (error) throw error;

    const byPhase = new Map<string, ExistingRef[]>();
    for (const e of (existing ?? []) as ExistingRef[] & { phase_id: string }[]) {
      const list = byPhase.get((e as any).phase_id) ?? [];
      list.push({
        id: e.id,
        status: e.status,
        scheduled_for: e.scheduled_for,
        requested_at: e.requested_at,
        started_at: e.started_at,
        finished_at: e.finished_at,
      });
      byPhase.set((e as any).phase_id, list);
    }

    return picks.map((p) => {
      const ex = byPhase.get(p.phase_id) ?? [];
      let collision: Collision = "clean";
      const hard = ex.some((e) => e.scheduled_for === today && (e.status === "queued" || e.status === "running"));
      const active = ex.some((e) => e.status === "queued" || e.status === "running");
      const recent = ex.some((e) => e.status === "done" && e.finished_at && e.finished_at > recentSince);
      if (hard) collision = "hard";
      else if (active) collision = "active";
      else if (recent) collision = "recent";
      return {
        phase_id: p.phase_id,
        phase_key: p.phase_key,
        scheduled_for: today,
        collision,
        existing: ex.sort((a, b) => b.requested_at.localeCompare(a.requested_at)),
      };
    });
  };

  const summary = useMemo(() => {
    const s = { hard: 0, active: 0, recent: 0, clean: 0 };
    if (!annotated) return s;
    for (const a of annotated) if (!excluded.has(a.phase_id)) s[a.collision]++;
    return s;
  }, [annotated, excluded]);

  const previewPlan = async () => {
    setBusy(true);
    try {
      const plan = await buildPlan();
      setAnnotated(plan);
      setExcluded(new Set());
      const runnerUrl = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/overnight-phase-runner`;
      setLastResult({
        dry_run: true,
        would_requeue: plan.length,
        planned_inserts: plan.map((p) => ({
          phase_id: p.phase_id,
          phase_key: p.phase_key,
          scheduled_for: p.scheduled_for,
          status: "queued",
        })),
        collisions: plan.filter((p) => p.collision !== "clean"),
        runner_url: runnerUrl,
      });
      toast({
        title: `Dry run: ${plan.length} planned`,
        description: `${plan.filter((p) => p.collision === "hard").length} hard · ${plan.filter((p) => p.collision === "active").length} active · ${plan.filter((p) => p.collision === "recent").length} recent`,
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      toast({ title: "Dry run failed", description: msg, variant: "destructive" });
    } finally {
      setBusy(false);
    }
  };

  const executePlan = async () => {
    setBusy(true);
    try {
      const plan = await buildPlan();
      setAnnotated(plan);
      const effective = plan.filter((p) => !excluded.has(p.phase_id));
      const hardCount = effective.filter((p) => p.collision === "hard").length;
      if (hardCount > 0 && !confirmOpen) {
        setPendingHardCount(hardCount);
        setConfirmOpen(true);
        setBusy(false);
        return;
      }
      await doInsertAndRun(effective);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      toast({ title: "Backfill failed", description: msg, variant: "destructive" });
    } finally {
      setBusy(false);
    }
  };

  const doInsertAndRun = async (effective: AnnotatedInsert[]) => {
    if (effective.length === 0) {
      toast({ title: "Nothing to insert", description: "All planned phases were excluded." });
      return;
    }
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error("not signed in");
    const inserts = effective.map((p) => ({
      phase_id: p.phase_id,
      phase_key: p.phase_key,
      requested_by: user.id,
      scheduled_for: p.scheduled_for,
      status: "queued" as const,
    }));
    const runnerUrl = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/overnight-phase-runner`;
    const { data: inserted, error: insErr } = await supabase
      .from("roadmap_phase_overnight_runs")
      .insert(inserts)
      .select("id, phase_key");
    if (insErr) throw insErr;
    const newIds = (inserted ?? []).map((r: any) => r.id);

    const { data: { session } } = await supabase.auth.getSession();
    const results: unknown[] = [];
    for (const id of newIds) {
      const resp = await fetch(runnerUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${session?.access_token ?? ""}`,
          "apikey": import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
        },
        body: JSON.stringify({ run_id: id }),
      });
      const text = await resp.text();
      let parsed: unknown = text;
      try { parsed = JSON.parse(text); } catch {/* keep raw */}
      results.push({ run_id: id, http: resp.status, body: parsed });
    }
    setLastResult({ requeued: inserts.length, run_ids: newIds, runner_results: results });
    toast({
      title: `Re-queued ${inserts.length} phase${inserts.length === 1 ? "" : "s"}`,
      description: "Runner invoked synchronously per run.",
    });
    await refresh();
  };

  const onPrimary = () => (dryRun ? previewPlan() : executePlan());

  const confirmAndProceed = async () => {
    setConfirmOpen(false);
    setBusy(true);
    try {
      const plan = annotated ?? (await buildPlan());
      const effective = plan.filter((p) => !excluded.has(p.phase_id));
      await doInsertAndRun(effective);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      toast({ title: "Backfill failed", description: msg, variant: "destructive" });
    } finally {
      setBusy(false);
    }
  };

  const effectiveCount = annotated ? annotated.filter((p) => !excluded.has(p.phase_id)).length : selected.size;

  return (
    <section className="space-y-3">
      <div className="flex items-end justify-between gap-3">
        <div>
          <h2 className="text-lg font-medium">Overnight runs — backfill &amp; retry</h2>
          <p className="text-sm text-muted-foreground">
            Recreates <code className="font-mono">roadmap_phase_overnight_runs</code> rows for phases that
            failed, were cancelled, or got stuck during the auth outage, then invokes the runner immediately.
            Original rows are kept for audit.
          </p>
          <p className="text-xs mt-1 text-muted-foreground">
            {dryRun
              ? "Dry run is on — nothing will be written. Preview shows duplicate-collision diff."
              : "Dry run is off — selected phases will be re-queued and the runner will be invoked."}
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={refresh} disabled={loading}>
          {loading ? "Loading…" : "Refresh"}
        </Button>
      </div>

      <div className="flex items-center gap-2 text-xs">
        <span className="text-muted-foreground">
          {selectableByPhase.length} candidate phase{selectableByPhase.length === 1 ? "" : "s"} · {selected.size} selected
        </span>
        <label className="ml-3 inline-flex items-center gap-1.5 cursor-pointer">
          <Checkbox
            checked={dryRun}
            onCheckedChange={(v) => setDryRun(v === true)}
            aria-label="Dry run"
          />
          <span>Dry run</span>
        </label>
        <div className="ml-auto flex gap-2">
          <Button variant="outline" size="sm" onClick={selectAll} disabled={selectableByPhase.length === 0}>
            Select all
          </Button>
          <Button variant="outline" size="sm" onClick={clearAll} disabled={selected.size === 0}>
            Clear
          </Button>
          <Button
            size="sm"
            variant={dryRun ? "outline" : "default"}
            onClick={onPrimary}
            disabled={busy || selected.size === 0}
          >
            {busy
              ? (dryRun ? "Previewing…" : "Re-queueing…")
              : dryRun
                ? `Preview re-queue (${selected.size})`
                : `Re-queue & run ${effectiveCount || ""}`}
          </Button>
        </div>
      </div>

      <div className="border border-border rounded-md overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-10"></TableHead>
              <TableHead>Phase</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Requested</TableHead>
              <TableHead>Error</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {selectableByPhase.length === 0 && (
              <TableRow>
                <TableCell colSpan={5} className="text-sm text-muted-foreground py-6 text-center">
                  {loading ? "Loading…" : "No failed, cancelled, or stuck overnight runs in the last 7 days."}
                </TableCell>
              </TableRow>
            )}
            {selectableByPhase.map((r) => (
              <TableRow key={r.id}>
                <TableCell>
                  <Checkbox
                    checked={selected.has(r.id)}
                    onCheckedChange={() => toggle(r.id)}
                    aria-label={`Select ${r.phase_key}`}
                  />
                </TableCell>
                <TableCell>
                  <div className="font-medium">{r.phase_key}</div>
                  <div className="text-xs font-mono text-muted-foreground">{r.phase_id.slice(0, 8)}</div>
                </TableCell>
                <TableCell>
                  <Badge variant={STATUS_VARIANT[r.status] ?? "outline"}>{r.status}</Badge>
                </TableCell>
                <TableCell className="text-xs text-muted-foreground tabular-nums">
                  {new Date(r.requested_at).toLocaleString()}
                </TableCell>
                <TableCell className="text-xs text-destructive max-w-md truncate" title={r.error ?? ""}>
                  {r.error ?? "—"}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      {annotated && annotated.length > 0 && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <span className="text-muted-foreground">Collision diff:</span>
            <Badge variant="default">{summary.clean} clean</Badge>
            <Badge variant="outline">{summary.recent} recent</Badge>
            <Badge variant="secondary">{summary.active} active</Badge>
            <Badge variant="destructive">{summary.hard} hard</Badge>
            <span className="ml-auto text-muted-foreground">
              {effectiveCount} of {annotated.length} will be inserted
            </span>
          </div>
          <div className="border border-border rounded-md overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Phase</TableHead>
                  <TableHead>Planned</TableHead>
                  <TableHead>Collision</TableHead>
                  <TableHead>Existing rows (last 24h)</TableHead>
                  <TableHead className="w-20 text-right">Exclude</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {annotated.map((a) => {
                  const isExcluded = excluded.has(a.phase_id);
                  return (
                    <TableRow key={a.phase_id} className={isExcluded ? "opacity-50" : ""}>
                      <TableCell>
                        <div className="font-medium">{a.phase_key}</div>
                        <div className="text-xs font-mono text-muted-foreground">{a.phase_id.slice(0, 8)}</div>
                      </TableCell>
                      <TableCell className="text-xs">
                        <Badge variant="secondary">queued</Badge>
                        <span className="ml-2 font-mono text-muted-foreground">{a.scheduled_for}</span>
                      </TableCell>
                      <TableCell>
                        <Badge variant={COLLISION_VARIANT[a.collision]}>{COLLISION_LABEL[a.collision]}</Badge>
                      </TableCell>
                      <TableCell className="text-xs space-y-0.5">
                        {a.existing.length === 0 && <span className="text-muted-foreground">—</span>}
                        {a.existing.slice(0, 4).map((e) => (
                          <div key={e.id} className="flex items-center gap-1.5">
                            <Badge variant={STATUS_VARIANT[e.status] ?? "outline"} className="text-[10px] py-0 px-1">
                              {e.status}
                            </Badge>
                            <span className="font-mono text-muted-foreground">@{e.scheduled_for}</span>
                            {e.started_at && (
                              <span className="text-muted-foreground">started {fmtAge(e.started_at)}</span>
                            )}
                            {!e.started_at && (
                              <span className="text-muted-foreground">requested {fmtAge(e.requested_at)}</span>
                            )}
                          </div>
                        ))}
                        {a.existing.length > 4 && (
                          <div className="text-muted-foreground">+{a.existing.length - 4} more</div>
                        )}
                      </TableCell>
                      <TableCell className="text-right">
                        <Checkbox
                          checked={isExcluded}
                          onCheckedChange={() => toggleExclude(a.phase_id)}
                          aria-label={`Exclude ${a.phase_key}`}
                        />
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        </div>
      )}

      {lastResult !== null && (
        <details className="text-xs">
          <summary className="cursor-pointer text-muted-foreground hover:text-foreground">
            Raw plan / result JSON
          </summary>
          <pre className="font-mono bg-muted/50 rounded p-2 max-h-56 overflow-auto mt-1">
            {JSON.stringify(lastResult, null, 2)}
          </pre>
        </details>
      )}

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Hard duplicates detected</AlertDialogTitle>
            <AlertDialogDescription>
              {pendingHardCount} of the selected phase{pendingHardCount === 1 ? "" : "s"} already
              {pendingHardCount === 1 ? " has" : " have"} a queued or running row for today.
              Proceeding will create a second active run for the same phase on the same day.
              Exclude them in the diff table or proceed anyway.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={confirmAndProceed}>Proceed anyway</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
};

export default OvernightBackfillPanel;
