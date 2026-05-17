// BalanceTrackingPanel — per-snapshot deltas + drift vs logged spend.
// Lives above BalanceHistoryPanel on /admin/ai-usage Credits & Usage tab.
// Each row = one balance reading; delta is computed against the previous
// snapshot, drift compares that delta against credits logged in the window.
import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Activity, Plus, AlertTriangle } from "lucide-react";
import { BalanceSnapshotDialog } from "./BalanceSnapshotDialog";

type DeltaRow = {
  id: string;
  as_of: string;
  prev_as_of: string;
  balance_credits: number;
  prev_balance: number;
  delta_credits: number;
  logged_credits_in_window: number;
  drift_credits: number;
  drift_ratio: number | null;
  drift_band: "match" | "over-logged" | "under-logged" | "no-logged";
  phase_id: string | null;
  subject_type: string | null;
  subject_id: string | null;
  label: string | null;
  source: string | null;
  note: string | null;
};

type AgeRow = {
  latest_as_of: string | null;
  minutes_since_latest: number | null;
  snapshots_24h: number | null;
  entries_since_latest: number | null;
};

type EntryRow = {
  id: string;
  step_label: string;
  credits: number;
  mode: string;
  occurred_at: string;
  note: string | null;
};

function fmtAge(mins: number | null): string {
  if (mins == null) return "—";
  if (mins < 60) return `${mins.toFixed(0)}m`;
  if (mins < 1440) return `${(mins / 60).toFixed(1)}h`;
  return `${(mins / 1440).toFixed(1)}d`;
}

function bandTone(band: DeltaRow["drift_band"]): { variant: "default" | "secondary" | "destructive" | "outline"; label: string } {
  switch (band) {
    case "match": return { variant: "default", label: "match" };
    case "over-logged": return { variant: "secondary", label: "over-logged" };
    case "under-logged": return { variant: "destructive", label: "under-logged" };
    default: return { variant: "outline", label: "no-logged" };
  }
}

export function BalanceTrackingPanel() {
  const [rows, setRows] = useState<DeltaRow[]>([]);
  const [age, setAge] = useState<AgeRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [dlgOpen, setDlgOpen] = useState(false);
  const [drawerRow, setDrawerRow] = useState<DeltaRow | null>(null);
  const [drawerEntries, setDrawerEntries] = useState<EntryRow[]>([]);

  const load = useCallback(async () => {
    setLoading(true);
    const [deltasRes, ageRes] = await Promise.all([
      supabase.from("v_credit_snapshot_deltas")
        .select("id,as_of,prev_as_of,balance_credits,prev_balance,delta_credits,logged_credits_in_window,drift_credits,drift_ratio,drift_band,phase_id,subject_type,subject_id,label,source,note")
        .order("as_of", { ascending: false })
        .limit(20),
      supabase.from("v_credit_snapshot_latest_age")
        .select("latest_as_of,minutes_since_latest,snapshots_24h,entries_since_latest")
        .maybeSingle(),
    ]);
    setRows((deltasRes.data ?? []) as DeltaRow[]);
    setAge((ageRes.data ?? null) as AgeRow | null);
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
    const ch = supabase
      .channel("awip_balance_tracking_panel")
      .on("postgres_changes", { event: "*", schema: "public", table: "credit_balance_snapshots" }, load)
      .on("postgres_changes", { event: "*", schema: "public", table: "credit_entries" }, load)
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [load]);

  const headerWarn = useMemo(() => {
    const mins = age?.minutes_since_latest ?? null;
    const entries = age?.entries_since_latest ?? 0;
    if (mins == null) return null;
    if (mins > 1440 && entries >= 1) return "critical";
    if (mins > 240 && entries >= 3) return "warn";
    return null;
  }, [age]);

  async function openDrawer(row: DeltaRow) {
    setDrawerRow(row);
    setDrawerEntries([]);
    const { data } = await supabase.from("credit_entries")
      .select("id,step_label,credits,mode,occurred_at,note")
      .gt("occurred_at", row.prev_as_of)
      .lte("occurred_at", row.as_of)
      .order("occurred_at", { ascending: false });
    setDrawerEntries((data ?? []) as EntryRow[]);
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-3">
        <div className="space-y-1">
          <CardTitle className="text-base flex items-center gap-2">
            <Activity className="h-4 w-4" /> Per-snapshot tracking
          </CardTitle>
          <div className="text-xs text-muted-foreground flex items-center gap-3 flex-wrap">
            <span>Last snapshot: <strong className="text-foreground">{fmtAge(age?.minutes_since_latest ?? null)} ago</strong></span>
            <span>Entries since last: <strong className="text-foreground">{age?.entries_since_latest ?? 0}</strong></span>
            <span>Snapshots in 24h: <strong className="text-foreground">{age?.snapshots_24h ?? 0}</strong></span>
            {headerWarn && (
              <Badge variant={headerWarn === "critical" ? "destructive" : "secondary"} className="gap-1">
                <AlertTriangle className="h-3 w-3" />
                {headerWarn === "critical" ? "Stale — record now" : "Getting stale"}
              </Badge>
            )}
          </div>
        </div>
        <Button size="sm" onClick={() => setDlgOpen(true)}>
          <Plus className="h-4 w-4 mr-2" /> Record now
        </Button>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>When</TableHead>
              <TableHead>Label / link</TableHead>
              <TableHead className="text-right">Balance</TableHead>
              <TableHead className="text-right">Δ spent</TableHead>
              <TableHead className="text-right">Logged in window</TableHead>
              <TableHead>Drift</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {!loading && rows.length === 0 && (
              <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground py-6">
                Record at least two balance readings to see per-development drift.
              </TableCell></TableRow>
            )}
            {rows.map((r) => {
              const tone = bandTone(r.drift_band);
              const delta = Number(r.delta_credits);
              return (
                <TableRow
                  key={r.id}
                  className="cursor-pointer hover:bg-muted/40"
                  onClick={() => openDrawer(r)}
                >
                  <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                    {new Date(r.as_of).toLocaleString()}
                  </TableCell>
                  <TableCell className="text-xs">
                    {r.label ? <span className="font-medium">{r.label}</span> : <span className="text-muted-foreground italic">no label</span>}
                    {r.subject_type && r.subject_type !== "manual" && (
                      <div className="text-[10px] font-mono text-muted-foreground">
                        {r.subject_type}{r.subject_id ? ` · ${r.subject_id.slice(0, 8)}` : ""}
                      </div>
                    )}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{Number(r.balance_credits).toLocaleString()}</TableCell>
                  <TableCell className={`text-right tabular-nums font-semibold ${delta > 0 ? "text-destructive" : delta < 0 ? "text-emerald-600 dark:text-emerald-400" : ""}`}>
                    {delta > 0 ? "−" : delta < 0 ? "+" : ""}{Math.abs(delta).toFixed(2)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums text-muted-foreground">{Number(r.logged_credits_in_window).toFixed(2)}</TableCell>
                  <TableCell>
                    <Badge variant={tone.variant}>{tone.label}</Badge>
                    {r.drift_ratio != null && (
                      <span className="ml-2 text-[10px] text-muted-foreground tabular-nums">×{Number(r.drift_ratio).toFixed(2)}</span>
                    )}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
        <p className="text-[11px] text-muted-foreground mt-3">
          Δ spent = previous balance − current balance. Drift = Δ ÷ logged credits in the same window.
          <strong> under-logged</strong> means you spent more than you tracked; <strong>over-logged</strong> means logged spend exceeds actual burn.
        </p>
      </CardContent>

      <BalanceSnapshotDialog open={dlgOpen} onOpenChange={setDlgOpen} onSaved={load} />

      <Sheet open={!!drawerRow} onOpenChange={(o) => !o && setDrawerRow(null)}>
        <SheetContent className="w-full sm:max-w-lg overflow-y-auto">
          <SheetHeader>
            <SheetTitle>Window detail</SheetTitle>
            <SheetDescription>
              {drawerRow && (
                <>
                  {new Date(drawerRow.prev_as_of).toLocaleString()} → {new Date(drawerRow.as_of).toLocaleString()}<br />
                  Δ {Number(drawerRow.delta_credits).toFixed(2)} · logged {Number(drawerRow.logged_credits_in_window).toFixed(2)} · drift {Number(drawerRow.drift_credits).toFixed(2)}
                </>
              )}
            </SheetDescription>
          </SheetHeader>
          <div className="mt-4">
            {drawerEntries.length === 0 ? (
              <div className="text-sm text-muted-foreground italic">
                No credit entries logged in this window. Consider adding one for attribution.
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>When</TableHead>
                    <TableHead>Step</TableHead>
                    <TableHead className="text-right">Credits</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {drawerEntries.map((e) => (
                    <TableRow key={e.id}>
                      <TableCell className="text-xs whitespace-nowrap">{new Date(e.occurred_at).toLocaleTimeString()}</TableCell>
                      <TableCell className="text-xs">
                        {e.step_label} <span className="text-muted-foreground">({e.mode})</span>
                        {e.note && <div className="text-[10px] italic text-muted-foreground">{e.note}</div>}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{Number(e.credits).toFixed(2)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </div>
        </SheetContent>
      </Sheet>
    </Card>
  );
}
