import { Fragment, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Link2 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ShieldAlert, RefreshCw } from "lucide-react";
import { toast } from "sonner";

type AuditRow = {
  id: string;
  created_at: string;
  request_id: string;
  user_id: string | null;
  action: string | null;
  table: string | null;
  limit: number | null;
  offset: number | null;
  status: number;
  result_count: number | null;
  duration_ms: number | null;
  error_code: string | null;
  rejected: boolean;
  rejection_reason: string | null;
  requested: unknown;
};

const PAGE_SIZE = 100;
const STATUS_BUCKETS = ["any", "2xx", "4xx", "5xx", "429"] as const;

export default function DbAuditLogs() {
  const [rows, setRows] = useState<AuditRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [actionF, setActionF] = useState("any");
  const [tableF, setTableF] = useState("");
  const [statusF, setStatusF] = useState<(typeof STATUS_BUCKETS)[number]>("any");
  const [reqIdF, setReqIdF] = useState("");
  const [rejectedOnly, setRejectedOnly] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);

  // Build a query with the current filters applied. Cursor is keyset on
  // (created_at, id) so we keep stable ordering even across millisecond ties.
  const buildQuery = (cursor?: { created_at: string; id: string }) => {
    let q = supabase
      .from("db_explorer_audit")
      .select("*")
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .limit(PAGE_SIZE);

    if (actionF !== "any") q = q.eq("action", actionF);
    if (tableF.trim()) q = q.ilike("table", `%${tableF.trim()}%`);
    if (reqIdF.trim()) q = q.ilike("request_id", `%${reqIdF.trim()}%`);
    if (rejectedOnly) q = q.eq("rejected", true);
    if (statusF === "2xx") q = q.gte("status", 200).lt("status", 300);
    else if (statusF === "4xx") q = q.gte("status", 400).lt("status", 500);
    else if (statusF === "5xx") q = q.gte("status", 500).lt("status", 600);
    else if (statusF === "429") q = q.eq("status", 429);

    if (cursor) {
      // Strict keyset: rows older than cursor, OR same timestamp with smaller id.
      q = q.or(
        `created_at.lt.${cursor.created_at},and(created_at.eq.${cursor.created_at},id.lt.${cursor.id})`
      );
    }
    return q;
  };

  const load = async () => {
    setLoading(true);
    const { data, error } = await buildQuery();
    setLoading(false);
    if (error) { toast.error(error.message); return; }
    const list = (data ?? []) as AuditRow[];
    setRows(list);
    setHasMore(list.length === PAGE_SIZE);
  };

  const loadMore = async () => {
    const last = rows[rows.length - 1];
    if (!last) return;
    setLoadingMore(true);
    const { data, error } = await buildQuery({ created_at: last.created_at, id: last.id });
    setLoadingMore(false);
    if (error) { toast.error(error.message); return; }
    const list = (data ?? []) as AuditRow[];
    // Dedup just in case realtime inserted a row that overlapped.
    const seen = new Set(rows.map((r) => r.id));
    const fresh = list.filter((r) => !seen.has(r.id));
    setRows((prev) => [...prev, ...fresh]);
    setHasMore(list.length === PAGE_SIZE);
  };

  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  // Realtime tail — only prepend when viewing the freshest page (no scrolling
  // back through history, otherwise it'd be jarring).
  useEffect(() => {
    const ch = supabase
      .channel("db_explorer_audit_stream")
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "db_explorer_audit" }, (p) => {
        setRows((prev) => {
          if (prev.some((r) => r.id === (p.new as AuditRow).id)) return prev;
          return [p.new as AuditRow, ...prev];
        });
      })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, []);

  const actions = useMemo(() => {
    const set = new Set<string>();
    for (const r of rows) if (r.action) set.add(r.action);
    return ["any", ...Array.from(set).sort()];
  }, [rows]);

  const statusVariant = (s: number): "default" | "secondary" | "destructive" | "outline" =>
    s >= 500 ? "destructive" : s === 429 ? "destructive" : s >= 400 ? "secondary" : "default";

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold flex items-center gap-2">
            <ShieldAlert className="h-6 w-6" /> DB Explorer Audit Log
          </h1>
          <p className="text-sm text-muted-foreground">
            Persisted, already-redacted audit entries from the db-explorer edge function. Streams live.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={load} disabled={loading}>
          <RefreshCw className={`h-4 w-4 mr-2 ${loading ? "animate-spin" : ""}`} /> Refresh
        </Button>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm">Filters</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-1 md:grid-cols-5 gap-3">
          <Select value={actionF} onValueChange={setActionF}>
            <SelectTrigger><SelectValue placeholder="Action" /></SelectTrigger>
            <SelectContent>
              {actions.map((a) => <SelectItem key={a} value={a}>{a}</SelectItem>)}
            </SelectContent>
          </Select>
          <Input placeholder="Table contains…" value={tableF} onChange={(e) => setTableF(e.target.value)} />
          <Select value={statusF} onValueChange={(v) => setStatusF(v as typeof statusF)}>
            <SelectTrigger><SelectValue placeholder="Status" /></SelectTrigger>
            <SelectContent>
              {STATUS_BUCKETS.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
            </SelectContent>
          </Select>
          <Input placeholder="Request id contains…" value={reqIdF} onChange={(e) => setReqIdF(e.target.value)} />
          <div className="flex items-center gap-2">
            <Button size="sm" variant={rejectedOnly ? "default" : "outline"} onClick={() => setRejectedOnly((v) => !v)}>
              Rejected only
            </Button>
            <Button size="sm" onClick={load}>Apply</Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Entries ({rows.length})</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Time</TableHead>
                  <TableHead>Action</TableHead>
                  <TableHead>Table</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Rows</TableHead>
                  <TableHead>Limit/Offset</TableHead>
                  <TableHead>ms</TableHead>
                  <TableHead>Request id</TableHead>
                  <TableHead>Rejection</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => (
                  <Fragment key={r.id}>
                    <TableRow
                      className="cursor-pointer hover:bg-muted/40"
                      onClick={() => setExpanded((e) => (e === r.id ? null : r.id))}
                    >
                      <TableCell className="font-mono text-xs">
                        {new Date(r.created_at).toLocaleTimeString()}
                      </TableCell>
                      <TableCell className="text-xs">{r.action ?? "—"}</TableCell>
                      <TableCell className="text-xs">{r.table ?? "—"}</TableCell>
                      <TableCell>
                        <Badge variant={statusVariant(r.status)}>{r.status}</Badge>
                      </TableCell>
                      <TableCell className="text-xs">{r.result_count ?? "—"}</TableCell>
                      <TableCell className="text-xs">
                        {r.limit ?? "—"}/{r.offset ?? "—"}
                      </TableCell>
                      <TableCell className="text-xs">{r.duration_ms ?? "—"}</TableCell>
                      <TableCell className="font-mono text-[10px]">{r.request_id.slice(0, 8)}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {r.rejected ? (r.rejection_reason ?? r.error_code ?? "rejected") : ""}
                      </TableCell>
                    </TableRow>
                    {expanded === r.id && (
                      <TableRow>
                        <TableCell colSpan={9} className="bg-muted/30">
                          <pre className="text-xs whitespace-pre-wrap break-all">
{JSON.stringify({ user_id: r.user_id, error_code: r.error_code, requested: r.requested }, null, 2)}
                          </pre>
                        </TableCell>
                      </TableRow>
                    )}
                  </Fragment>
                ))}
                {!loading && rows.length === 0 && (
                  <TableRow><TableCell colSpan={9} className="text-center text-muted-foreground text-sm py-6">
                    No audit entries match these filters.
                  </TableCell></TableRow>
                )}
              </TableBody>
            </Table>
          </div>
          <div className="flex items-center justify-center pt-4">
            {hasMore ? (
              <Button variant="outline" size="sm" onClick={loadMore} disabled={loadingMore || loading}>
                <RefreshCw className={`h-4 w-4 mr-2 ${loadingMore ? "animate-spin" : ""}`} />
                {loadingMore ? "Loading…" : `Load more (${PAGE_SIZE})`}
              </Button>
            ) : rows.length > 0 ? (
              <span className="text-xs text-muted-foreground">End of audit log.</span>
            ) : null}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
