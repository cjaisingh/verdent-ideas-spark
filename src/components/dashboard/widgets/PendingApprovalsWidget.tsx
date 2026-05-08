import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { WidgetEmpty, WidgetError, WidgetShell, WidgetSkeleton } from "./WidgetShell";
import type { DashboardWidgetProps } from "./types";

type Row = { id: string; activity: string; risk: string | null; created_at: string };

export function PendingApprovalsWidget({ size, onOpen }: DashboardWidgetProps) {
  const navigate = useNavigate();
  const [rows, setRows] = useState<Row[] | null>(null);
  const [error, setError] = useState(false);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    setError(false);
    const { data, error } = await supabase
      .from("approval_queue")
      .select("id,activity,risk,created_at")
      .eq("status", "pending")
      .order("created_at", { ascending: false })
      .limit(20);
    if (error) setError(true);
    else setRows((data ?? []) as Row[]);
    setLoading(false);
  }, []);

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      if (cancelled) return;
      await load();
    };
    run();
    const ch = supabase
      .channel("widget_pending_approvals")
      .on("postgres_changes", { event: "*", schema: "public", table: "approval_queue" }, () => load())
      .subscribe();
    return () => {
      cancelled = true;
      supabase.removeChannel(ch);
    };
  }, [load]);

  const max = size === "lg" ? 8 : size === "md" ? 4 : 2;
  const total = rows?.length ?? 0;

  return (
    <WidgetShell title="Pending approvals" onOpen={onOpen ?? (() => navigate("/admin"))} scrollable={size === "lg"}>
      {error ? (
        <WidgetError onRetry={load} />
      ) : loading && !rows ? (
        <WidgetSkeleton rows={max} />
      ) : total === 0 ? (
        <WidgetEmpty>All clear.</WidgetEmpty>
      ) : (
        <div className="space-y-1.5">
          <div className="flex items-baseline gap-2">
            <span className="text-2xl font-semibold tabular-nums">{total}</span>
            <span className="text-xs text-muted-foreground">waiting</span>
          </div>
          <ul className="divide-y divide-border text-xs">
            {rows!.slice(0, max).map((r) => (
              <li key={r.id} className="flex items-center gap-2 py-1">
                <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-amber-500" />
                <span className="truncate flex-1">{r.activity}</span>
                {r.risk && <span className="font-mono text-[10px] text-muted-foreground shrink-0">{r.risk}</span>}
              </li>
            ))}
          </ul>
        </div>
      )}
    </WidgetShell>
  );
}
