import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { RefreshCcw, Activity, AlertTriangle } from "lucide-react";
import { Link } from "react-router-dom";

type PerfRow = {
  check_key: string;
  runs: number;
  errors: number;
  p50_ms: number;
  p95_ms: number;
  max_ms: number;
  total_candidates: number;
  total_alerts: number;
  total_retries: number;
  avg_open_depth: number;
  last_run_at: string;
};

type RunRow = {
  id: string;
  created_at: string;
  tick_id: string;
  check_key: string;
  duration_ms: number;
  candidates_emitted: number;
  alerts_dispatched: number;
  alert_retries: number;
  open_depth_after: number;
  error: string | null;
};

type SortKey = "p95_ms" | "p50_ms" | "max_ms" | "runs" | "errors" | "total_candidates" | "total_alerts" | "total_retries" | "avg_open_depth" | "check_key";

function fmtMs(ms: number) {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}
function fmtRel(iso: string) {
  const diff = Date.now() - new Date(iso).getTime();
  if (diff < 60_000) return `${Math.floor(diff / 1000)}s ago`;
  if (diff < 3600_000) return `${Math.floor(diff / 60_000)}m ago`;
  return `${Math.floor(diff / 3600_000)}h ago`;
}

export default function SentinelPerf() {
  const [rows, setRows] = useState<PerfRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [sortKey, setSortKey] = useState<SortKey>("p95_ms");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [openCheck, setOpenCheck] = useState<string | null>(null);
  const [drawerRows, setDrawerRows] = useState<RunRow[]>([]);

  const load = async () => {
    setLoading(true);
    const { data } = await (supabase as any)
      .from("v_sentinel_check_perf_24h")
      .select("*");
    setRows((data ?? []) as PerfRow[]);
    setLoading(false);
  };

  useEffect(() => {
    load();
    const ch = (supabase as any)
      .channel(`sentinel-perf-${crypto.randomUUID()}`)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "sentinel_check_runs" }, () => load())
      .subscribe();
    return () => { (supabase as any).removeChannel(ch); };
  }, []);

  useEffect(() => {
    if (!openCheck) return;
    (async () => {
      const { data } = await (supabase as any)
        .from("sentinel_check_runs")
        .select("*")
        .eq("check_key", openCheck)
        .order("created_at", { ascending: false })
        .limit(50);
      setDrawerRows((data ?? []) as RunRow[]);
    })();
  }, [openCheck]);

  const sorted = useMemo(() => {
    const cp = [...rows];
    cp.sort((a, b) => {
      const av = a[sortKey] as unknown as number | string;
      const bv = b[sortKey] as unknown as number | string;
      if (typeof av === "string" && typeof bv === "string") {
        return sortDir === "asc" ? av.localeCompare(bv) : bv.localeCompare(av);
      }
      const an = Number(av), bn = Number(bv);
      return sortDir === "asc" ? an - bn : bn - an;
    });
    return cp;
  }, [rows, sortKey, sortDir]);

  const toggleSort = (k: SortKey) => {
    if (sortKey === k) setSortDir(d => d === "asc" ? "desc" : "asc");
    else { setSortKey(k); setSortDir("desc"); }
  };

  const sumRuns = rows.reduce((s, r) => s + r.runs, 0);
  const sumAlerts = rows.reduce((s, r) => s + r.total_alerts, 0);
  const sumErrors = rows.reduce((s, r) => s + r.errors, 0);

  return (
    <div className="container mx-auto p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold flex items-center gap-2">
            <Activity className="h-7 w-7" /> Sentinel check performance
          </h1>
          <p className="text-muted-foreground mt-1">
            Per-check latency, retry counts and queue depth over the last 24 hours. Click a row for last 50 runs.
          </p>
        </div>
        <div className="flex gap-2">
          <Button asChild variant="outline" size="sm"><Link to="/admin/edge-health">Edge health</Link></Button>
          <Button asChild variant="outline" size="sm"><Link to="/admin/timeline">Timeline</Link></Button>
          <Button onClick={load} variant="outline" size="sm"><RefreshCcw className="h-4 w-4 mr-1" />Refresh</Button>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-4">
        <Card><CardHeader className="pb-2"><CardTitle className="text-sm text-muted-foreground">Runs (24h)</CardTitle></CardHeader>
          <CardContent className="text-2xl font-bold">{sumRuns}</CardContent></Card>
        <Card><CardHeader className="pb-2"><CardTitle className="text-sm text-muted-foreground">Alerts dispatched</CardTitle></CardHeader>
          <CardContent className="text-2xl font-bold">{sumAlerts}</CardContent></Card>
        <Card><CardHeader className="pb-2"><CardTitle className="text-sm text-muted-foreground">Checks with errors</CardTitle></CardHeader>
          <CardContent className="text-2xl font-bold">{sumErrors}</CardContent></Card>
      </div>

      <Card>
        <CardHeader><CardTitle className="text-base">Checks ({rows.length})</CardTitle></CardHeader>
        <CardContent className="p-0">
          {loading ? (
            <div className="p-6 text-muted-foreground">Loading…</div>
          ) : rows.length === 0 ? (
            <div className="p-6 text-muted-foreground">No runs in the last 24h. Trigger sentinel-tick once and refresh.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted/40">
                  <tr className="text-left">
                    {([
                      ["check_key", "Check"],
                      ["runs", "Runs"],
                      ["errors", "Errors"],
                      ["p50_ms", "p50"],
                      ["p95_ms", "p95"],
                      ["max_ms", "max"],
                      ["total_candidates", "Cand."],
                      ["total_alerts", "Alerts"],
                      ["total_retries", "Retries"],
                      ["avg_open_depth", "Avg open"],
                    ] as [SortKey, string][]).map(([k, l]) => (
                      <th key={k} className="px-3 py-2 cursor-pointer select-none hover:bg-muted/60"
                          onClick={() => toggleSort(k)}>
                        {l}{sortKey === k && (sortDir === "asc" ? " ▲" : " ▼")}
                      </th>
                    ))}
                    <th className="px-3 py-2">Last</th>
                  </tr>
                </thead>
                <tbody>
                  {sorted.map(r => {
                    const slow = r.p95_ms > 500;
                    const errored = r.errors > 0;
                    const backed = r.avg_open_depth > 10;
                    const rowCls = errored
                      ? "bg-red-500/5 hover:bg-red-500/10"
                      : slow ? "bg-amber-500/5 hover:bg-amber-500/10" : "hover:bg-muted/40";
                    return (
                      <tr key={r.check_key} className={`border-t cursor-pointer ${rowCls}`}
                          onClick={() => setOpenCheck(r.check_key)}>
                        <td className="px-3 py-2 font-mono text-xs">{r.check_key}</td>
                        <td className="px-3 py-2">{r.runs}</td>
                        <td className="px-3 py-2">{errored ? <Badge variant="destructive">{r.errors}</Badge> : 0}</td>
                        <td className="px-3 py-2">{fmtMs(r.p50_ms)}</td>
                        <td className={`px-3 py-2 ${slow ? "text-amber-500 font-medium" : ""}`}>{fmtMs(r.p95_ms)}</td>
                        <td className="px-3 py-2">{fmtMs(r.max_ms)}</td>
                        <td className="px-3 py-2">{r.total_candidates}</td>
                        <td className="px-3 py-2">{r.total_alerts}</td>
                        <td className="px-3 py-2">{r.total_retries}</td>
                        <td className="px-3 py-2">
                          {Number(r.avg_open_depth).toFixed(1)}
                          {backed && <Badge variant="outline" className="ml-2 border-amber-500/40 text-amber-500"><AlertTriangle className="h-3 w-3 mr-1" />backed up</Badge>}
                        </td>
                        <td className="px-3 py-2 text-muted-foreground">{fmtRel(r.last_run_at)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <Sheet open={!!openCheck} onOpenChange={(o) => !o && setOpenCheck(null)}>
        <SheetContent className="w-full sm:max-w-2xl overflow-y-auto">
          <SheetHeader><SheetTitle className="font-mono text-base">{openCheck}</SheetTitle></SheetHeader>
          <div className="mt-4 space-y-3">
            {drawerRows.length === 0 ? (
              <div className="text-muted-foreground text-sm">No runs.</div>
            ) : (
              <>
                <div className="flex items-end gap-0.5 h-16 bg-muted/30 rounded p-2">
                  {[...drawerRows].reverse().map(r => {
                    const max = Math.max(...drawerRows.map(d => d.duration_ms), 1);
                    const h = Math.max(2, Math.round((r.duration_ms / max) * 56));
                    return (
                      <div key={r.id}
                        title={`${r.duration_ms}ms · ${new Date(r.created_at).toLocaleTimeString()}`}
                        className={`w-1.5 ${r.error ? "bg-red-500" : "bg-primary/60"}`}
                        style={{ height: `${h}px` }} />
                    );
                  })}
                </div>
                <table className="w-full text-xs">
                  <thead className="text-muted-foreground">
                    <tr className="text-left">
                      <th className="py-1">When</th><th>Dur</th><th>Cand</th><th>Alerts</th><th>Retries</th><th>Open</th><th>Error</th>
                    </tr>
                  </thead>
                  <tbody>
                    {drawerRows.map(r => (
                      <tr key={r.id} className="border-t">
                        <td className="py-1">{fmtRel(r.created_at)}</td>
                        <td>{fmtMs(r.duration_ms)}</td>
                        <td>{r.candidates_emitted}</td>
                        <td>{r.alerts_dispatched}</td>
                        <td>{r.alert_retries}</td>
                        <td>{r.open_depth_after}</td>
                        <td className="text-red-500 max-w-[200px] truncate" title={r.error ?? ""}>{r.error ?? ""}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </>
            )}
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}
