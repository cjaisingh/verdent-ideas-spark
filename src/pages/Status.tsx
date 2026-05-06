import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";

type LogRow = {
  id: string;
  created_at: string;
  route: string;
  method: string;
  status_code: number;
  duration_ms: number | null;
  actor: string | null;
  error: string | null;
};

type Thresholds = {
  errorRatePct: number;   // alert if > this in window
  p95Ms: number;          // alert if p95 > this in window
  slowCallMs: number;     // a single call this slow is "slow"
};

const DEFAULTS: Thresholds = { errorRatePct: 2, p95Ms: 1000, slowCallMs: 1500 };
const STORAGE = "awip.status.thresholds";

const WINDOW_HOURS = 24;
const REFRESH_MS = 15_000;

function percentile(values: number[], p: number) {
  if (!values.length) return 0;
  const s = [...values].sort((a, b) => a - b);
  const i = Math.min(s.length - 1, Math.floor((p / 100) * s.length));
  return s[i];
}

const Status = () => {
  const [logs, setLogs] = useState<LogRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [thresholds, setThresholds] = useState<Thresholds>(() => {
    try { return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(STORAGE) ?? "{}") }; }
    catch { return DEFAULTS; }
  });
  const [lastLoad, setLastLoad] = useState<Date | null>(null);

  useEffect(() => {
    localStorage.setItem(STORAGE, JSON.stringify(thresholds));
  }, [thresholds]);

  const load = async () => {
    const since = new Date(Date.now() - WINDOW_HOURS * 3600_000).toISOString();
    const { data, error } = await supabase
      .from("api_call_logs")
      .select("id, created_at, route, method, status_code, duration_ms, actor, error")
      .gte("created_at", since)
      .order("created_at", { ascending: false })
      .limit(1000);
    if (error) setError(error.message);
    else { setLogs(data as LogRow[]); setError(null); setLastLoad(new Date()); }
  };

  useEffect(() => {
    load();
    const id = setInterval(load, REFRESH_MS);
    return () => clearInterval(id);
  }, []);

  const stats = useMemo(() => {
    if (!logs) return null;
    const total = logs.length;
    const errors = logs.filter((l) => l.status_code >= 500 || (l.status_code >= 400 && l.status_code !== 401));
    const errorRate = total ? (errors.length / total) * 100 : 0;
    const durations = logs.map((l) => l.duration_ms ?? 0).filter((n) => n > 0);
    const p50 = percentile(durations, 50);
    const p95 = percentile(durations, 95);
    const p99 = percentile(durations, 99);
    const slow = logs.filter((l) => (l.duration_ms ?? 0) >= thresholds.slowCallMs);
    return { total, errors, errorRate, p50, p95, p99, slow };
  }, [logs, thresholds.slowCallMs]);

  const perRoute = useMemo(() => {
    if (!logs) return [];
    const map = new Map<string, { route: string; count: number; errors: number; durations: number[] }>();
    for (const l of logs) {
      const key = `${l.method} ${l.route}`;
      const row = map.get(key) ?? { route: key, count: 0, errors: 0, durations: [] };
      row.count++;
      if (l.status_code >= 500 || (l.status_code >= 400 && l.status_code !== 401)) row.errors++;
      if (l.duration_ms) row.durations.push(l.duration_ms);
      map.set(key, row);
    }
    return [...map.values()]
      .map((r) => ({
        route: r.route,
        count: r.count,
        errorPct: r.count ? (r.errors / r.count) * 100 : 0,
        p50: percentile(r.durations, 50),
        p95: percentile(r.durations, 95),
      }))
      .sort((a, b) => b.count - a.count);
  }, [logs]);

  const alerts = useMemo(() => {
    if (!stats) return [];
    const a: { kind: "error" | "warn"; msg: string }[] = [];
    if (stats.errorRate > thresholds.errorRatePct)
      a.push({ kind: "error", msg: `Error rate ${stats.errorRate.toFixed(1)}% exceeds ${thresholds.errorRatePct}%` });
    if (stats.p95 > thresholds.p95Ms)
      a.push({ kind: "warn", msg: `p95 latency ${stats.p95}ms exceeds ${thresholds.p95Ms}ms` });
    if (stats.slow.length > 0)
      a.push({ kind: "warn", msg: `${stats.slow.length} slow call(s) ≥ ${thresholds.slowCallMs}ms` });
    return a;
  }, [stats, thresholds]);

  const overall: "healthy" | "degraded" | "down" =
    !stats ? "healthy"
      : alerts.some((a) => a.kind === "error") ? "down"
      : alerts.length > 0 ? "degraded"
      : "healthy";

  const overallBadge =
    overall === "healthy" ? <Badge className="bg-emerald-500 hover:bg-emerald-500">Healthy</Badge>
    : overall === "degraded" ? <Badge variant="secondary">Degraded</Badge>
    : <Badge variant="destructive">Down</Badge>;

  return (
    <div className="space-y-8">
      <div className="flex items-end justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold flex items-center gap-3">
            Status {overallBadge}
          </h1>
          <p className="text-sm text-muted-foreground">
            Last {WINDOW_HOURS}h of <code className="font-mono">awip-api</code> traffic. Auto-refresh every {REFRESH_MS / 1000}s.
            {lastLoad && <span> · loaded {lastLoad.toLocaleTimeString()}</span>}
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={load}>Refresh</Button>
      </div>

      {error && (
        <div className="border border-destructive/50 text-destructive text-sm rounded-md p-3 font-mono">
          {error}
        </div>
      )}

      {alerts.length > 0 && (
        <div className="space-y-2">
          {alerts.map((a, i) => (
            <div
              key={i}
              className={`text-sm rounded-md border p-3 ${
                a.kind === "error"
                  ? "border-destructive/50 bg-destructive/5 text-destructive"
                  : "border-amber-500/40 bg-amber-500/5 text-amber-600"
              }`}
            >
              ⚠ {a.msg}
            </div>
          ))}
        </div>
      )}

      <section className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Metric label="Requests" value={stats?.total ?? "—"} sub={`${WINDOW_HOURS}h window`} />
        <Metric
          label="Error rate"
          value={stats ? `${stats.errorRate.toFixed(1)}%` : "—"}
          sub={`${stats?.errors.length ?? 0} errors`}
          tone={stats && stats.errorRate > thresholds.errorRatePct ? "bad" : "ok"}
        />
        <Metric label="p50 latency" value={stats ? `${stats.p50}ms` : "—"} />
        <Metric
          label="p95 latency"
          value={stats ? `${stats.p95}ms` : "—"}
          sub={stats ? `p99 ${stats.p99}ms` : ""}
          tone={stats && stats.p95 > thresholds.p95Ms ? "bad" : "ok"}
        />
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-medium">Per-route</h2>
        <div className="border border-border rounded-md overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Route</TableHead>
                <TableHead className="text-right">Requests</TableHead>
                <TableHead className="text-right">Error %</TableHead>
                <TableHead className="text-right">p50</TableHead>
                <TableHead className="text-right">p95</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {perRoute.length === 0 && (
                <TableRow><TableCell colSpan={5} className="text-sm text-muted-foreground py-6 text-center">
                  No traffic in window
                </TableCell></TableRow>
              )}
              {perRoute.map((r) => (
                <TableRow key={r.route}>
                  <TableCell className="font-mono text-xs">{r.route}</TableCell>
                  <TableCell className="text-right tabular-nums">{r.count}</TableCell>
                  <TableCell className="text-right tabular-nums">
                    <span className={r.errorPct > thresholds.errorRatePct ? "text-destructive font-medium" : ""}>
                      {r.errorPct.toFixed(1)}%
                    </span>
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{r.p50}ms</TableCell>
                  <TableCell className="text-right tabular-nums">
                    <span className={r.p95 > thresholds.p95Ms ? "text-destructive font-medium" : ""}>
                      {r.p95}ms
                    </span>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </section>

      <section className="grid md:grid-cols-2 gap-6">
        <div className="space-y-3">
          <h2 className="text-lg font-medium">Recent errors</h2>
          <div className="border border-border rounded-md overflow-hidden max-h-96 overflow-y-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>When</TableHead>
                  <TableHead>Route</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Error</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {stats?.errors.length === 0 && (
                  <TableRow><TableCell colSpan={4} className="text-sm text-muted-foreground py-6 text-center">
                    No errors 🎉
                  </TableCell></TableRow>
                )}
                {stats?.errors.slice(0, 50).map((e) => (
                  <TableRow key={e.id}>
                    <TableCell className="text-xs text-muted-foreground tabular-nums whitespace-nowrap">
                      {new Date(e.created_at).toLocaleTimeString()}
                    </TableCell>
                    <TableCell className="font-mono text-xs">{e.method} {e.route}</TableCell>
                    <TableCell><Badge variant="destructive">{e.status_code}</Badge></TableCell>
                    <TableCell className="text-xs font-mono text-destructive max-w-[200px] truncate" title={e.error ?? ""}>
                      {e.error ?? "—"}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </div>

        <div className="space-y-3">
          <h2 className="text-lg font-medium">Slow calls (≥ {thresholds.slowCallMs}ms)</h2>
          <div className="border border-border rounded-md overflow-hidden max-h-96 overflow-y-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>When</TableHead>
                  <TableHead>Route</TableHead>
                  <TableHead className="text-right">Duration</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {stats?.slow.length === 0 && (
                  <TableRow><TableCell colSpan={3} className="text-sm text-muted-foreground py-6 text-center">
                    None
                  </TableCell></TableRow>
                )}
                {stats?.slow.slice(0, 50).map((s) => (
                  <TableRow key={s.id}>
                    <TableCell className="text-xs text-muted-foreground tabular-nums whitespace-nowrap">
                      {new Date(s.created_at).toLocaleTimeString()}
                    </TableCell>
                    <TableCell className="font-mono text-xs">{s.method} {s.route}</TableCell>
                    <TableCell className="text-right tabular-nums font-medium">{s.duration_ms}ms</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-medium">Alert thresholds</h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 max-w-3xl">
          <ThresholdInput
            label="Error rate alert (%)"
            value={thresholds.errorRatePct}
            onChange={(n) => setThresholds((t) => ({ ...t, errorRatePct: n }))}
          />
          <ThresholdInput
            label="p95 latency alert (ms)"
            value={thresholds.p95Ms}
            onChange={(n) => setThresholds((t) => ({ ...t, p95Ms: n }))}
          />
          <ThresholdInput
            label="Slow call threshold (ms)"
            value={thresholds.slowCallMs}
            onChange={(n) => setThresholds((t) => ({ ...t, slowCallMs: n }))}
          />
        </div>
        <p className="text-xs text-muted-foreground">
          Saved locally. Drill into individual requests on the <Link to="/api-logs" className="underline">API logs</Link> page.
        </p>
      </section>
    </div>
  );
};

const Metric = ({
  label, value, sub, tone,
}: { label: string; value: string | number; sub?: string; tone?: "ok" | "bad" }) => (
  <div className={`border rounded-md p-4 ${tone === "bad" ? "border-destructive/50 bg-destructive/5" : "border-border"}`}>
    <div className="text-xs text-muted-foreground uppercase tracking-wide">{label}</div>
    <div className="text-2xl font-semibold tabular-nums mt-1">{value}</div>
    {sub && <div className="text-xs text-muted-foreground mt-1">{sub}</div>}
  </div>
);

const ThresholdInput = ({
  label, value, onChange,
}: { label: string; value: number; onChange: (n: number) => void }) => (
  <label className="space-y-1 block">
    <span className="text-xs text-muted-foreground">{label}</span>
    <Input
      type="number"
      min={0}
      value={value}
      onChange={(e) => onChange(Number(e.target.value) || 0)}
    />
  </label>
);

export default Status;
