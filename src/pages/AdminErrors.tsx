// /admin/errors — unified feed of client-side + server-side errors with stack traces.
// Sources:
//   - frontend_error_logs   (browser ErrorBoundary / window.onerror)
//   - client_error_log      (browser network/transport failures via client-error-beacon)
//   - edge_request_logs     (server edge-function failures; status >= 400)
// Read-only; access enforced by operator/admin RLS on each table.

import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { ChevronRight, RefreshCw, AlertTriangle, Globe, Server, Wifi } from "lucide-react";

type Source = "frontend" | "transport" | "edge";

type UnifiedError = {
  id: string;
  source: Source;
  created_at: string;
  message: string;
  stack: string | null;
  context: { label: string; value: string }[];
  status: number | null;
  meta: Record<string, unknown>;
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
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

function fmtTs(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    month: "short", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit",
  });
}

function sourceIcon(s: Source) {
  if (s === "frontend") return <Globe className="h-3.5 w-3.5" />;
  if (s === "transport") return <Wifi className="h-3.5 w-3.5" />;
  return <Server className="h-3.5 w-3.5" />;
}

function sourceBadge(s: Source) {
  const map: Record<Source, { label: string; cls: string }> = {
    frontend: { label: "Frontend", cls: "bg-blue-500/10 text-blue-600 border-blue-500/30" },
    transport: { label: "Transport", cls: "bg-amber-500/10 text-amber-600 border-amber-500/30" },
    edge: { label: "Edge", cls: "bg-rose-500/10 text-rose-600 border-rose-500/30" },
  };
  return (
    <Badge variant="outline" className={`gap-1 ${map[s].cls}`}>
      {sourceIcon(s)} {map[s].label}
    </Badge>
  );
}

export default function AdminErrors() {
  const [windowId, setWindowId] = useState("24h");
  const [rows, setRows] = useState<UnifiedError[]>([]);
  const [loading, setLoading] = useState(true);
  const [sourceFilter, setSourceFilter] = useState<Source | "all">("all");
  const [search, setSearch] = useState("");
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    const hours = WINDOWS.find((w) => w.id === windowId)?.hours ?? 24;
    const since = new Date(Date.now() - hours * 3600_000).toISOString();
    let alive = true;

    (async () => {
      setLoading(true);
      const [frontend, transport, edge] = await Promise.all([
        supabase.from("frontend_error_logs")
          .select("id,created_at,message,stack,source,kind,url,user_agent,request_id,user_id_hash,lineno,colno,meta")
          .gte("created_at", since).order("created_at", { ascending: false }).limit(500),
        supabase.from("client_error_log")
          .select("id,created_at,message,function_name,url,request_id,user_agent,user_id_hash,meta")
          .gte("created_at", since).order("created_at", { ascending: false }).limit(500),
        supabase.from("edge_request_logs")
          .select("id,created_at,function_name,method,path,status,latency_ms,classified_error,error_message,request_id,user_id_hash,meta")
          .gte("created_at", since).gte("status", 400)
          .order("created_at", { ascending: false }).limit(500),
      ]);

      if (!alive) return;

      const unified: UnifiedError[] = [];
      for (const r of (frontend.data ?? []) as any[]) {
        unified.push({
          id: `f:${r.id}`,
          source: "frontend",
          created_at: r.created_at,
          message: r.message,
          stack: r.stack ?? null,
          status: null,
          meta: r.meta ?? {},
          context: [
            r.kind && { label: "kind", value: r.kind },
            r.source && { label: "source", value: `${r.source}${r.lineno ? `:${r.lineno}` : ""}${r.colno ? `:${r.colno}` : ""}` },
            r.url && { label: "url", value: r.url },
            r.request_id && { label: "request_id", value: r.request_id },
            r.user_id_hash && { label: "user", value: r.user_id_hash },
          ].filter(Boolean) as { label: string; value: string }[],
        });
      }
      for (const r of (transport.data ?? []) as any[]) {
        unified.push({
          id: `t:${r.id}`,
          source: "transport",
          created_at: r.created_at,
          message: r.message,
          stack: null,
          status: null,
          meta: r.meta ?? {},
          context: [
            r.function_name && { label: "function", value: r.function_name },
            r.url && { label: "url", value: r.url },
            r.request_id && { label: "request_id", value: r.request_id },
            r.user_id_hash && { label: "user", value: r.user_id_hash },
          ].filter(Boolean) as { label: string; value: string }[],
        });
      }
      for (const r of (edge.data ?? []) as any[]) {
        unified.push({
          id: `e:${r.id}`,
          source: "edge",
          created_at: r.created_at,
          message: r.error_message || r.classified_error || `${r.method ?? ""} ${r.path ?? ""} → ${r.status}`,
          stack: null,
          status: r.status ?? null,
          meta: r.meta ?? {},
          context: [
            r.function_name && { label: "function", value: r.function_name },
            r.classified_error && { label: "classified", value: r.classified_error },
            (r.method || r.path) && { label: "route", value: `${r.method ?? ""} ${r.path ?? ""}`.trim() },
            r.status != null && { label: "status", value: String(r.status) },
            r.latency_ms != null && { label: "latency", value: `${r.latency_ms}ms` },
            r.request_id && { label: "request_id", value: r.request_id },
          ].filter(Boolean) as { label: string; value: string }[],
        });
      }

      unified.sort((a, b) => +new Date(b.created_at) - +new Date(a.created_at));
      setRows(unified);
      setLoading(false);
    })();

    return () => { alive = false; };
  }, [windowId, reloadKey]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((r) => {
      if (sourceFilter !== "all" && r.source !== sourceFilter) return false;
      if (!q) return true;
      if (r.message.toLowerCase().includes(q)) return true;
      if (r.stack && r.stack.toLowerCase().includes(q)) return true;
      return r.context.some((c) => c.value.toLowerCase().includes(q));
    });
  }, [rows, sourceFilter, search]);

  const counts = useMemo(() => {
    const c = { frontend: 0, transport: 0, edge: 0 };
    for (const r of rows) c[r.source]++;
    return c;
  }, [rows]);

  return (
    <div className="space-y-6 p-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-semibold flex items-center gap-2">
            <AlertTriangle className="h-6 w-6 text-amber-500" /> Error Console
          </h1>
          <p className="text-sm text-muted-foreground">
            Unified timeline of client-side (browser) and server-side (edge function) errors with stack traces.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Select value={windowId} onValueChange={setWindowId}>
            <SelectTrigger className="w-[100px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              {WINDOWS.map((w) => <SelectItem key={w.id} value={w.id}>{w.label}</SelectItem>)}
            </SelectContent>
          </Select>
          <Button variant="outline" size="icon" onClick={() => setReloadKey((k) => k + 1)} title="Refresh">
            <RefreshCw className="h-4 w-4" />
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-xs uppercase text-muted-foreground">Total</CardTitle></CardHeader>
          <CardContent className="text-2xl font-bold">{rows.length}</CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-xs uppercase text-muted-foreground">Frontend</CardTitle></CardHeader>
          <CardContent className="text-2xl font-bold text-blue-600">{counts.frontend}</CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-xs uppercase text-muted-foreground">Transport</CardTitle></CardHeader>
          <CardContent className="text-2xl font-bold text-amber-600">{counts.transport}</CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-xs uppercase text-muted-foreground">Edge ≥400</CardTitle></CardHeader>
          <CardContent className="text-2xl font-bold text-rose-600">{counts.edge}</CardContent>
        </Card>
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        <Select value={sourceFilter} onValueChange={(v) => setSourceFilter(v as Source | "all")}>
          <SelectTrigger className="w-[160px]"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All sources</SelectItem>
            <SelectItem value="frontend">Frontend</SelectItem>
            <SelectItem value="transport">Transport</SelectItem>
            <SelectItem value="edge">Edge</SelectItem>
          </SelectContent>
        </Select>
        <Input
          placeholder="Search message, stack, request_id…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="max-w-md"
        />
        <span className="text-xs text-muted-foreground ml-auto">
          {loading ? "loading…" : `${filtered.length} / ${rows.length} shown`}
        </span>
      </div>

      <Card>
        <CardContent className="p-0">
          {loading ? (
            <div className="p-4 space-y-2">
              {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-12 w-full" />)}
            </div>
          ) : filtered.length === 0 ? (
            <div className="p-10 text-center text-sm text-muted-foreground">
              No errors in this window. 🎉
            </div>
          ) : (
            <div className="divide-y">
              {filtered.map((r) => {
                const isOpen = !!expanded[r.id];
                return (
                  <Collapsible
                    key={r.id}
                    open={isOpen}
                    onOpenChange={(o) => setExpanded((s) => ({ ...s, [r.id]: o }))}
                  >
                    <CollapsibleTrigger className="w-full text-left hover:bg-muted/50 transition-colors">
                      <div className="px-4 py-3 flex items-start gap-3">
                        <ChevronRight className={`h-4 w-4 mt-1 shrink-0 transition-transform ${isOpen ? "rotate-90" : ""}`} />
                        <div className="shrink-0 mt-0.5">{sourceBadge(r.source)}</div>
                        <div className="flex-1 min-w-0">
                          <div className="font-mono text-sm break-words line-clamp-2">{r.message}</div>
                          <div className="text-xs text-muted-foreground flex flex-wrap gap-x-3 gap-y-0.5 mt-1">
                            <span title={fmtTs(r.created_at)}>{timeAgo(r.created_at)} · {fmtTs(r.created_at)}</span>
                            {r.context.slice(0, 3).map((c) => (
                              <span key={c.label}><span className="opacity-60">{c.label}:</span> {c.value}</span>
                            ))}
                          </div>
                        </div>
                      </div>
                    </CollapsibleTrigger>
                    <CollapsibleContent>
                      <div className="px-4 pb-4 pl-11 space-y-3">
                        {r.context.length > 0 && (
                          <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-1 text-xs">
                            {r.context.map((c) => (
                              <div key={c.label} className="break-all">
                                <span className="text-muted-foreground">{c.label}: </span>
                                <span className="font-mono">{c.value}</span>
                              </div>
                            ))}
                          </div>
                        )}
                        {r.stack ? (
                          <div>
                            <div className="text-xs font-semibold text-muted-foreground mb-1">Stack trace</div>
                            <pre className="text-xs bg-muted rounded p-3 overflow-x-auto whitespace-pre-wrap break-words max-h-96">
{r.stack}
                            </pre>
                          </div>
                        ) : (
                          <div className="text-xs text-muted-foreground italic">No stack trace captured.</div>
                        )}
                        {r.meta && Object.keys(r.meta).length > 0 && (
                          <div>
                            <div className="text-xs font-semibold text-muted-foreground mb-1">Meta</div>
                            <pre className="text-xs bg-muted rounded p-3 overflow-x-auto whitespace-pre-wrap break-words max-h-64">
{JSON.stringify(r.meta, null, 2)}
                            </pre>
                          </div>
                        )}
                      </div>
                    </CollapsibleContent>
                  </Collapsible>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
