// /admin/ai-usage — operator view of public.ai_usage_log.
// Per-day counts, filters by job/model/status, CSV export, and detail rows.

import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { CreditsUsagePanel } from "@/components/admin/CreditsUsagePanel";
import { ToolPolicyPanel } from "@/components/admin/ToolPolicyPanel";
import { BudgetAlertBanner } from "@/components/admin/BudgetAlertBanner";
import { BalanceSnapshotDialog } from "@/components/admin/BalanceSnapshotDialog";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Download, RefreshCw } from "lucide-react";
import { toast } from "sonner";

type Row = {
  id: string;
  job: string;
  model: string;
  trigger: string;
  status: string;
  status_code: number | null;
  prompt_tokens: number | null;
  completion_tokens: number | null;
  total_tokens: number | null;
  cost_usd: number | null;
  latency_ms: number | null;
  error: string | null;
  request_ref: Record<string, unknown> | null;
  created_at: string;
};

const WINDOWS = [
  { id: "1d", label: "24h", days: 1 },
  { id: "7d", label: "7 days", days: 7 },
  { id: "14d", label: "14 days", days: 14 },
  { id: "30d", label: "30 days", days: 30 },
] as const;
type WindowId = (typeof WINDOWS)[number]["id"];

const ALL = "__all__";

function fmtUsd(n: number): string {
  if (!n) return "$0.00";
  if (n < 0.01) return `$${n.toFixed(4)}`;
  return `$${n.toFixed(2)}`;
}

function csvEscape(v: unknown): string {
  if (v == null) return "";
  const s = typeof v === "string" ? v : typeof v === "object" ? JSON.stringify(v) : String(v);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function downloadCsv(filename: string, header: string[], rows: unknown[][]) {
  const lines = [header.map(csvEscape).join(",")];
  for (const r of rows) lines.push(r.map(csvEscape).join(","));
  const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export default function AdminAiUsage() {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [win, setWin] = useState<WindowId>("14d");
  const [jobFilter, setJobFilter] = useState<string>(ALL);
  const [modelFilter, setModelFilter] = useState<string>(ALL);
  const [statusFilter, setStatusFilter] = useState<string>(ALL);
  const [search, setSearch] = useState("");

  const days = WINDOWS.find((w) => w.id === win)!.days;

  async function load() {
    setLoading(true);
    setError(null);
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
    const { data, error } = await supabase
      .from("ai_usage_log")
      .select("id,job,model,trigger,status,status_code,prompt_tokens,completion_tokens,total_tokens,cost_usd,latency_ms,error,request_ref,created_at")
      .gte("created_at", since)
      .order("created_at", { ascending: false })
      .limit(2000);
    if (error) setError(error.message);
    else setRows((data ?? []) as Row[]);
    setLoading(false);
  }

  useEffect(() => {
    load();
    const ch = supabase
      .channel("admin_ai_usage_log")
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "ai_usage_log" }, () => load())
      .subscribe();
    return () => { supabase.removeChannel(ch); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [days]);

  const jobOptions = useMemo(
    () => Array.from(new Set((rows ?? []).map((r) => r.job))).sort(),
    [rows],
  );
  const modelOptions = useMemo(
    () => Array.from(new Set((rows ?? []).map((r) => r.model))).sort(),
    [rows],
  );
  const statusOptions = useMemo(
    () => Array.from(new Set((rows ?? []).map((r) => r.status))).sort(),
    [rows],
  );

  const filtered = useMemo(() => {
    const list = rows ?? [];
    return list.filter((r) => {
      if (jobFilter !== ALL && r.job !== jobFilter) return false;
      if (modelFilter !== ALL && r.model !== modelFilter) return false;
      if (statusFilter !== ALL && r.status !== statusFilter) return false;
      if (search) {
        const s = search.toLowerCase();
        const refStr = r.request_ref ? JSON.stringify(r.request_ref).toLowerCase() : "";
        if (!(
          r.job.toLowerCase().includes(s) ||
          r.model.toLowerCase().includes(s) ||
          (r.error ?? "").toLowerCase().includes(s) ||
          (r.trigger ?? "").toLowerCase().includes(s) ||
          refStr.includes(s)
        )) return false;
      }
      return true;
    });
  }, [rows, jobFilter, modelFilter, statusFilter, search]);

  // Per-day x job aggregation table.
  const perDay = useMemo(() => {
    type Bucket = { day: string; job: string; runs: number; errors: number; tokens: number; cost: number };
    const m = new Map<string, Bucket>();
    for (const r of filtered) {
      const day = r.created_at.slice(0, 10);
      const key = `${day}::${r.job}`;
      let b = m.get(key);
      if (!b) { b = { day, job: r.job, runs: 0, errors: 0, tokens: 0, cost: 0 }; m.set(key, b); }
      b.runs += 1;
      if (r.status !== "ok") b.errors += 1;
      b.tokens += r.total_tokens ?? (r.prompt_tokens ?? 0) + (r.completion_tokens ?? 0);
      b.cost += r.cost_usd ?? 0;
    }
    return Array.from(m.values()).sort((a, b) => (a.day === b.day ? a.job.localeCompare(b.job) : a.day < b.day ? 1 : -1));
  }, [filtered]);

  const totals = useMemo(() => {
    let runs = 0, errors = 0, tokens = 0, cost = 0;
    for (const b of perDay) { runs += b.runs; errors += b.errors; tokens += b.tokens; cost += b.cost; }
    return { runs, errors, tokens, cost };
  }, [perDay]);

  function exportPerDay() {
    downloadCsv(
      `ai_usage_per_day_${win}.csv`,
      ["day", "job", "runs", "errors", "tokens", "cost_usd"],
      perDay.map((b) => [b.day, b.job, b.runs, b.errors, b.tokens, b.cost.toFixed(6)]),
    );
    toast.success(`Exported ${perDay.length} rows`);
  }

  function exportDetails() {
    downloadCsv(
      `ai_usage_details_${win}.csv`,
      ["created_at", "job", "model", "trigger", "status", "status_code", "prompt_tokens", "completion_tokens", "total_tokens", "cost_usd", "latency_ms", "error", "request_ref"],
      filtered.map((r) => [
        r.created_at, r.job, r.model, r.trigger, r.status, r.status_code,
        r.prompt_tokens, r.completion_tokens, r.total_tokens, r.cost_usd, r.latency_ms,
        r.error, r.request_ref,
      ]),
    );
    toast.success(`Exported ${filtered.length} rows`);
  }

  return (
    <div className="container max-w-7xl mx-auto py-8 space-y-6">
      <div>
        <h1 className="text-3xl font-bold">AI Usage</h1>
        <p className="text-sm text-muted-foreground">
          Per-day AI call counts and operator-logged credit spend.
        </p>
      </div>

      <BudgetAlertBanner />

      <Tabs defaultValue="ai-calls">
        <TabsList>
          <TabsTrigger value="ai-calls">AI calls</TabsTrigger>
          <TabsTrigger value="credits">Credits &amp; Usage</TabsTrigger>
          <TabsTrigger value="tool-policy">Tool Policy</TabsTrigger>
        </TabsList>

        <TabsContent value="credits" className="mt-6">
          <CreditsUsagePanel />
        </TabsContent>

        <TabsContent value="tool-policy" className="mt-6">
          <ToolPolicyPanel />
        </TabsContent>

        <TabsContent value="ai-calls" className="mt-6 space-y-6">
      <div className="flex items-center justify-end gap-2 flex-wrap">
        <div className="flex items-center gap-2">
          <Tabs value={win} onValueChange={(v) => setWin(v as WindowId)}>
            <TabsList>
              {WINDOWS.map((w) => (
                <TabsTrigger key={w.id} value={w.id}>{w.label}</TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
          <Button variant="outline" size="sm" onClick={load} disabled={loading}>
            <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
          </Button>
        </div>
      </div>

      {error && (
        <Card className="border-destructive/40">
          <CardContent className="py-4 text-sm text-destructive">{error}</CardContent>
        </Card>
      )}

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <KpiCard label="Calls" value={totals.runs.toLocaleString()} loading={loading && !rows} />
        <KpiCard label="Errors" value={totals.errors.toLocaleString()} loading={loading && !rows} tone={totals.errors > 0 ? "warn" : undefined} />
        <KpiCard label="Tokens" value={totals.tokens.toLocaleString()} loading={loading && !rows} />
        <KpiCard label="Cost" value={fmtUsd(totals.cost)} loading={loading && !rows} />
      </div>

      <Card>
        <CardHeader className="pb-3">
          <div className="flex flex-wrap gap-2 items-center justify-between">
            <div className="flex flex-wrap gap-2 items-center">
              <Select value={jobFilter} onValueChange={setJobFilter}>
                <SelectTrigger className="w-[220px]"><SelectValue placeholder="Function / job" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL}>All jobs</SelectItem>
                  {jobOptions.map((j) => <SelectItem key={j} value={j}>{j}</SelectItem>)}
                </SelectContent>
              </Select>
              <Select value={modelFilter} onValueChange={setModelFilter}>
                <SelectTrigger className="w-[220px]"><SelectValue placeholder="Model" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL}>All models</SelectItem>
                  {modelOptions.map((m) => <SelectItem key={m} value={m}>{m}</SelectItem>)}
                </SelectContent>
              </Select>
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger className="w-[140px]"><SelectValue placeholder="Status" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL}>All statuses</SelectItem>
                  {statusOptions.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                </SelectContent>
              </Select>
              <Input
                placeholder="Search job / model / error / request_ref"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="w-[280px]"
              />
            </div>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={exportPerDay} disabled={!perDay.length}>
                <Download className="h-4 w-4 mr-2" /> CSV (per-day)
              </Button>
              <Button variant="outline" size="sm" onClick={exportDetails} disabled={!filtered.length}>
                <Download className="h-4 w-4 mr-2" /> CSV (details)
              </Button>
            </div>
          </div>
        </CardHeader>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Per-day · job</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {loading && !rows ? (
            <div className="p-4 space-y-2">{[...Array(6)].map((_, i) => <Skeleton key={i} className="h-8" />)}</div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[120px]">Day</TableHead>
                  <TableHead>Job</TableHead>
                  <TableHead className="text-right">Runs</TableHead>
                  <TableHead className="text-right">Errors</TableHead>
                  <TableHead className="text-right">Tokens</TableHead>
                  <TableHead className="text-right">Cost</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {perDay.length === 0 && (
                  <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground py-8">No AI calls in this window.</TableCell></TableRow>
                )}
                {perDay.map((b) => (
                  <TableRow key={`${b.day}::${b.job}`}>
                    <TableCell className="font-mono text-xs">{b.day}</TableCell>
                    <TableCell className="font-medium">{b.job}</TableCell>
                    <TableCell className="text-right tabular-nums">{b.runs}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {b.errors > 0 ? <Badge variant="destructive" className="text-[10px]">{b.errors}</Badge> : "0"}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{b.tokens.toLocaleString()}</TableCell>
                    <TableCell className="text-right tabular-nums">{fmtUsd(b.cost)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Details ({filtered.length})</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {loading && !rows ? (
            <div className="p-4 space-y-2">{[...Array(8)].map((_, i) => <Skeleton key={i} className="h-8" />)}</div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[160px]">When</TableHead>
                  <TableHead>Job</TableHead>
                  <TableHead>Model</TableHead>
                  <TableHead>Trigger</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Tokens</TableHead>
                  <TableHead className="text-right">Latency</TableHead>
                  <TableHead className="text-right">Cost</TableHead>
                  <TableHead>Error</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.length === 0 && (
                  <TableRow><TableCell colSpan={9} className="text-center text-muted-foreground py-8">No rows match these filters.</TableCell></TableRow>
                )}
                {filtered.slice(0, 200).map((r) => {
                  const ts = new Date(r.created_at);
                  return (
                    <TableRow key={r.id}>
                      <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                        {ts.toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}
                      </TableCell>
                      <TableCell className="font-medium">{r.job}</TableCell>
                      <TableCell className="font-mono text-xs">{r.model}</TableCell>
                      <TableCell className="text-xs">{r.trigger}</TableCell>
                      <TableCell>
                        <Badge variant={r.status === "ok" ? "secondary" : "destructive"} className="text-[10px]">
                          {r.status}{r.status_code ? ` · ${r.status_code}` : ""}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{(r.total_tokens ?? (r.prompt_tokens ?? 0) + (r.completion_tokens ?? 0)).toLocaleString()}</TableCell>
                      <TableCell className="text-right tabular-nums">{typeof r.latency_ms === "number" ? `${r.latency_ms}ms` : "—"}</TableCell>
                      <TableCell className="text-right tabular-nums">{fmtUsd(r.cost_usd ?? 0)}</TableCell>
                      <TableCell className="text-xs text-muted-foreground max-w-[260px] truncate">{r.error ?? ""}</TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
          {filtered.length > 200 && (
            <div className="px-4 py-2 text-xs text-muted-foreground border-t">
              Showing first 200 of {filtered.length}. Export CSV for the full set.
            </div>
          )}
        </CardContent>
      </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}

function KpiCard({ label, value, loading, tone }: { label: string; value: string; loading?: boolean; tone?: "warn" }) {
  return (
    <Card>
      <CardContent className="py-4">
        <div className="text-xs text-muted-foreground">{label}</div>
        <div className={`mt-1 text-2xl font-semibold tabular-nums ${tone === "warn" ? "text-amber-500" : ""}`}>
          {loading ? <Skeleton className="h-7 w-20" /> : value}
        </div>
      </CardContent>
    </Card>
  );
}
