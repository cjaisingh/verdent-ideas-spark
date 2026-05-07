import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Database, RefreshCw, ChevronLeft, ChevronRight } from "lucide-react";
import { toast } from "sonner";

interface TableInfo { table_name: string; row_count: number; size_bytes: number }
interface ColumnInfo { column_name: string; data_type: string; is_nullable: string; column_default: string | null }
interface AllColumn { table_name: string; column_name: string; data_type: string }

const formatBytes = (b: number) => {
  if (!b) return "0 B";
  const u = ["B", "KB", "MB", "GB"];
  let i = 0; let v = b;
  while (v >= 1024 && i < u.length - 1) { v /= 1024; i++; }
  return `${v.toFixed(1)} ${u[i]}`;
};

const PAGE_SIZE = 50;

export default function DbExplorer() {
  const [tables, setTables] = useState<TableInfo[]>([]);
  const [allColumns, setAllColumns] = useState<AllColumn[]>([]);
  const [filter, setFilter] = useState("");
  const [minRows, setMinRows] = useState<string>("");
  const [colFilter, setColFilter] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [columns, setColumns] = useState<ColumnInfo[]>([]);
  const [rows, setRows] = useState<any[]>([]);
  const [page, setPage] = useState(0);
  const [loading, setLoading] = useState(false);
  const [lastRequestId, setLastRequestId] = useState<string | null>(null);

  const callExplorer = async <T,>(body: Record<string, unknown>): Promise<T | null> => {
    const requestId =
      (typeof crypto !== "undefined" && "randomUUID" in crypto)
        ? crypto.randomUUID()
        : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const { data, error } = await supabase.functions.invoke("db-explorer", {
      body,
      headers: { "x-request-id": requestId },
    });
    // Edge function echoes request_id in body and x-request-id header.
    const respId = (data && typeof data === "object" && (data as { request_id?: string }).request_id) || requestId;
    setLastRequestId(respId);
    if (error) { toast.error(`${error.message} · req ${respId.slice(0, 8)}`); return null; }
    if (data?.error) { toast.error(`${data.error} · req ${respId.slice(0, 8)}`); return null; }
    return (data?.data ?? null) as T | null;
  };

  const loadTables = async () => {
    const data = await callExplorer<TableInfo[]>({ action: "list_tables" });
    if (data) setTables(data);
  };

  const loadAllColumns = async () => {
    const data = await callExplorer<AllColumn[]>({ action: "list_all_columns" });
    if (data) setAllColumns(data);
  };

  const refreshCounts = async () => {
    setRefreshing(true);
    const data = await callExplorer<TableInfo[]>({ action: "refresh_counts" });
    if (data) { setTables(data); toast.success("Counts refreshed"); }
    setRefreshing(false);
  };

  useEffect(() => { loadTables(); loadAllColumns(); }, []);

  const loadTable = async (name: string, p = 0) => {
    setLoading(true);
    setSelected(name); setPage(p);
    const [cols, rws] = await Promise.all([
      callExplorer<ColumnInfo[]>({ action: "list_columns", table: name }),
      callExplorer<any[]>({ action: "preview_rows", table: name, limit: PAGE_SIZE, offset: p * PAGE_SIZE }),
    ]);
    setColumns(cols ?? []);
    setRows(Array.isArray(rws) ? rws : []);
    setLoading(false);
  };

  const tablesWithColumn = useMemo(() => {
    const q = colFilter.trim().toLowerCase();
    if (!q) return null;
    const set = new Set<string>();
    for (const c of allColumns) {
      if (c.column_name.toLowerCase().includes(q)) set.add(c.table_name);
    }
    return set;
  }, [allColumns, colFilter]);

  const filtered = useMemo(() => {
    const min = Number(minRows) || 0;
    const q = filter.toLowerCase();
    return tables.filter((t) => {
      if (q && !t.table_name.toLowerCase().includes(q)) return false;
      if (min > 0 && Math.max(0, t.row_count) < min) return false;
      if (tablesWithColumn && !tablesWithColumn.has(t.table_name)) return false;
      return true;
    });
  }, [tables, filter, minRows, tablesWithColumn]);

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold flex items-center gap-2">
            <Database className="h-6 w-6" /> DB Explorer
          </h1>
          <p className="text-sm text-muted-foreground">
            Read-only view of every table in the AWIP backend. Operator access only.
          </p>
          {lastRequestId && (
            <p className="text-xs text-muted-foreground font-mono mt-1">
              last request id:{" "}
              <button
                className="underline hover:text-foreground"
                onClick={() => { navigator.clipboard?.writeText(lastRequestId); toast.success("Copied request id"); }}
                title="Click to copy — use to grep audit logs"
              >
                {lastRequestId}
              </button>
            </p>
          )}
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={loadTables}>
            <RefreshCw className="h-4 w-4 mr-2" /> Reload
          </Button>
          <Button variant="default" size="sm" onClick={refreshCounts} disabled={refreshing}>
            <RefreshCw className={`h-4 w-4 mr-2 ${refreshing ? "animate-spin" : ""}`} />
            Refresh counts
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-[300px_1fr] gap-4">
        <Card>
          <CardHeader className="pb-2 space-y-2">
            <CardTitle className="text-sm">Tables ({filtered.length}/{tables.length})</CardTitle>
            <Input placeholder="Search by table name…" value={filter}
              onChange={(e) => setFilter(e.target.value)} />
            <div className="grid grid-cols-2 gap-2">
              <Input placeholder="Min rows" type="number" min={0} value={minRows}
                onChange={(e) => setMinRows(e.target.value)} />
              <Input placeholder="Has column…" value={colFilter}
                onChange={(e) => setColFilter(e.target.value)} />
            </div>
            {(filter || minRows || colFilter) && (
              <Button variant="ghost" size="sm" className="h-7 text-xs"
                onClick={() => { setFilter(""); setMinRows(""); setColFilter(""); }}>
                Clear filters
              </Button>
            )}
          </CardHeader>
          <CardContent className="p-0">
            <ScrollArea className="h-[70vh]">
              <div className="px-2 pb-2">
                {filtered.map((t) => (
                  <button
                    key={t.table_name}
                    onClick={() => loadTable(t.table_name, 0)}
                    className={`w-full text-left px-2 py-1.5 rounded text-sm hover:bg-muted flex items-center justify-between ${
                      selected === t.table_name ? "bg-muted font-medium" : ""
                    }`}
                  >
                    <span className="truncate">{t.table_name}</span>
                    <span className="text-xs text-muted-foreground ml-2">{Math.max(0, t.row_count)}</span>
                  </button>
                ))}
              </div>
            </ScrollArea>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center justify-between">
              <span>{selected ?? "Select a table"}</span>
              {selected && (
                <div className="flex items-center gap-2">
                  <Badge variant="secondary">
                    {formatBytes(tables.find((t) => t.table_name === selected)?.size_bytes ?? 0)}
                  </Badge>
                  <Button size="sm" variant="outline" disabled={page === 0 || loading}
                    onClick={() => loadTable(selected, page - 1)}>
                    <ChevronLeft className="h-4 w-4" />
                  </Button>
                  <span className="text-xs text-muted-foreground">page {page + 1}</span>
                  <Button size="sm" variant="outline" disabled={loading || rows.length < PAGE_SIZE}
                    onClick={() => loadTable(selected, page + 1)}>
                    <ChevronRight className="h-4 w-4" />
                  </Button>
                </div>
              )}
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {!selected ? (
              <div className="p-8 text-center text-muted-foreground text-sm">
                Pick a table on the left to inspect its schema and recent rows.
              </div>
            ) : (
              <div className="space-y-3">
                <div className="px-4 pt-2">
                  <h3 className="text-xs uppercase text-muted-foreground mb-1">Schema</h3>
                  <div className="flex flex-wrap gap-1">
                    {columns.map((c) => (
                      <Badge key={c.column_name} variant="outline" className="font-mono text-[11px]">
                        {c.column_name}: {c.data_type}{c.is_nullable === "NO" ? "*" : ""}
                      </Badge>
                    ))}
                  </div>
                </div>
                <div className="border-t">
                  <ScrollArea className="h-[55vh]">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          {columns.map((c) => (
                            <TableHead key={c.column_name} className="whitespace-nowrap">{c.column_name}</TableHead>
                          ))}
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {rows.length === 0 ? (
                          <TableRow><TableCell colSpan={columns.length || 1} className="text-center text-muted-foreground">
                            {loading ? "Loading…" : "No rows"}
                          </TableCell></TableRow>
                        ) : rows.map((r, i) => (
                          <TableRow key={i}>
                            {columns.map((c) => {
                              const v = r[c.column_name];
                              const txt = v === null || v === undefined
                                ? "—"
                                : typeof v === "object" ? JSON.stringify(v) : String(v);
                              return (
                                <TableCell key={c.column_name} className="font-mono text-xs max-w-[280px] truncate">
                                  {txt}
                                </TableCell>
                              );
                            })}
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </ScrollArea>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
