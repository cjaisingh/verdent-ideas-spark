import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
  CartesianGrid,
} from "recharts";

type RegistryStatus = {
  id: string;
  surface_kind: string;
  surface_id: string;
  expected_cadence_minutes: number | null;
  stale_multiplier: number;
  last_seen_at: string | null;
  status: "ok" | "stale" | "missing-watcher" | "unknown";
};

type ResolverRow = {
  day: string;
  total: number;
  auto_bind_rate: number;
  conflict_rate: number;
  p50_latency_ms: number;
  p95_latency_ms: number;
};

const DAYS = 14;

function dayKeys(n: number): string[] {
  const out: string[] = [];
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(today);
    d.setUTCDate(today.getUTCDate() - i);
    out.push(d.toISOString().slice(0, 10));
  }
  return out;
}

function statusBadge(s: RegistryStatus["status"]) {
  const variants: Record<string, "default" | "destructive" | "secondary" | "outline"> = {
    ok: "default",
    stale: "destructive",
    "missing-watcher": "destructive",
    unknown: "secondary",
  };
  return <Badge variant={variants[s]}>{s}</Badge>;
}

function cellClass(runs: number, stale: boolean): string {
  if (stale) return "bg-destructive/30 text-destructive-foreground";
  if (runs === 0) return "bg-muted text-muted-foreground";
  if (runs >= 24) return "bg-primary/80 text-primary-foreground";
  if (runs >= 4) return "bg-primary/50";
  return "bg-primary/20";
}

export default function AdminFreshnessDashboard() {
  const [registry, setRegistry] = useState<RegistryStatus[]>([]);
  const [cronRuns, setCronRuns] = useState<Record<string, Record<string, number>>>({});
  const [bootstrap, setBootstrap] = useState<Record<string, number>>({});
  const [resolver, setResolver] = useState<ResolverRow[]>([]);
  const [loading, setLoading] = useState(true);

  const days = useMemo(() => dayKeys(DAYS), []);

  useEffect(() => {
    (async () => {
      const since = new Date();
      since.setUTCDate(since.getUTCDate() - DAYS);
      const sinceIso = since.toISOString();

      const [reg, runs, edge, res] = await Promise.all([
        supabase
          .from("v_observability_registry_status")
          .select("id, surface_kind, surface_id, expected_cadence_minutes, stale_multiplier, last_seen_at, status")
          .order("surface_kind")
          .order("surface_id"),
        supabase
          .from("automation_runs")
          .select("job, created_at")
          .gte("created_at", sinceIso)
          .limit(50000),
        supabase
          .from("edge_request_logs")
          .select("function_name, created_at")
          .eq("function_name", "session-bootstrap")
          .gte("created_at", sinceIso)
          .limit(10000),
        supabase
          .from("v_resolver_decisions")
          .select("day, total, auto_bind_rate, conflict_rate, p50_latency_ms, p95_latency_ms")
          .gte("day", since.toISOString().slice(0, 10))
          .order("day"),
      ]);

      setRegistry((reg.data ?? []) as RegistryStatus[]);

      const byJob: Record<string, Record<string, number>> = {};
      for (const r of runs.data ?? []) {
        const day = (r as { created_at: string }).created_at.slice(0, 10);
        const job = (r as { job: string }).job;
        byJob[job] ??= {};
        byJob[job][day] = (byJob[job][day] ?? 0) + 1;
      }
      setCronRuns(byJob);

      const bb: Record<string, number> = {};
      for (const r of edge.data ?? []) {
        const day = (r as { created_at: string }).created_at.slice(0, 10);
        bb[day] = (bb[day] ?? 0) + 1;
      }
      setBootstrap(bb);

      // Roll up resolver across tenants for trend chart
      const byDay: Record<string, { total: number; auto: number; conflict: number; p50: number; p95: number; n: number }> = {};
      for (const r of (res.data ?? []) as ResolverRow[]) {
        const k = r.day;
        const slot = byDay[k] ??= { total: 0, auto: 0, conflict: 0, p50: 0, p95: 0, n: 0 };
        slot.total += r.total;
        slot.auto += Number(r.auto_bind_rate) * r.total;
        slot.conflict += Number(r.conflict_rate) * r.total;
        slot.p50 += r.p50_latency_ms;
        slot.p95 += r.p95_latency_ms;
        slot.n += 1;
      }
      const rolled: ResolverRow[] = Object.entries(byDay).map(([day, s]) => ({
        day,
        total: s.total,
        auto_bind_rate: s.total ? +(s.auto / s.total).toFixed(3) : 0,
        conflict_rate: s.total ? +(s.conflict / s.total).toFixed(3) : 0,
        p50_latency_ms: s.n ? Math.round(s.p50 / s.n) : 0,
        p95_latency_ms: s.n ? Math.round(s.p95 / s.n) : 0,
      }));
      setResolver(rolled);

      setLoading(false);
    })();
  }, []);

  const crons = useMemo(
    () => registry.filter((r) => r.surface_kind === "cron"),
    [registry],
  );
  const bootstrapRow = useMemo(
    () => registry.find((r) => r.surface_id === "session-bootstrap"),
    [registry],
  );

  const summary = useMemo(() => {
    const ok = registry.filter((r) => r.status === "ok").length;
    const stale = registry.filter((r) => r.status === "stale").length;
    const missing = registry.filter((r) => r.status === "missing-watcher").length;
    const unknown = registry.filter((r) => r.status === "unknown").length;
    return { ok, stale, missing, unknown, total: registry.length };
  }, [registry]);

  const bootstrapSeries = useMemo(
    () => days.map((d) => ({ day: d.slice(5), requests: bootstrap[d] ?? 0 })),
    [days, bootstrap],
  );

  return (
    <div className="container mx-auto p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Freshness Dashboard</h1>
        <p className="text-muted-foreground text-sm">
          Cron + session-bootstrap activity over the last {DAYS} days, stale/unknown classifications
          from <code>v_observability_registry_status</code>, and resolver-decision trends from{" "}
          <code>v_resolver_decisions</code>.
        </p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <Card><CardContent className="p-4"><div className="text-xs text-muted-foreground">Total surfaces</div><div className="text-2xl font-semibold">{summary.total}</div></CardContent></Card>
        <Card><CardContent className="p-4"><div className="text-xs text-muted-foreground">OK</div><div className="text-2xl font-semibold text-primary">{summary.ok}</div></CardContent></Card>
        <Card><CardContent className="p-4"><div className="text-xs text-muted-foreground">Stale</div><div className="text-2xl font-semibold text-destructive">{summary.stale}</div></CardContent></Card>
        <Card><CardContent className="p-4"><div className="text-xs text-muted-foreground">Missing watcher</div><div className="text-2xl font-semibold text-destructive">{summary.missing}</div></CardContent></Card>
        <Card><CardContent className="p-4"><div className="text-xs text-muted-foreground">Unknown</div><div className="text-2xl font-semibold text-muted-foreground">{summary.unknown}</div></CardContent></Card>
      </div>

      {bootstrapRow && (
        <Card>
          <CardHeader>
            <CardTitle>session-bootstrap freshness</CardTitle>
            <CardDescription>
              edge_fn surface. Current status: {statusBadge(bootstrapRow.status)}{" "}
              {bootstrapRow.last_seen_at
                ? `· last seen ${new Date(bootstrapRow.last_seen_at).toISOString().slice(0, 16).replace("T", " ")}Z`
                : "· never seen in window"}
              {" "}· threshold {bootstrapRow.expected_cadence_minutes}m × {bootstrapRow.stale_multiplier}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {loading ? (
              <Skeleton className="h-48 w-full" />
            ) : (
              <ResponsiveContainer width="100%" height={180}>
                <LineChart data={bootstrapSeries}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="day" />
                  <YAxis allowDecimals={false} />
                  <Tooltip />
                  <Line type="monotone" dataKey="requests" stroke="hsl(var(--primary))" strokeWidth={2} dot={false} />
                </LineChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Cron freshness — last {DAYS} days</CardTitle>
          <CardDescription>
            Run counts per day from <code>automation_runs.job</code>. Red rows are currently classified
            stale/missing-watcher; grey columns mean zero runs that day.
          </CardDescription>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          {loading ? (
            <Skeleton className="h-72 w-full" />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="sticky left-0 bg-background">Surface</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Cadence (min)</TableHead>
                  <TableHead>×</TableHead>
                  {days.map((d) => (
                    <TableHead key={d} className="text-center text-xs">{d.slice(5)}</TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {crons.map((r) => {
                  const isStale = r.status === "stale" || r.status === "missing-watcher";
                  return (
                    <TableRow key={r.id}>
                      <TableCell className="sticky left-0 bg-background font-mono text-xs">{r.surface_id}</TableCell>
                      <TableCell>{statusBadge(r.status)}</TableCell>
                      <TableCell className="text-xs">{r.expected_cadence_minutes ?? "—"}</TableCell>
                      <TableCell className="text-xs">{r.stale_multiplier}</TableCell>
                      {days.map((d) => {
                        const n = cronRuns[r.surface_id]?.[d] ?? 0;
                        return (
                          <TableCell
                            key={d}
                            className={`text-center text-xs ${cellClass(n, isStale && n === 0)}`}
                            title={`${r.surface_id} · ${d} · ${n} runs`}
                          >
                            {n || ""}
                          </TableCell>
                        );
                      })}
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Resolver decisions trend</CardTitle>
          <CardDescription>
            Rolled across tenants from <code>v_resolver_decisions</code>. Auto-bind / conflict are
            volume-weighted rates; latencies are mean of per-tenant p50/p95.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid md:grid-cols-2 gap-6">
          {loading ? (
            <>
              <Skeleton className="h-64 w-full" />
              <Skeleton className="h-64 w-full" />
            </>
          ) : resolver.length === 0 ? (
            <div className="col-span-2 text-sm text-muted-foreground p-4">
              No resolver decisions logged in the last {DAYS} days.
            </div>
          ) : (
            <>
              <div>
                <div className="text-sm font-medium mb-2">Outcome rates</div>
                <ResponsiveContainer width="100%" height={220}>
                  <LineChart data={resolver}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="day" tickFormatter={(d) => String(d).slice(5)} />
                    <YAxis domain={[0, 1]} />
                    <Tooltip />
                    <Legend />
                    <Line type="monotone" dataKey="auto_bind_rate" stroke="hsl(var(--primary))" dot={false} />
                    <Line type="monotone" dataKey="conflict_rate" stroke="hsl(var(--destructive))" dot={false} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
              <div>
                <div className="text-sm font-medium mb-2">Latency (ms)</div>
                <ResponsiveContainer width="100%" height={220}>
                  <LineChart data={resolver}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="day" tickFormatter={(d) => String(d).slice(5)} />
                    <YAxis />
                    <Tooltip />
                    <Legend />
                    <Line type="monotone" dataKey="p50_latency_ms" stroke="hsl(var(--primary))" dot={false} />
                    <Line type="monotone" dataKey="p95_latency_ms" stroke="hsl(var(--destructive))" dot={false} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
