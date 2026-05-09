import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import {
  Bar, BarChart, CartesianGrid, Cell, Legend, ResponsiveContainer,
  Tooltip, XAxis, YAxis,
} from "recharts";
import { WidgetEmpty, WidgetError, WidgetShell, WidgetSkeleton } from "./WidgetShell";
import type { DashboardWidgetProps } from "./types";

// Human cost baseline — kept in sync with src/pages/Plan.tsx
const HUMAN_ANNUAL_GBP = 70_000;
const HUMAN_ANNUAL_HOURS = 52 * 37.5;
const HUMAN_HOURLY_GBP = HUMAN_ANNUAL_GBP / HUMAN_ANNUAL_HOURS; // ~£35.90/h
const USD_TO_GBP = 0.79;

type WsRow = {
  id: string;
  slug: string;
  title: string;
  sort_order: number;
  est_human_hours: number;
  est_ai_build_usd: number;
};

type CostRow = {
  workstream_id: string;
  est_monthly_usd: number | null;
  actual_usd_30d: number | null;
};

type ChartDatum = {
  slug: string;
  label: string;
  human: number;       // £
  ai: number;          // £ (build + 30d run)
  humanHours: number;
  aiBuildGbp: number;
  aiRunGbp: number;
  ratio: number;       // human / ai (×N cheaper)
};

const fmtGbp = (n: number) =>
  n >= 1000 ? `£${(n / 1000).toFixed(1)}k`
  : n >= 10 ? `£${n.toFixed(0)}`
  : `£${n.toFixed(2)}`;

export function AiVsHumanCostWidget({ size, onOpen }: DashboardWidgetProps) {
  const [data, setData] = useState<ChartDatum[] | null>(null);
  const [error, setError] = useState(false);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    setError(false);
    const [ws, cs] = await Promise.all([
      supabase.from("plan_workstreams")
        .select("id,slug,title,sort_order,est_human_hours,est_ai_build_usd")
        .order("sort_order"),
      supabase.from("cost_summary_by_workstream" as any)
        .select("workstream_id,est_monthly_usd,actual_usd_30d"),
    ]);
    if (ws.error) { setError(true); setLoading(false); return; }
    const costMap = new Map<string, CostRow>();
    for (const c of (cs.data ?? []) as unknown as CostRow[]) costMap.set(c.workstream_id, c);

    const rows: ChartDatum[] = ((ws.data ?? []) as WsRow[]).map((w) => {
      const c = costMap.get(w.id);
      const human = Number(w.est_human_hours || 0) * HUMAN_HOURLY_GBP;
      const aiBuildGbp = Number(w.est_ai_build_usd || 0) * USD_TO_GBP;
      const aiRunGbp = Number(c?.actual_usd_30d || 0) * USD_TO_GBP;
      const ai = aiBuildGbp + aiRunGbp;
      const ratio = ai > 0 ? human / ai : 0;
      return {
        slug: w.slug,
        label: w.title,
        human,
        ai,
        humanHours: Number(w.est_human_hours || 0),
        aiBuildGbp,
        aiRunGbp,
        ratio,
      };
    });
    setData(rows);
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
    const ch = supabase
      .channel("ai-vs-human-cost-widget")
      .on("postgres_changes", { event: "*", schema: "public", table: "plan_workstreams" }, () => load())
      .on("postgres_changes", { event: "*", schema: "public", table: "cost_estimates" }, () => load())
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [load]);

  const totalHuman = (data ?? []).reduce((s, d) => s + d.human, 0);
  const totalAi = (data ?? []).reduce((s, d) => s + d.ai, 0);
  const totalHours = (data ?? []).reduce((s, d) => s + d.humanHours, 0);
  const ratio = totalAi > 0 ? totalHuman / totalAi : 0;

  return (
    <WidgetShell title="AI vs Human · build cost" onOpen={onOpen}>
      {error ? (
        <WidgetError onRetry={load} />
      ) : loading && !data ? (
        <WidgetSkeleton rows={size === "lg" ? 6 : 4} />
      ) : !data || data.length === 0 ? (
        <WidgetEmpty>No workstream cost data yet.</WidgetEmpty>
      ) : (
        <div className="flex h-full flex-col gap-2">
          <div className="flex items-baseline gap-3 text-xs">
            <div className="flex items-baseline gap-1">
              <span className="text-2xl font-semibold tabular-nums text-foreground">{fmtGbp(totalAi)}</span>
              <span className="text-[10px] text-muted-foreground">AI</span>
            </div>
            <div className="flex items-baseline gap-1">
              <span className="text-base font-semibold tabular-nums text-muted-foreground">{fmtGbp(totalHuman)}</span>
              <span className="text-[10px] text-muted-foreground">Human ({totalHours.toFixed(0)}h)</span>
            </div>
            {ratio > 1 && (
              <span className="ml-auto rounded bg-primary/10 px-1.5 py-0.5 text-[10px] font-semibold text-primary tabular-nums">
                {ratio >= 100 ? `${Math.round(ratio)}×` : `${ratio.toFixed(1)}×`} cheaper
              </span>
            )}
          </div>
          <div className="min-h-0 flex-1">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={data}
                layout="vertical"
                margin={{ top: 4, right: 8, left: 0, bottom: 0 }}
                barGap={2}
              >
                <CartesianGrid horizontal={false} stroke="hsl(var(--border))" strokeDasharray="2 4" />
                <XAxis
                  type="number"
                  tickFormatter={(v) => fmtGbp(Number(v))}
                  tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
                  axisLine={{ stroke: "hsl(var(--border))" }}
                  tickLine={false}
                />
                <YAxis
                  type="category"
                  dataKey="slug"
                  width={size === "sm" ? 60 : 90}
                  tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
                  axisLine={false}
                  tickLine={false}
                />
                <Tooltip
                  cursor={{ fill: "hsl(var(--muted) / 0.3)" }}
                  contentStyle={{
                    background: "hsl(var(--popover))",
                    border: "1px solid hsl(var(--border))",
                    borderRadius: 6,
                    fontSize: 11,
                  }}
                  formatter={(value: number, name: string, item) => {
                    const d = item.payload as ChartDatum;
                    if (name === "Human") return [`${fmtGbp(value)} (${d.humanHours}h)`, name];
                    if (name === "AI")
                      return [
                        `${fmtGbp(value)} (build ${fmtGbp(d.aiBuildGbp)} + 30d ${fmtGbp(d.aiRunGbp)})`,
                        name,
                      ];
                    return [fmtGbp(value), name];
                  }}
                  labelFormatter={(label, payload) => {
                    const p = payload?.[0]?.payload as ChartDatum | undefined;
                    return p?.label ?? String(label);
                  }}
                />
                <Legend
                  wrapperStyle={{ fontSize: 10, paddingTop: 4 }}
                  iconSize={8}
                />
                <Bar dataKey="human" name="Human" fill="hsl(var(--muted-foreground))" radius={[0, 2, 2, 0]} />
                <Bar dataKey="ai" name="AI" fill="hsl(var(--primary))" radius={[0, 2, 2, 0]}>
                  {data.map((d) => (
                    <Cell key={d.slug} fill="hsl(var(--primary))" />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}
    </WidgetShell>
  );
}
