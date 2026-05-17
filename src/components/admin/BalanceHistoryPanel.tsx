// History of operator-entered balance snapshots, with a small line chart.
import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Plus, Wallet } from "lucide-react";
import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid } from "recharts";
import { BalanceSnapshotDialog } from "./BalanceSnapshotDialog";

type Snapshot = {
  id: string;
  balance_credits: number;
  as_of: string;
  phase_id: string | null;
  source: string | null;
  note: string | null;
};

export function BalanceHistoryPanel() {
  const [rows, setRows] = useState<Snapshot[]>([]);
  const [loading, setLoading] = useState(true);
  const [dlgOpen, setDlgOpen] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const { data } = await supabase
      .from("credit_balance_snapshots")
      .select("id,balance_credits,as_of,phase_id,source,note")
      .order("as_of", { ascending: false })
      .limit(50);
    setRows((data ?? []) as Snapshot[]);
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
    const ch = supabase
      .channel("awip_balance_history")
      .on("postgres_changes", { event: "*", schema: "public", table: "credit_balance_snapshots" }, load)
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [load]);

  const chartData = [...rows]
    .sort((a, b) => +new Date(a.as_of) - +new Date(b.as_of))
    .map((r) => ({ t: r.as_of.slice(5, 16), balance: Number(r.balance_credits) }));

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <Wallet className="h-4 w-4" /> Balance history
        </CardTitle>
        <Button size="sm" onClick={() => setDlgOpen(true)}>
          <Plus className="h-4 w-4 mr-2" /> Record balance
        </Button>
      </CardHeader>
      <CardContent className="space-y-4">
        {chartData.length >= 2 && (
          <div className="h-[180px]">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                <XAxis dataKey="t" className="text-xs" />
                <YAxis className="text-xs" />
                <Tooltip contentStyle={{ background: "hsl(var(--popover))", border: "1px solid hsl(var(--border))" }} />
                <Line type="monotone" dataKey="balance" stroke="hsl(var(--primary))" strokeWidth={2} dot />
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>When</TableHead>
              <TableHead className="text-right">Balance</TableHead>
              <TableHead>Phase</TableHead>
              <TableHead>Source / note</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {!loading && rows.length === 0 && (
              <TableRow><TableCell colSpan={4} className="text-center text-muted-foreground py-6">No snapshots yet. Record one to enable runway estimates.</TableCell></TableRow>
            )}
            {rows.map((r) => (
              <TableRow key={r.id}>
                <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                  {new Date(r.as_of).toLocaleString()}
                </TableCell>
                <TableCell className="text-right tabular-nums font-semibold">{Number(r.balance_credits).toLocaleString()}</TableCell>
                <TableCell className="text-xs font-mono">{r.phase_id ? r.phase_id.slice(0, 8) : "—"}</TableCell>
                <TableCell className="text-xs text-muted-foreground">
                  {r.source ?? ""}
                  {r.note ? <div className="italic">{r.note}</div> : null}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>

      <BalanceSnapshotDialog open={dlgOpen} onOpenChange={setDlgOpen} onSaved={load} />
    </Card>
  );
}
