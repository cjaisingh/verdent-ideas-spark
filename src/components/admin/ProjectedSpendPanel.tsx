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

type Runway = {
  balance: number | null;
  as_of: string | null;
  spent_since_as_of: number | null;
  estimated_balance_now: number | null;
  burn_per_day_7d: number | null;
  burn_per_day_21d: number | null;
  days_runway_21d: number | null;
  days_runway_7d: number | null;
  runway_exhaustion_date_21d: string | null;
};

type Win = "14" | "21" | "30";
const STORAGE_KEY = "awip.projectedSpend.window";
const DRIFT_KEY = "awip.projectedSpend.driftAdjust";

type Drift = {
  phase_sample_count: number;
  logged_total: number | null;
  actual_total: number | null;
  drift_ratio: number | null;
  confidence: "low" | "medium" | "high" | null;
};

const fmt = (n: number | null | undefined) =>
  n == null ? "—" : Number(n).toLocaleString(undefined, { maximumFractionDigits: 2 });

export function ProjectedSpendPanel() {
  const [row, setRow] = useState<Row | null>(null);
  const [runway, setRunway] = useState<Runway | null>(null);
  const [drift, setDrift] = useState<Drift | null>(null);
  const [loading, setLoading] = useState(true);
  const [win, setWin] = useState<Win>(() => {
    if (typeof window === "undefined") return "21";
    return (localStorage.getItem(STORAGE_KEY) as Win) || "21";
  });
  const [driftAdjust, setDriftAdjust] = useState<boolean>(() => {
    if (typeof window === "undefined") return true;
    return localStorage.getItem(DRIFT_KEY) !== "0";
  });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      const [proj, rw, dr] = await Promise.all([
        supabase.from("v_credit_projection").select("*").maybeSingle(),
        supabase.from("v_credit_runway").select("*").maybeSingle(),
        supabase.from("v_credit_drift_ratio_overall").select("*").maybeSingle(),
      ]);
      if (!cancelled) {
        setRow((proj.data as Row | null) ?? null);
        setRunway((rw.data as Runway | null) ?? null);
        setDrift((dr.data as Drift | null) ?? null);
        setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    try { localStorage.setItem(STORAGE_KEY, win); } catch { /* noop */ }
  }, [win]);
  useEffect(() => {
    try { localStorage.setItem(DRIFT_KEY, driftAdjust ? "1" : "0"); } catch { /* noop */ }
  }, [driftAdjust]);

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
  const rawEom = win === "14" ? row.projected_eom_14d : win === "21" ? row.projected_eom_21d : row.projected_eom_30d;
  const rawPct = win === "14" ? row.projected_pct_14d : win === "21" ? row.projected_pct_21d : row.projected_pct_30d;
  const budget = row.budget;

  const driftRatio = drift?.drift_ratio == null ? null : Number(drift.drift_ratio);
  const driftConf = drift?.confidence ?? "low";
  const driftApplicable = driftAdjust && driftRatio != null && driftRatio > 0 && driftConf !== "low";
  const eom = driftApplicable ? Number(rawEom) * driftRatio! : Number(rawEom);
  const pct = budget != null && budget > 0 ? Math.round((eom / Number(budget)) * 100 * 100) / 100 : rawPct;
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
        <div className="flex items-center gap-2">
          {driftRatio != null && driftConf !== "low" && (
            <button
              type="button"
              onClick={() => setDriftAdjust(!driftAdjust)}
              className={`text-xs px-2 h-7 rounded border ${driftAdjust ? "bg-primary/10 border-primary/40 text-primary" : "bg-muted text-muted-foreground"}`}
              title={`Drift ratio ${driftRatio.toFixed(2)}× from last ${drift?.phase_sample_count} phases (${driftConf} confidence). Click to ${driftAdjust ? "show raw" : "apply"}.`}
            >
              {driftAdjust ? `Adjusted ×${driftRatio.toFixed(2)}` : "Unadjusted"}
            </button>
          )}
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
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <RunwayBlock runway={runway} />

        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <Stat label="MTD actual" value={fmt(row.mtd_credits)} sub={`${fmt(row.mtd_manual)} manual · ${fmt(row.mtd_proxy)} proxy`} />
          <Stat label={`Burn (${win}d)`} value={`${fmt(burn)}/day`} sub={`${row.days_elapsed}/${row.days_in_month} days elapsed`} />
          <Stat
            label="Projected EOM"
            value={fmt(eom)}
            sub={driftApplicable
              ? `raw ${fmt(rawEom)} × ${driftRatio!.toFixed(2)} drift · ${row.days_left}d left`
              : `${row.days_left} days left`}
            valueClass={toneClass}
          />
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

function RunwayBlock({ runway }: { runway: Runway | null }) {
  if (!runway || runway.balance == null) {
    return (
      <div className="rounded-md border border-dashed p-3 text-xs text-muted-foreground">
        No current balance recorded. Use <strong>Record balance</strong> below to enable runway estimates.
      </div>
    );
  }
  const days = runway.days_runway_21d;
  const stale = runway.as_of ? (Date.now() - +new Date(runway.as_of)) > 7 * 24 * 60 * 60 * 1000 : false;
  const tone =
    days == null ? "text-muted-foreground" :
    days < 7  ? "text-destructive" :
    days < 14 ? "text-amber-600 dark:text-amber-400" :
    "text-emerald-600 dark:text-emerald-400";
  return (
    <div className="rounded-md border p-3 space-y-1">
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="text-xs text-muted-foreground">Estimated balance now</div>
          <div className="text-2xl font-semibold tabular-nums">{fmt(runway.estimated_balance_now)}</div>
          <div className="text-xs text-muted-foreground">
            Last reading {fmt(runway.balance)} on {runway.as_of ? new Date(runway.as_of).toLocaleString() : "—"} ·
            spent {fmt(runway.spent_since_as_of)} since
          </div>
        </div>
        <div className="text-right">
          <div className="text-xs text-muted-foreground">Runway (21d burn)</div>
          <div className={`text-2xl font-semibold tabular-nums ${tone}`}>
            {days != null ? `≈ ${days} days` : "—"}
          </div>
          {runway.runway_exhaustion_date_21d && (
            <div className="text-xs text-muted-foreground">
              exhaust ~ {new Date(runway.runway_exhaustion_date_21d).toLocaleDateString()}
            </div>
          )}
        </div>
      </div>
      {stale && (
        <div className="text-xs text-amber-600 dark:text-amber-400">
          Balance reading is over 7 days old — record a fresh one to keep runway honest.
        </div>
      )}
    </div>
  );
}
