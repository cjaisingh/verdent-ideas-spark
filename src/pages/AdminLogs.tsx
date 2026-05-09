// /admin/logs — operator view of edge_request_logs and frontend_error_logs.
// KPI strip + filterable table per source. Read-only; access enforced by RLS.

import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { RefreshCw } from "lucide-react";

type EdgeRow = {
  id: string;
  request_id: string | null;
  function_name: string;
  method: string | null;
  path: string | null;
  status: number | null;
  latency_ms: number | null;
  classified_error: string | null;
  error_message: string | null;
  user_id_hash: string | null;
  created_at: string;
};

type FrontRow = {
  id: string;
  request_id: string | null;
  url: string | null;
  message: string;
  source: string | null;
  kind: string | null;
  user_agent: string | null;
  user_id_hash: string | null;
  created_at: string;
};

const WINDOWS = [
  { id: "1h", label: "1h", hours: 1 },
  { id: "24h", label: "24h", hours: 24 },
  { id: "7d", label: "7d", hours: 24 * 7 },
  { id: "30d", label: "30d", hours: 24 * 30 },
];

function timeAgo(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
}

function statusVariant(s: number | null): "default" | "secondary" | "destructive" | "outline" {
  if (s == null) return "outline";
  if (s >= 500) return "destructive";
  if (s >= 400) return "secondary";
  return "default";
}

export default function AdminLogs() {
  const [windowId, setWindowId] = useState("24h");
  const [edgeRows, setEdgeRows] = useState<EdgeRow[]>([]);
  const [frontRows, setFrontRows] = useState<FrontRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [fnFilter, setFnFilter] = useState<string>("__all__");
  const [errFilter, setErrFilter] = useState<string>("__all__");
  const [search, setSearch] = useState("");

  const since = useMemo(() => {
    const w = WINDOWS.find((x) => x.id === windowId) ?? WINDOWS[1];
    return new Date(Date.now() - w.hours * 60 * 60 * 1000).toISOString();
  }, [windowId]);

  const load = async () => {
    setLoading(true);
    const [edge, front] = await Promise.all([
      supabase
        .from("edge_request_logs")
        .select("id, request_id, function_name, method, path, status, latency_ms, classified_error, error_message, user_id_hash, created_at")
        .gte("created_at", since)
        .order("created_at", { ascending: false })
        .limit(500),
      supabase
        .from("frontend_error_logs")
        .select("id, request_id, url, message, source, kind, user_agent, user_id_hash, created_at")
        .gte("created_at", since)
        .order("created_at", { ascending: false })
        .limit(500),
    ]);
    setEdgeRows((edge.data ?? []) as EdgeRow[]);
    setFrontRows((front.data ?? []) as FrontRow[]);
    setLoading(false);
  };

  useEffect(() => { load(); /* eslint-disable-next-line */ }, [since]);

  const fnOptions = useMemo(
    () => Array.from(new Set(edgeRows.map((r) => r.function_name))).sort(),
    [edgeRows],
  );
  const errOptions = useMemo(
    () => Array.from(new Set(edgeRows.map((r) => r.classified_error).filter(Boolean) as string[])).sort(),
    [edgeRows],
  );

  const filteredEdge = useMemo(() => {
    return edgeRows.filter((r) => {
      if (fnFilter !== "__all__" && r.function_name !== fnFilter) return false;
      if (errFilter !== "__all__" && r.classified_error !== errFilter) return false;
      if (search) {
        const s = search.toLowerCase();
        if (!(
          (r.request_id ?? "").toLowerCase().includes(s) ||
          (r.path ?? "").toLowerCase().includes(s) ||
          (r.error_message ?? "").toLowerCase().includes(s)
        )) return false;
      }
      return true;
    });
  }, [edgeRows, fnFilter, errFilter, search]);

  const filteredFront = useMemo(() => {
    if (!search) return frontRows;
    const s = search.toLowerCase();
    return frontRows.filter((r) =>
      (r.message ?? "").toLowerCase().includes(s) ||
      (r.url ?? "").toLowerCase().includes(s) ||
      (r.request_id ?? "").toLowerCase().includes(s),
    );
  }, [frontRows, search]);

  // KPIs from raw window (not user filters)
  const kpis = useMemo(() => {
    const total = edgeRows.length;
    const errors = edgeRows.filter((r) => (r.status ?? 0) >= 400).length;
    const errorRate = total ? Math.round((errors / total) * 1000) / 10 : 0;
    const latencies = edgeRows.map((r) => r.latency_ms).filter((v): v is number => typeof v === "number").sort((a, b) => a - b);
    const p95 = latencies.length ? latencies[Math.floor(latencies.length * 0.95)] : 0;
    return {
      total,
      errors,
      errorRate,
      p95,
      frontendErrors: frontRows.length,
    };
  }, [edgeRows, frontRows]);

  return (
    <div className="container max-w-7xl mx-auto py-8 space-y-6">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-3xl font-bold">Logs</h1>
          <p className="text-sm text-muted-foreground">
            Edge requests + browser errors. 30-day retention enforced by nightly sweep.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Tabs value={windowId} onValueChange={setWindowId}>
            <TabsList>
              {WINDOWS.map((w) => (
                <TabsTrigger key={w.id} value={w.id}>{w.label}</TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
          <Button variant="outline" size="sm" onClick={load} disabled={loading}>
            <RefreshCw className={`h-4 w-4 mr-2 ${loading ? "animate-spin" : ""}`} />
            Refresh
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
        <KpiCard label="Edge requests" value={kpis.total.toLocaleString()} loading={loading} />
        <KpiCard label="Errors (4xx/5xx)" value={kpis.errors.toLocaleString()} loading={loading} />
        <KpiCard label="Error rate" value={`${kpis.errorRate}%`} loading={loading} tone={kpis.errorRate > 5 ? "warn" : undefined} />
        <KpiCard label="Latency p95" value={`${kpis.p95}ms`} loading={loading} />
        <KpiCard label="Frontend errors" value={kpis.frontendErrors.toLocaleString()} loading={loading} tone={kpis.frontendErrors > 0 ? "warn" : undefined} />
      </div>

      <Tabs defaultValue="edge">
        <TabsList>
          <TabsTrigger value="edge">Edge requests ({filteredEdge.length})</TabsTrigger>
          <TabsTrigger value="frontend">Frontend errors ({filteredFront.length})</TabsTrigger>
        </TabsList>

        <TabsContent value="edge" className="space-y-4">
          <Card>
            <CardHeader className="pb-3">
              <div className="flex flex-wrap gap-2 items-center">
                <Select value={fnFilter} onValueChange={setFnFilter}>
                  <SelectTrigger className="w-[200px]"><SelectValue placeholder="Function" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__all__">All functions</SelectItem>
                    {fnOptions.map((f) => <SelectItem key={f} value={f}>{f}</SelectItem>)}
                  </SelectContent>
                </Select>
                <Select value={errFilter} onValueChange={setErrFilter}>
                  <SelectTrigger className="w-[180px]"><SelectValue placeholder="Error class" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__all__">All errors</SelectItem>
                    {errOptions.map((e) => <SelectItem key={e} value={e}>{e}</SelectItem>)}
                  </SelectContent>
                </Select>
                <Input
                  placeholder="Search request_id / path / message"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="w-[280px]"
                />
              </div>
            </CardHeader>
            <CardContent className="p-0">
              {loading ? (
                <div className="p-4 space-y-2">{[...Array(8)].map((_, i) => <Skeleton key={i} className="h-8" />)}</div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-[80px]">Age</TableHead>
                      <TableHead>Function</TableHead>
                      <TableHead className="w-[80px]">Method</TableHead>
                      <TableHead className="w-[80px]">Status</TableHead>
                      <TableHead className="w-[100px]">Latency</TableHead>
                      <TableHead>Path</TableHead>
                      <TableHead>Error</TableHead>
                      <TableHead className="w-[140px]">Request ID</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredEdge.length === 0 && (
                      <TableRow><TableCell colSpan={8} className="text-center text-muted-foreground py-8">No edge requests in this window.</TableCell></TableRow>
                    )}
                    {filteredEdge.map((r) => (
                      <TableRow key={r.id}>
                        <TableCell className="text-xs text-muted-foreground">{timeAgo(r.created_at)}</TableCell>
                        <TableCell className="font-mono text-xs">{r.function_name}</TableCell>
                        <TableCell className="text-xs">{r.method ?? "-"}</TableCell>
                        <TableCell><Badge variant={statusVariant(r.status)}>{r.status ?? "-"}</Badge></TableCell>
                        <TableCell className="text-xs">{r.latency_ms != null ? `${r.latency_ms}ms` : "-"}</TableCell>
                        <TableCell className="font-mono text-xs max-w-[300px] truncate">{r.path ?? "-"}</TableCell>
                        <TableCell className="text-xs">
                          {r.classified_error && <Badge variant="outline" className="mr-1">{r.classified_error}</Badge>}
                          <span className="text-muted-foreground">{r.error_message?.slice(0, 80)}</span>
                        </TableCell>
                        <TableCell className="font-mono text-xs">{r.request_id?.slice(0, 12) ?? "-"}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="frontend" className="space-y-4">
          <Card>
            <CardHeader className="pb-3">
              <Input
                placeholder="Search message / url / request_id"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="w-[320px]"
              />
            </CardHeader>
            <CardContent className="p-0">
              {loading ? (
                <div className="p-4 space-y-2">{[...Array(8)].map((_, i) => <Skeleton key={i} className="h-8" />)}</div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-[80px]">Age</TableHead>
                      <TableHead className="w-[80px]">Kind</TableHead>
                      <TableHead>Message</TableHead>
                      <TableHead>URL</TableHead>
                      <TableHead>Source</TableHead>
                      <TableHead className="w-[140px]">Request ID</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredFront.length === 0 && (
                      <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground py-8">No frontend errors in this window.</TableCell></TableRow>
                    )}
                    {filteredFront.map((r) => (
                      <TableRow key={r.id}>
                        <TableCell className="text-xs text-muted-foreground">{timeAgo(r.created_at)}</TableCell>
                        <TableCell><Badge variant="outline">{r.kind ?? "error"}</Badge></TableCell>
                        <TableCell className="text-xs max-w-[400px] truncate">{r.message}</TableCell>
                        <TableCell className="font-mono text-xs max-w-[260px] truncate">{r.url ?? "-"}</TableCell>
                        <TableCell className="font-mono text-xs max-w-[200px] truncate">{r.source ?? "-"}</TableCell>
                        <TableCell className="font-mono text-xs">{r.request_id?.slice(0, 12) ?? "-"}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}

function KpiCard({ label, value, loading, tone }: { label: string; value: string; loading: boolean; tone?: "warn" }) {
  return (
    <Card>
      <CardHeader className="pb-2"><CardTitle className="text-xs font-medium text-muted-foreground">{label}</CardTitle></CardHeader>
      <CardContent>
        {loading ? <Skeleton className="h-7 w-20" /> : (
          <div className={`text-2xl font-bold ${tone === "warn" ? "text-destructive" : ""}`}>{value}</div>
        )}
      </CardContent>
    </Card>
  );
}
