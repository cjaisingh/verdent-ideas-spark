import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { toast } from "@/hooks/use-toast";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";

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

const STATUS_VARIANT: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  failed: "destructive",
  cancelled: "outline",
  running: "secondary",
  queued: "secondary",
  done: "default",
};

const isStuck = (r: RunRow) => {
  if (r.status === "failed" || r.status === "cancelled") return true;
  if (r.status === "running" && r.started_at && Date.now() - new Date(r.started_at).getTime() > 60 * 60_000) return true;
  if (r.status === "queued" && Date.now() - new Date(r.requested_at).getTime() > 2 * 60 * 60_000) return true;
  return false;
};

const OvernightBackfillPanel = () => {
  const [rows, setRows] = useState<RunRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [dryRun, setDryRun] = useState(true);
  const [lastResult, setLastResult] = useState<unknown>(null);

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
  const selectAll = () => setSelected(new Set(selectableByPhase.map((r) => r.id)));
  const clearAll = () => setSelected(new Set());

  const backfillAndRun = async () => {
    if (selected.size === 0) return;
    setBusy(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("not signed in");
      const picks = selectableByPhase.filter((r) => selected.has(r.id));
      const today = new Date().toISOString().slice(0, 10);
      const inserts = picks.map((r) => ({
        phase_id: r.phase_id,
        phase_key: r.phase_key,
        requested_by: user.id,
        scheduled_for: today,
        status: "queued",
      }));
      const { data: inserted, error: insErr } = await supabase
        .from("roadmap_phase_overnight_runs")
        .insert(inserts)
        .select("id, phase_key");
      if (insErr) throw insErr;
      const newIds = (inserted ?? []).map((r: any) => r.id);

      // Kick the runner immediately for each new run id so we don't wait for
      // the next 15-min cron tick. The function processes one explicit run_id
      // per call (cron sweeps the whole queue when no body is given).
      const { data: { session } } = await supabase.auth.getSession();
      const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/overnight-phase-runner`;
      const results: unknown[] = [];
      for (const id of newIds) {
        const resp = await fetch(url, {
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
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      toast({ title: "Backfill failed", description: msg, variant: "destructive" });
    } finally {
      setBusy(false);
    }
  };

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
        </div>
        <Button variant="outline" size="sm" onClick={refresh} disabled={loading}>
          {loading ? "Loading…" : "Refresh"}
        </Button>
      </div>

      <div className="flex items-center gap-2 text-xs">
        <span className="text-muted-foreground">
          {selectableByPhase.length} candidate phase{selectableByPhase.length === 1 ? "" : "s"} · {selected.size} selected
        </span>
        <div className="ml-auto flex gap-2">
          <Button variant="outline" size="sm" onClick={selectAll} disabled={selectableByPhase.length === 0}>
            Select all
          </Button>
          <Button variant="outline" size="sm" onClick={clearAll} disabled={selected.size === 0}>
            Clear
          </Button>
          <Button size="sm" onClick={backfillAndRun} disabled={busy || selected.size === 0}>
            {busy ? "Re-queueing…" : `Re-queue & run ${selected.size || ""}`}
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

      {lastResult !== null && (
        <pre className="font-mono text-xs bg-muted/50 rounded p-2 max-h-56 overflow-auto">
          {JSON.stringify(lastResult, null, 2)}
        </pre>
      )}
    </section>
  );
};

export default OvernightBackfillPanel;
