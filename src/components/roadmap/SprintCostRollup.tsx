// Per-sprint cost rollup driven by v_ai_cost_per_sprint.
// Click a row to drill into per-task token + cost breakdown from v_ai_cost_per_task.
import { Fragment, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { Coins, ChevronRight, ChevronDown } from "lucide-react";

type TaskRow = {
  task_id: string;
  sprint_id: string;
  task_title: string;
  task_status: string;
  module: string | null;
  call_count: number;
  tokens_in: number;
  tokens_out: number;
  tokens_total: number;
  cost_usd: number;
  last_used_at: string | null;
};

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
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [taskRows, setTaskRows] = useState<Record<string, TaskRow[] | "loading" | { error: string }>>({});

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

  const toggleSprint = async (sprintId: string) => {
    const next = new Set(expanded);
    if (next.has(sprintId)) {
      next.delete(sprintId);
      setExpanded(next);
      return;
    }
    next.add(sprintId);
    setExpanded(next);
    if (taskRows[sprintId] && taskRows[sprintId] !== "loading" && !("error" in (taskRows[sprintId] as object))) return;
    setTaskRows((s) => ({ ...s, [sprintId]: "loading" }));
    const { data, error } = await supabase
      .from("v_ai_cost_per_task")
      .select("*")
      .eq("sprint_id", sprintId)
      .order("cost_usd", { ascending: false });
    if (error) setTaskRows((s) => ({ ...s, [sprintId]: { error: error.message } }));
    else setTaskRows((s) => ({ ...s, [sprintId]: (data ?? []) as TaskRow[] }));
  };

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
                    <TableHead className="w-8"></TableHead>
                    <TableHead>Sprint</TableHead>
                    <TableHead className="text-right">Tasks (done / total)</TableHead>
                    <TableHead className="text-right">Calls</TableHead>
                    <TableHead className="text-right">Tokens</TableHead>
                    <TableHead className="text-right">$ cost</TableHead>
                    <TableHead className="text-right">$ / done task</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((r) => {
                    const isOpen = expanded.has(r.sprint_id);
                    const tr = taskRows[r.sprint_id];
                    return (
                      <Fragment key={r.sprint_id}>
                        <TableRow
                          key={r.sprint_id}
                          className="cursor-pointer hover:bg-muted/50"
                          onClick={() => toggleSprint(r.sprint_id)}
                        >
                          <TableCell className="pr-0">
                            {isOpen
                              ? <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
                              : <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />}
                          </TableCell>
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
                        {isOpen && (
                          <TableRow key={`${r.sprint_id}-drill`} className="bg-muted/30 hover:bg-muted/30">
                            <TableCell></TableCell>
                            <TableCell colSpan={6} className="py-2">
                              {tr === "loading" && <Skeleton className="h-16 w-full" />}
                              {tr && typeof tr === "object" && "error" in tr && (
                                <p className="text-xs text-destructive">Failed: {tr.error}</p>
                              )}
                              {Array.isArray(tr) && tr.length === 0 && (
                                <p className="text-xs text-muted-foreground">No tasks in this sprint.</p>
                              )}
                              {Array.isArray(tr) && tr.length > 0 && (
                                <div className="overflow-x-auto">
                                  <Table>
                                    <TableHeader>
                                      <TableRow>
                                        <TableHead>Task</TableHead>
                                        <TableHead>Module</TableHead>
                                        <TableHead className="text-right">Calls</TableHead>
                                        <TableHead className="text-right">Tokens in</TableHead>
                                        <TableHead className="text-right">Tokens out</TableHead>
                                        <TableHead className="text-right">Tokens total</TableHead>
                                        <TableHead className="text-right">$ cost</TableHead>
                                        <TableHead className="text-right">Last used</TableHead>
                                      </TableRow>
                                    </TableHeader>
                                    <TableBody>
                                      {tr.map((t) => (
                                        <TableRow key={t.task_id}>
                                          <TableCell>
                                            <div className="flex items-center gap-2">
                                              <span className="text-sm">{t.task_title}</span>
                                              <Badge variant="outline" className="text-[9px] uppercase">{t.task_status}</Badge>
                                            </div>
                                          </TableCell>
                                          <TableCell className="text-xs text-muted-foreground font-mono">
                                            {t.module ?? "—"}
                                          </TableCell>
                                          <TableCell className="text-right tabular-nums">{t.call_count}</TableCell>
                                          <TableCell className="text-right tabular-nums">{fmtTokens(Number(t.tokens_in ?? 0))}</TableCell>
                                          <TableCell className="text-right tabular-nums">{fmtTokens(Number(t.tokens_out ?? 0))}</TableCell>
                                          <TableCell className="text-right tabular-nums">{fmtTokens(Number(t.tokens_total ?? 0))}</TableCell>
                                          <TableCell className="text-right tabular-nums">
                                            {Number(t.cost_usd ?? 0) > 0
                                              ? fmtUsd(Number(t.cost_usd))
                                              : <span className="text-muted-foreground">—</span>}
                                          </TableCell>
                                          <TableCell className="text-right text-xs text-muted-foreground">
                                            {t.last_used_at ? new Date(t.last_used_at).toLocaleDateString() : "—"}
                                          </TableCell>
                                        </TableRow>
                                      ))}
                                    </TableBody>
                                  </Table>
                                </div>
                              )}
                            </TableCell>
                          </TableRow>
                        )}
                      </>
                    );
                  })}
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
