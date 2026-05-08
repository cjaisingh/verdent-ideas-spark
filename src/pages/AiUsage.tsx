import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { RefreshCw, TrendingDown } from "lucide-react";
import { costFor, fmtTok, fmtUsd, JOB_BASELINE_MODEL, MODEL_PRICING } from "@/lib/aiPricing";

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

// Use the value persisted by the edge function when available; otherwise fall back
// to the client-side pricing table (handles rows logged before cost_usd was added).
function rowCost(r: Row): number {
  if (typeof r.cost_usd === "number") return r.cost_usd;
  return costFor(r.model, r.prompt_tokens ?? 0, r.completion_tokens ?? 0);
}

const WINDOWS = [
  { id: "1d", label: "24h", days: 1 },
  { id: "7d", label: "7 days", days: 7 },
  { id: "14d", label: "14 days", days: 14 },
  { id: "30d", label: "30 days", days: 30 },
] as const;

type WindowId = (typeof WINDOWS)[number]["id"];

function statusVariant(status: string): "default" | "secondary" | "destructive" {
  if (status === "ok") return "secondary";
  return "destructive";
}

export default function AiUsage() {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [win, setWin] = useState<WindowId>("14d");

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
      .limit(1000);
    if (error) setError(error.message);
    else setRows((data ?? []) as Row[]);
    setLoading(false);
  }

  useEffect(() => {
    load();
    const ch = supabase
      .channel("ai_usage_log_page")
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "ai_usage_log" }, () => load())
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [days]);

  const summary = useMemo(() => {
    const list = rows ?? [];
    let actualCost = 0;
    let baselineCost = 0;
    let totalTok = 0;
    let errors = 0;
    let latencySum = 0;
    let latencyN = 0;
    for (const r of list) {
      const inT = r.prompt_tokens ?? 0;
      const outT = r.completion_tokens ?? 0;
      actualCost += rowCost(r);
      const baseModel = JOB_BASELINE_MODEL[r.job] ?? r.model;
      baselineCost += costFor(baseModel, inT, outT);
      totalTok += r.total_tokens ?? inT + outT;
      if (r.status !== "ok") errors += 1;
      if (typeof r.latency_ms === "number") {
        latencySum += r.latency_ms;
        latencyN += 1;
      }
    }
    const savings = baselineCost - actualCost;
    const savingsPct = baselineCost > 0 ? (savings / baselineCost) * 100 : 0;
    return {
      calls: list.length,
      actualCost,
      baselineCost,
      savings,
      savingsPct,
      totalTok,
      errors,
      avgLatency: latencyN ? Math.round(latencySum / latencyN) : null,
    };
  }, [rows]);

  const perJob = useMemo(() => {
    const m = new Map<string, {
      key: string; job: string; model: string;
      runs: number; errors: number;
      inTok: number; outTok: number; totalTok: number;
      cost: number; baselineCost: number;
      latencySum: number; latencyN: number;
      lastAt: string;
    }>();
    for (const r of rows ?? []) {
      const key = `${r.job}::${r.model}`;
      let b = m.get(key);
      if (!b) {
        b = {
          key, job: r.job, model: r.model,
          runs: 0, errors: 0, inTok: 0, outTok: 0, totalTok: 0,
          cost: 0, baselineCost: 0, latencySum: 0, latencyN: 0,
          lastAt: r.created_at,
        };
        m.set(key, b);
      }
      const inT = r.prompt_tokens ?? 0;
      const outT = r.completion_tokens ?? 0;
      b.runs += 1;
      if (r.status !== "ok") b.errors += 1;
      b.inTok += inT;
      b.outTok += outT;
      b.totalTok += r.total_tokens ?? inT + outT;
      b.cost += costFor(r.model, inT, outT);
      const baseModel = JOB_BASELINE_MODEL[r.job] ?? r.model;
      b.baselineCost += costFor(baseModel, inT, outT);
      if (typeof r.latency_ms === "number") {
        b.latencySum += r.latency_ms;
        b.latencyN += 1;
      }
      if (r.created_at > b.lastAt) b.lastAt = r.created_at;
    }
    return Array.from(m.values()).sort((a, b) => (a.lastAt < b.lastAt ? 1 : -1));
  }, [rows]);

  const recent = (rows ?? []).slice(0, 50);

  return (
    <div className="container max-w-7xl py-6 space-y-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">AI usage & cost</h1>
          <p className="text-sm text-muted-foreground">
            Token consumption, latency, and estimated cost per scheduled job run. Costs are estimated from
            Lovable AI Gateway list prices in <code className="text-xs">src/lib/aiPricing.ts</code>.
          </p>
        </div>
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
      </header>

      {error && (
        <Card className="border-destructive/40">
          <CardContent className="py-4 text-sm text-destructive">{error}</CardContent>
        </Card>
      )}

      <section className="grid gap-3 md:grid-cols-4">
        <SummaryStat label="Calls" value={loading && !rows ? null : `${summary.calls}`} sub={`${summary.errors} errors`} />
        <SummaryStat
          label="Actual cost"
          value={loading && !rows ? null : fmtUsd(summary.actualCost)}
          sub={`${fmtTok(summary.totalTok)} tokens`}
        />
        <SummaryStat
          label="Baseline (gpt-5)"
          value={loading && !rows ? null : fmtUsd(summary.baselineCost)}
          sub="if we hadn't switched"
        />
        <SummaryStat
          label="Savings"
          value={loading && !rows ? null : fmtUsd(summary.savings)}
          sub={`${summary.savingsPct.toFixed(0)}% lower`}
          accent={summary.savings > 0 ? "good" : "neutral"}
          icon={summary.savings > 0 ? <TrendingDown className="h-3.5 w-3.5" /> : null}
        />
      </section>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Per job · model</CardTitle>
        </CardHeader>
        <CardContent>
          {loading && !rows ? (
            <Skeleton className="h-40 w-full" />
          ) : perJob.length === 0 ? (
            <p className="text-sm text-muted-foreground">No AI calls in this window.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Job</TableHead>
                  <TableHead>Model</TableHead>
                  <TableHead className="text-right">Runs</TableHead>
                  <TableHead className="text-right">In ↑</TableHead>
                  <TableHead className="text-right">Out ↓</TableHead>
                  <TableHead className="text-right">Avg latency</TableHead>
                  <TableHead className="text-right">Actual</TableHead>
                  <TableHead className="text-right">Baseline</TableHead>
                  <TableHead className="text-right">Saved</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {perJob.map((b) => {
                  const saved = b.baselineCost - b.cost;
                  const avgLat = b.latencyN ? Math.round(b.latencySum / b.latencyN) : null;
                  return (
                    <TableRow key={b.key}>
                      <TableCell className="font-medium">
                        {b.job}
                        {b.errors > 0 && (
                          <Badge variant="destructive" className="ml-2 text-[10px]">{b.errors} err</Badge>
                        )}
                      </TableCell>
                      <TableCell className="font-mono text-xs">{b.model}</TableCell>
                      <TableCell className="text-right tabular-nums">{b.runs}</TableCell>
                      <TableCell className="text-right tabular-nums">{fmtTok(b.inTok)}</TableCell>
                      <TableCell className="text-right tabular-nums">{fmtTok(b.outTok)}</TableCell>
                      <TableCell className="text-right tabular-nums">{avgLat !== null ? `${avgLat}ms` : "—"}</TableCell>
                      <TableCell className="text-right tabular-nums">{fmtUsd(b.cost)}</TableCell>
                      <TableCell className="text-right tabular-nums text-muted-foreground">{fmtUsd(b.baselineCost)}</TableCell>
                      <TableCell className={`text-right tabular-nums ${saved > 0 ? "text-emerald-500" : ""}`}>
                        {fmtUsd(saved)}
                      </TableCell>
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
          <CardTitle className="text-base">Recent runs</CardTitle>
        </CardHeader>
        <CardContent>
          {loading && !rows ? (
            <Skeleton className="h-60 w-full" />
          ) : recent.length === 0 ? (
            <p className="text-sm text-muted-foreground">No runs yet.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>When</TableHead>
                  <TableHead>Job</TableHead>
                  <TableHead>Model</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">In</TableHead>
                  <TableHead className="text-right">Out</TableHead>
                  <TableHead className="text-right">Total</TableHead>
                  <TableHead className="text-right">Latency</TableHead>
                  <TableHead className="text-right">Est. cost</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {recent.map((r) => {
                  const inT = r.prompt_tokens ?? 0;
                  const outT = r.completion_tokens ?? 0;
                  const cost = costFor(r.model, inT, outT);
                  const ts = new Date(r.created_at);
                  return (
                    <TableRow key={r.id}>
                      <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                        {ts.toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}
                      </TableCell>
                      <TableCell className="font-medium">{r.job}</TableCell>
                      <TableCell className="font-mono text-xs">{r.model}</TableCell>
                      <TableCell>
                        <Badge variant={statusVariant(r.status)} className="text-[10px]">
                          {r.status}{r.status_code ? ` · ${r.status_code}` : ""}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{fmtTok(inT)}</TableCell>
                      <TableCell className="text-right tabular-nums">{fmtTok(outT)}</TableCell>
                      <TableCell className="text-right tabular-nums">{fmtTok(r.total_tokens ?? inT + outT)}</TableCell>
                      <TableCell className="text-right tabular-nums">
                        {typeof r.latency_ms === "number" ? `${r.latency_ms}ms` : "—"}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{fmtUsd(cost)}</TableCell>
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
          <CardTitle className="text-base">Pricing reference</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Model</TableHead>
                <TableHead className="text-right">Input ($/1M tok)</TableHead>
                <TableHead className="text-right">Output ($/1M tok)</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {Object.entries(MODEL_PRICING).map(([model, p]) => (
                <TableRow key={model}>
                  <TableCell className="font-mono text-xs">{model}</TableCell>
                  <TableCell className="text-right tabular-nums">${p.in.toFixed(2)}</TableCell>
                  <TableCell className="text-right tabular-nums">${p.out.toFixed(2)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

function SummaryStat({
  label, value, sub, accent, icon,
}: {
  label: string;
  value: string | null;
  sub?: string;
  accent?: "good" | "neutral";
  icon?: React.ReactNode;
}) {
  return (
    <Card>
      <CardContent className="py-4">
        <div className="text-xs text-muted-foreground">{label}</div>
        <div className={`mt-1 flex items-center gap-1.5 text-2xl font-semibold tabular-nums ${accent === "good" ? "text-emerald-500" : ""}`}>
          {icon}
          {value ?? <Skeleton className="h-7 w-20" />}
        </div>
        {sub && <div className="mt-0.5 text-[11px] text-muted-foreground">{sub}</div>}
      </CardContent>
    </Card>
  );
}
