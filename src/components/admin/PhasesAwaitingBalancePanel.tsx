// Phases marked done in the last 14d that don't yet have a balance snapshot.
// This is the "end-of-phase prompt" surface — every closed phase nags until logged.
import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ClipboardCheck } from "lucide-react";
import { BalanceSnapshotDialog } from "./BalanceSnapshotDialog";

type Row = {
  phase_id: string;
  phase_key: string;
  phase_title: string;
  closed_at: string;
  hours_since_close: number;
};

export function PhasesAwaitingBalancePanel() {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [active, setActive] = useState<Row | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const { data } = await supabase.from("v_phases_awaiting_balance").select("*");
    setRows((data ?? []) as Row[]);
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
    const ch = supabase
      .channel("awip_phases_awaiting_balance")
      .on("postgres_changes", { event: "*", schema: "public", table: "credit_balance_snapshots" }, load)
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "roadmap_phases" }, load)
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [load]);

  if (loading || rows.length === 0) return null;

  return (
    <Card className="border-amber-500/40 bg-amber-500/5">
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2">
          <ClipboardCheck className="h-4 w-4 text-amber-600 dark:text-amber-400" />
          Phases awaiting balance snapshot
          <Badge variant="secondary" className="ml-1">{rows.length}</Badge>
        </CardTitle>
        <p className="text-xs text-muted-foreground">
          Record what Lovable showed as your remaining credits when each phase closed. Drives the per-phase delta report.
        </p>
      </CardHeader>
      <CardContent className="p-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Phase</TableHead>
              <TableHead>Closed</TableHead>
              <TableHead className="text-right">Action</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r) => (
              <TableRow key={r.phase_id}>
                <TableCell>
                  <div className="font-medium">{r.phase_title}</div>
                  <div className="text-xs text-muted-foreground font-mono">{r.phase_key}</div>
                </TableCell>
                <TableCell className="text-xs text-muted-foreground">
                  {new Date(r.closed_at).toLocaleString()} · {Math.round(r.hours_since_close)}h ago
                </TableCell>
                <TableCell className="text-right">
                  <Button size="sm" onClick={() => setActive(r)}>Record balance</Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>

      <BalanceSnapshotDialog
        open={!!active}
        onOpenChange={(o) => { if (!o) setActive(null); }}
        phaseId={active?.phase_id ?? null}
        phaseLabel={active ? `${active.phase_key} — ${active.phase_title}` : null}
        onSaved={load}
      />
    </Card>
  );
}
