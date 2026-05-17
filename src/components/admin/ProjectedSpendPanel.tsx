// Projected end-of-month spend from rolling 14/21/30d burn averages.
// Read-only view v_credit_projection; no cron, no writes.
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Skeleton } from "@/components/ui/skeleton";
import { AlertTriangle, TrendingUp } from "lucide-react";

type Row = {
  year_month: string;
  days_in_month: number;
  days_elapsed: number;
  days_left: number;
  mtd_credits: number;
  mtd_manual: number;
  mtd_proxy: number;
  burn_14d_per_day: number;
  burn_21d_per_day: number;
  burn_30d_per_day: number;
  projected_eom_14d: number;
  projected_eom_21d: number;
  projected_eom_30d: number;
  budget: number | null;
  projected_pct_14d: number | null;
  projected_pct_21d: number | null;
  projected_pct_30d: number | null;
};

type Win = "14" | "21" | "30";
const STORAGE_KEY = "awip.projectedSpend.window";

const fmt = (n: number | null | undefined) =>
  n == null ? "—" : Number(n).toLocaleString(undefined, { maximumFractionDigits: 2 });

export function ProjectedSpendPanel() {
  const [row, setRow] = useState<Row | null>(null);
  const [loading, setLoading] = useState(true);
  const [win, setWin] = useState<Win>(() => {
    if (typeof window === "undefined") return "21";
    return (localStorage.getItem(STORAGE_KEY) as Win) || "21";
  });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      const { data } = await supabase.from("v_credit_projection").select("*").maybeSingle();
      if (!cancelled) {
        setRow((data as Row | null) ?? null);
        setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    try { localStorage.setItem(STORAGE_KEY, win); } catch { /* noop */ }
  }, [win]);

  if (loading) {
    return (
      <Card>
        <CardHeader><CardTitle className="text-base">Projected spend</CardTitle></CardHeader>
        <CardContent><Skeleton className="h-32 w-full" /></CardContent>
      </Card>
    );
  }
  if (!row) return null;

  const burn = win === "14" ? row.burn_14d_per_day : win === "21" ? row.burn_21d_per_day : row.burn_30d_per_day;
  const eom = win === "14" ? row.projected_eom_14d : win === "21" ? row.projected_eom_21d : row.projected_eom_30d;
  const pct = win === "14" ? row.projected_pct_14d : win === "21" ? row.projected_pct_21d : row.projected_pct_30d;
  const budget = row.budget;
  const headroom = budget != null ? Number(budget) - Number(eom) : null;

  const tone =
    pct == null ? "neutral" :
    pct >= 100 ? "red" :
    pct >= 80  ? "amber" : "green";

  const toneClass =
    tone === "red"   ? "text-destructive" :
    tone === "amber" ? "text-amber-600 dark:text-amber-400" :
    tone === "green" ? "text-emerald-600 dark:text-emerald-400" :
                       "text-muted-foreground";

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <TrendingUp className="h-4 w-4" /> Projected spend
          <span className="text-xs font-normal text-muted-foreground">· {row.year_month}</span>
        </CardTitle>
        <ToggleGroup
          type="single"
          size="sm"
          value={win}
          onValueChange={(v) => v && setWin(v as Win)}
          className="border rounded-md"
        >
          <ToggleGroupItem value="14" className="text-xs px-2 h-7">14d</ToggleGroupItem>
          <ToggleGroupItem value="21" className="text-xs px-2 h-7">21d</ToggleGroupItem>
          <ToggleGroupItem value="30" className="text-xs px-2 h-7">30d</ToggleGroupItem>
        </ToggleGroup>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <Stat label="MTD actual" value={fmt(row.mtd_credits)} sub={`${fmt(row.mtd_manual)} manual · ${fmt(row.mtd_proxy)} proxy`} />
          <Stat label={`Burn (${win}d)`} value={`${fmt(burn)}/day`} sub={`${row.days_elapsed}/${row.days_in_month} days elapsed`} />
          <Stat label="Projected EOM" value={fmt(eom)} sub={`${row.days_left} days left`} valueClass={toneClass} />
          <Stat
            label={budget ? `vs budget ${fmt(budget)}` : "Budget"}
            value={pct != null ? `${pct.toFixed(0)}%` : "set budget"}
            sub={headroom != null ? `${headroom >= 0 ? "+" : ""}${fmt(headroom)} headroom` : "—"}
            valueClass={toneClass}
            icon={tone === "red" || tone === "amber" ? <AlertTriangle className="h-4 w-4" /> : undefined}
          />
        </div>

        {pct != null && (
          <div className="space-y-1">
            <Progress value={Math.min(100, pct)} className={tone === "red" ? "[&>div]:bg-destructive" : tone === "amber" ? "[&>div]:bg-amber-500" : ""} />
            <div className="flex justify-between text-xs text-muted-foreground">
              <span>0</span>
              <span>80%</span>
              <span>100%</span>
              <span>{fmt(budget)}</span>
            </div>
          </div>
        )}

        <div className="grid grid-cols-3 gap-2 text-xs border-t pt-3">
          <MiniProj label="14d" eom={row.projected_eom_14d} pct={row.projected_pct_14d} active={win === "14"} />
          <MiniProj label="21d" eom={row.projected_eom_21d} pct={row.projected_pct_21d} active={win === "21"} />
          <MiniProj label="30d" eom={row.projected_eom_30d} pct={row.projected_pct_30d} active={win === "30"} />
        </div>

        <p className="text-xs text-muted-foreground">
          Projection = MTD + burn/day × days left. Assumes current burn continues — real number is unknowable (Lovable has no billing API).
          The 80%/100% <a href="/docs/budget-alerts" className="underline">budget alerts</a> use the 7d window (more reactive); this panel lets you compare longer windows.
        </p>
      </CardContent>
    </Card>
  );
}

function Stat({ label, value, sub, valueClass, icon }: { label: string; value: string; sub?: string; valueClass?: string; icon?: React.ReactNode }) {
  return (
    <div className="rounded-md border p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className={`text-xl font-semibold tabular-nums flex items-center gap-1 ${valueClass ?? ""}`}>
        {icon}{value}
      </div>
      {sub && <div className="text-xs text-muted-foreground mt-1">{sub}</div>}
    </div>
  );
}

function MiniProj({ label, eom, pct, active }: { label: string; eom: number; pct: number | null; active: boolean }) {
  return (
    <div className={`rounded border p-2 ${active ? "border-primary bg-primary/5" : ""}`}>
      <div className="text-muted-foreground">{label} window</div>
      <div className="font-medium tabular-nums">{fmt(eom)} <span className="text-muted-foreground">({pct != null ? `${pct.toFixed(0)}%` : "—"})</span></div>
    </div>
  );
}
