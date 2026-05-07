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
  const [filter, setFilter] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const [columns, setColumns] = useState<ColumnInfo[]>([]);
  const [rows, setRows] = useState<any[]>([]);
  const [page, setPage] = useState(0);
  const [loading, setLoading] = useState(false);

  const loadTables = async () => {
    const { data, error } = await supabase.rpc("db_list_tables");
    if (error) { toast.error(error.message); return; }
    setTables((data || []) as TableInfo[]);
  };

  useEffect(() => { loadTables(); }, []);

  const loadTable = async (name: string, p = 0) => {
    setLoading(true);
    setSelected(name); setPage(p);
    const [colsRes, rowsRes] = await Promise.all([
      supabase.rpc("db_list_columns", { _table: name }),
      supabase.rpc("db_preview_rows", { _table: name, _limit: PAGE_SIZE, _offset: p * PAGE_SIZE }),
    ]);
    if (colsRes.error) toast.error(colsRes.error.message);
    if (rowsRes.error) toast.error(rowsRes.error.message);
    setColumns((colsRes.data || []) as ColumnInfo[]);
    setRows(Array.isArray(rowsRes.data) ? (rowsRes.data as any[]) : []);
    setLoading(false);
  };

  const filtered = useMemo(
    () => tables.filter((t) => t.table_name.toLowerCase().includes(filter.toLowerCase())),
    [tables, filter]
  );

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
        </div>
        <Button variant="outline" size="sm" onClick={loadTables}>
          <RefreshCw className="h-4 w-4 mr-2" /> Refresh
        </Button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-[280px_1fr] gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Tables ({filtered.length})</CardTitle>
            <Input placeholder="Filter…" value={filter} onChange={(e) => setFilter(e.target.value)} className="mt-2" />
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
