// Per-closed-phase: opening balance, closing balance, delta vs logged spend,
// and "unaccounted" drift surfacing untracked burn.
import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { GitCompareArrows } from "lucide-react";

type Row = {
  phase_id: string;
  phase_key: string;
  phase_title: string;
  phase_status: string;
  opening_balance: number | null;
  opening_at: string | null;
  closing_balance: number | null;
  closing_at: string | null;
  delta_credits: number | null;
  logged_spend: number;
  unaccounted_credits: number | null;
};

const fmt = (n: number | null | undefined) =>
  n == null ? "—" : Number(n).toLocaleString(undefined, { maximumFractionDigits: 2 });

export function PhaseDeltasPanel() {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const { data } = await supabase.from("v_credit_phase_deltas").select("*").limit(20);
    setRows((data ?? []) as Row[]);
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
    const ch = supabase
      .channel("awip_phase_deltas")
      .on("postgres_changes", { event: "*", schema: "public", table: "credit_balance_snapshots" }, load)
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [load]);

  if (loading || rows.length === 0) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          <GitCompareArrows className="h-4 w-4" /> Per-phase balance deltas
        </CardTitle>
        <p className="text-xs text-muted-foreground">
          Compare what the balance dropped by vs what was logged. Large unaccounted drift = work happening without
          a credit entry.
        </p>
      </CardHeader>
      <CardContent className="p-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Phase</TableHead>
              <TableHead className="text-right">Opening</TableHead>
              <TableHead className="text-right">Closing</TableHead>
              <TableHead className="text-right">Δ balance</TableHead>
              <TableHead className="text-right">Logged</TableHead>
              <TableHead className="text-right">Unaccounted</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r) => {
              const drift = r.unaccounted_credits ?? null;
              const absDrift = drift == null ? 0 : Math.abs(drift);
              const driftTone =
                drift == null ? "" :
                absDrift > 50 ? "text-destructive" :
                absDrift > 10 ? "text-amber-600 dark:text-amber-400" :
                "text-muted-foreground";
              return (
                <TableRow key={r.phase_id}>
                  <TableCell>
                    <div className="font-medium">{r.phase_title}</div>
                    <div className="text-xs text-muted-foreground font-mono">
                      {r.phase_key} · <Badge variant="outline" className="text-[10px]">{r.phase_status}</Badge>
                    </div>
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{fmt(r.opening_balance)}</TableCell>
                  <TableCell className="text-right tabular-nums">{fmt(r.closing_balance)}</TableCell>
                  <TableCell className="text-right tabular-nums">{fmt(r.delta_credits)}</TableCell>
                  <TableCell className="text-right tabular-nums">{fmt(r.logged_spend)}</TableCell>
                  <TableCell className={`text-right tabular-nums ${driftTone}`}>{fmt(drift)}</TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}
