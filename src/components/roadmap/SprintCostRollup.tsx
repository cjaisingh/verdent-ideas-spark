// Per-sprint cost rollup driven by v_ai_cost_per_sprint.
// Honest about attribution: shows attributed_calls so the operator can see
// how much of the spend has actually been tied to a task vs left in module-only.
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { Coins } from "lucide-react";

type Row = {
  sprint_id: string;
  sprint_key: string;
  sprint_title: string;
  sprint_status: string;
  sprint_order: number | null;
  task_count: number;
  tasks_done: number;
  attributed_calls: number;
  attributed_tokens: number;
  attributed_cost_usd: number;
  cost_per_done_task_usd: number | null;
};

const fmtTokens = (n: number) =>
  n >= 1_000_000 ? `${(n / 1_000_000).toFixed(2)}M`
  : n >= 1_000 ? `${(n / 1_000).toFixed(1)}k`
  : String(n);
const fmtUsd = (n: number) => `$${n.toFixed(n < 1 ? 4 : 2)}`;

const SprintCostRollup = () => {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      const { data, error } = await supabase
        .from("v_ai_cost_per_sprint")
        .select("*")
        .order("sprint_order", { ascending: true, nullsFirst: false });
      if (!alive) return;
      if (error) setError(error.message);
      else setRows((data ?? []) as Row[]);
    })();
    return () => { alive = false; };
  }, []);

  const totals = useMemo(() => {
    if (!rows) return null;
    return rows.reduce(
      (a, r) => ({
        cost: a.cost + Number(r.attributed_cost_usd ?? 0),
        tokens: a.tokens + Number(r.attributed_tokens ?? 0),
        calls: a.calls + Number(r.attributed_calls ?? 0),
        done: a.done + Number(r.tasks_done ?? 0),
      }),
      { cost: 0, tokens: 0, calls: 0, done: 0 },
    );
  }, [rows]);

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <Coins className="h-4 w-4 text-muted-foreground" />
          Sprint cost-effectiveness
        </CardTitle>
        <p className="text-xs text-muted-foreground">
          Tokens and AI-gateway dollars attributed per sprint via{" "}
          <code className="text-[10px]">ai_usage_log.task_id</code>. Forward-only:
          historical rows show 0 calls until callers start passing <code className="text-[10px]">task_id</code>.
          See raw spend on{" "}
          <Link to="/admin/ai-usage" className="underline">/admin/ai-usage</Link>.
        </p>
      </CardHeader>
      <CardContent className="pt-0">
        {error && <p className="text-sm text-destructive">Failed to load: {error}</p>}
        {!rows && !error && <Skeleton className="h-40 w-full" />}
        {rows && rows.length === 0 && (
          <p className="text-sm text-muted-foreground">No sprints found.</p>
        )}
        {rows && rows.length > 0 && (
          <>
            {totals && (
              <div className="mb-3 flex flex-wrap gap-2 text-xs">
                <Badge variant="secondary">Attributed total: {fmtUsd(totals.cost)}</Badge>
                <Badge variant="outline">{fmtTokens(totals.tokens)} tokens</Badge>
                <Badge variant="outline">{totals.calls} calls</Badge>
                <Badge variant="outline">{totals.done} done tasks</Badge>
              </div>
            )}
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Sprint</TableHead>
                    <TableHead className="text-right">Tasks (done / total)</TableHead>
                    <TableHead className="text-right">Calls</TableHead>
                    <TableHead className="text-right">Tokens</TableHead>
                    <TableHead className="text-right">$ cost</TableHead>
                    <TableHead className="text-right">$ / done task</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((r) => (
                    <TableRow key={r.sprint_id}>
                      <TableCell className="font-medium">
                        <div className="flex items-center gap-2">
                          <code className="text-[10px] text-muted-foreground">{r.sprint_key}</code>
                          <span className="text-sm">{r.sprint_title}</span>
                          <Badge variant="outline" className="text-[9px] uppercase">{r.sprint_status}</Badge>
                        </div>
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {r.tasks_done} / {r.task_count}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{r.attributed_calls}</TableCell>
                      <TableCell className="text-right tabular-nums">
                        {fmtTokens(Number(r.attributed_tokens ?? 0))}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {fmtUsd(Number(r.attributed_cost_usd ?? 0))}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {r.cost_per_done_task_usd != null
                          ? fmtUsd(Number(r.cost_per_done_task_usd))
                          : <span className="text-muted-foreground">—</span>}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
};

export default SprintCostRollup;
