// Spend by work category: bar chart + table on /admin/ai-usage Credits tab.
// Backed by v_credit_spend_by_category view.
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, Cell } from "recharts";
import { PieChart as PieIcon, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { categoryChip } from "@/lib/workCategory";

type Row = {
  category: string;
  mtd_credits: number;
  mtd_pct: number | null;
  last_30d_credits: number;
  last_30d_pct: number | null;
  entry_count_30d: number;
};

type DriftRow = {
  category: string;
  phase_sample_count: number;
  drift_ratio: number | null;
  confidence: "low" | "medium" | "high" | null;
};

type Win = "mtd" | "30d";

const fmt = (n: number | null | undefined) =>
  n == null ? "—" : Number(n).toLocaleString(undefined, { maximumFractionDigits: 2 });

const BAR_COLORS: Record<string, string> = {
  plan: "hsl(217 91% 60%)",
  build: "hsl(160 84% 39%)",
  pivot: "hsl(38 92% 50%)",
  refactor: "hsl(271 81% 56%)",
  bugfix: "hsl(0 84% 60%)",
  research: "hsl(189 94% 43%)",
  ops: "hsl(215 16% 47%)",
  other: "hsl(220 9% 46%)",
};

interface Props {
  selectedCategory: string | null;
  onSelectCategory: (cat: string | null) => void;
}

export function SpendByCategoryPanel({ selectedCategory, onSelectCategory }: Props) {
  const [rows, setRows] = useState<Row[]>([]);
  const [drift, setDrift] = useState<Record<string, DriftRow>>({});
  const [loading, setLoading] = useState(true);
  const [win, setWin] = useState<Win>("30d");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      const [spendRes, driftRes] = await Promise.all([
        supabase.from("v_credit_spend_by_category").select("*"),
        supabase.from("v_credit_drift_ratio_by_category").select("*"),
      ]);
      if (!cancelled) {
        setRows((spendRes.data as Row[]) ?? []);
        const map: Record<string, DriftRow> = {};
        for (const d of (driftRes.data as DriftRow[]) ?? []) map[d.category] = d;
        setDrift(map);
        setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const sorted = [...rows].sort((a, b) =>
    win === "30d" ? b.last_30d_credits - a.last_30d_credits : b.mtd_credits - a.mtd_credits
  );

  const chartData = sorted
    .filter((r) => (win === "30d" ? r.last_30d_credits : r.mtd_credits) > 0)
    .map((r) => ({
      category: r.category,
      value: Number(win === "30d" ? r.last_30d_credits : r.mtd_credits),
    }));

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <PieIcon className="h-4 w-4" /> Spend by category
        </CardTitle>
        <div className="flex items-center gap-2">
          {selectedCategory && (
            <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => onSelectCategory(null)}>
              <X className="h-3 w-3 mr-1" /> Clear filter ({selectedCategory})
            </Button>
          )}
          <ToggleGroup
            type="single"
            size="sm"
            value={win}
            onValueChange={(v) => v && setWin(v as Win)}
            className="border rounded-md"
          >
            <ToggleGroupItem value="mtd" className="text-xs px-2 h-7">MTD</ToggleGroupItem>
            <ToggleGroupItem value="30d" className="text-xs px-2 h-7">30d</ToggleGroupItem>
          </ToggleGroup>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {loading ? (
          <Skeleton className="h-48 w-full" />
        ) : chartData.length === 0 ? (
          <p className="text-sm text-muted-foreground">No credits logged in this window yet.</p>
        ) : (
          <>
            <div className="h-48">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={chartData} layout="vertical" margin={{ left: 12, right: 12, top: 4, bottom: 4 }}>
                  <XAxis type="number" tick={{ fontSize: 11 }} />
                  <YAxis dataKey="category" type="category" width={70} tick={{ fontSize: 11 }} />
                  <Tooltip
                    contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 6, fontSize: 12 }}
                    formatter={(v: number) => fmt(v)}
                  />
                  <Bar dataKey="value" radius={[0, 4, 4, 0]}>
                    {chartData.map((d) => (
                      <Cell
                        key={d.category}
                        fill={BAR_COLORS[d.category] ?? BAR_COLORS.other}
                        opacity={selectedCategory && selectedCategory !== d.category ? 0.3 : 1}
                        style={{ cursor: "pointer" }}
                        onClick={() => onSelectCategory(selectedCategory === d.category ? null : d.category)}
                      />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>

            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Category</TableHead>
                  <TableHead className="text-right">MTD</TableHead>
                  <TableHead className="text-right">30d</TableHead>
                  <TableHead className="text-right">% of 30d</TableHead>
                  <TableHead className="text-right">Entries 30d</TableHead>
                  <TableHead className="text-right" title="Actual ÷ logged across last closed phases. >1 means we underlog.">Drift</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sorted.map((r) => {
                  const active = selectedCategory === r.category;
                  const d = drift[r.category];
                  const dr = d?.drift_ratio == null ? null : Number(d.drift_ratio);
                  const drTone = dr == null ? "text-muted-foreground" :
                    dr > 1.2 ? "text-amber-600 dark:text-amber-400" :
                    dr < 0.8 ? "text-cyan-600 dark:text-cyan-400" : "text-muted-foreground";
                  return (
                    <TableRow
                      key={r.category}
                      onClick={() => onSelectCategory(active ? null : r.category)}
                      className={`cursor-pointer ${active ? "bg-muted/60" : ""}`}
                    >
                      <TableCell>
                        <span className={`inline-flex items-center px-2 py-0.5 rounded-full border text-xs ${categoryChip(r.category)}`}>
                          {r.category}
                        </span>
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{fmt(r.mtd_credits)}</TableCell>
                      <TableCell className="text-right tabular-nums font-medium">{fmt(r.last_30d_credits)}</TableCell>
                      <TableCell className="text-right tabular-nums text-muted-foreground">{r.last_30d_pct != null ? `${r.last_30d_pct.toFixed(0)}%` : "—"}</TableCell>
                      <TableCell className="text-right tabular-nums text-muted-foreground">{r.entry_count_30d}</TableCell>
                      <TableCell className={`text-right tabular-nums ${drTone}`} title={d ? `${d.phase_sample_count} phases · ${d.confidence}` : "no samples"}>
                        {dr != null ? `×${dr.toFixed(2)}` : "—"}
                        {d && <span className="text-[10px] text-muted-foreground ml-1">({d.phase_sample_count})</span>}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </>
        )}
        <p className="text-xs text-muted-foreground">
          Click a bar or row to filter the recent-entries table below. Categories tag work type (plan, pivot, refactor…); orthogonal to Lovable run mode.
        </p>
      </CardContent>
    </Card>
  );
}
