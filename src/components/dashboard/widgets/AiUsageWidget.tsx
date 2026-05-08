import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { WidgetEmpty, WidgetError, WidgetShell, WidgetSkeleton } from "./WidgetShell";
import type { DashboardWidgetProps } from "./types";

type Row = {
  job: string;
  model: string;
  status: string;
  prompt_tokens: number | null;
  completion_tokens: number | null;
  total_tokens: number | null;
  latency_ms: number | null;
  created_at: string;
};

type Bucket = {
  job: string;
  model: string;
  calls: number;
  errors: number;
  in_tok: number;
  out_tok: number;
  total_tok: number;
  latency_sum: number;
  latency_n: number;
  last_at: string;
};

const fmt = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(1)}k` : `${n}`);

export function AiUsageWidget({ size, onOpen }: DashboardWidgetProps) {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [error, setError] = useState(false);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    setError(false);
    const since = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString();
    const { data, error } = await supabase
      .from("ai_usage_log")
      .select("job,model,status,prompt_tokens,completion_tokens,total_tokens,latency_ms,created_at")
      .gte("created_at", since)
      .order("created_at", { ascending: false })
      .limit(500);
    if (error) setError(true);
    else setRows((data ?? []) as Row[]);
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
    const ch = supabase
      .channel("ai_usage_log_widget")
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "ai_usage_log" }, () => load())
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
  }, [load]);

  const max = size === "lg" ? 8 : size === "md" ? 4 : 2;

  const buckets = new Map<string, Bucket>();
  for (const r of rows ?? []) {
    const key = `${r.job}::${r.model}`;
    let b = buckets.get(key);
    if (!b) {
      b = {
        job: r.job, model: r.model, calls: 0, errors: 0,
        in_tok: 0, out_tok: 0, total_tok: 0, latency_sum: 0, latency_n: 0,
        last_at: r.created_at,
      };
      buckets.set(key, b);
    }
    b.calls += 1;
    if (r.status !== "ok") b.errors += 1;
    b.in_tok += r.prompt_tokens ?? 0;
    b.out_tok += r.completion_tokens ?? 0;
    b.total_tok += r.total_tokens ?? 0;
    if (typeof r.latency_ms === "number") {
      b.latency_sum += r.latency_ms;
      b.latency_n += 1;
    }
    if (r.created_at > b.last_at) b.last_at = r.created_at;
  }

  const list = Array.from(buckets.values()).sort((a, b) => (a.last_at < b.last_at ? 1 : -1));
  const totalCalls = list.reduce((acc, b) => acc + b.calls, 0);
  const totalTok = list.reduce((acc, b) => acc + b.total_tok, 0);

  return (
    <WidgetShell title="AI usage · 14d" onOpen={onOpen} scrollable={size === "lg"}>
      {error ? (
        <WidgetError onRetry={load} />
      ) : loading && !rows ? (
        <WidgetSkeleton rows={max} />
      ) : list.length === 0 ? (
        <WidgetEmpty>No scheduled AI calls yet.</WidgetEmpty>
      ) : (
        <div className="space-y-2">
          <div className="flex items-baseline gap-2">
            <span className="text-2xl font-semibold tabular-nums">{totalCalls}</span>
            <span className="text-xs text-muted-foreground">calls</span>
            <span className="ml-auto text-[10px] text-muted-foreground tabular-nums">{fmt(totalTok)} tok</span>
          </div>
          <ul className="space-y-1.5 text-xs">
            {list.slice(0, max).map((b) => {
              const avgLat = b.latency_n ? Math.round(b.latency_sum / b.latency_n) : null;
              return (
                <li key={`${b.job}-${b.model}`} className="flex flex-col gap-0.5 rounded border border-border/60 bg-muted/20 px-2 py-1.5">
                  <div className="flex items-center gap-2">
                    <span className="truncate font-medium">{b.job}</span>
                    {b.errors > 0 && (
                      <span className="text-[10px] text-destructive tabular-nums">{b.errors} err</span>
                    )}
                    <span className="ml-auto text-[10px] text-muted-foreground tabular-nums">×{b.calls}</span>
                  </div>
                  <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
                    <span className="truncate font-mono">{b.model}</span>
                    <span className="ml-auto tabular-nums">
                      {fmt(b.in_tok)}↑ {fmt(b.out_tok)}↓
                      {avgLat !== null && <> · {avgLat}ms</>}
                    </span>
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </WidgetShell>
  );
}
