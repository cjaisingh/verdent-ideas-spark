import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { WidgetEmpty, WidgetError, WidgetShell } from "./WidgetShell";
import type { DashboardWidgetProps } from "./types";

type Row = { id: string; title: string; severity: string | null; reviewed_at: string };

export function OpenRisksWidget({ size, onOpen }: DashboardWidgetProps) {
  const navigate = useNavigate();
  const [rows, setRows] = useState<Row[] | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      const { data, error } = await supabase
        .from("roadmap_review_findings")
        .select("id,title,severity,reviewed_at")
        .eq("acknowledged", false)
        .order("reviewed_at", { ascending: false })
        .limit(20);
      if (cancelled) return;
      if (error) setError(true);
      else setRows((data ?? []) as Row[]);
    };
    load();
    return () => {
      cancelled = true;
    };
  }, []);

  const max = size === "lg" ? 8 : size === "md" ? 4 : 2;
  const total = rows?.length ?? 0;
  const high = rows?.filter((r) => r.severity === "high" || r.severity === "critical").length ?? 0;

  return (
    <WidgetShell title="Open risks" onOpen={onOpen ?? (() => navigate("/roadmap/risks"))} scrollable={size === "lg"}>
      {error ? (
        <WidgetError />
      ) : !rows ? (
        <WidgetEmpty>Loading…</WidgetEmpty>
      ) : total === 0 ? (
        <WidgetEmpty>No open findings.</WidgetEmpty>
      ) : (
        <div className="space-y-1.5">
          <div className="flex items-baseline gap-2">
            <span className="text-2xl font-semibold tabular-nums">{total}</span>
            <span className="text-xs text-muted-foreground">open</span>
            {high > 0 && (
              <span className="ml-auto text-[10px] font-medium text-destructive">{high} high+</span>
            )}
          </div>
          <ul className="space-y-1 text-xs">
            {rows.slice(0, max).map((r) => (
              <li key={r.id} className="flex items-center gap-2">
                <span
                  className={`h-1.5 w-1.5 shrink-0 rounded-full ${
                    r.severity === "critical" || r.severity === "high"
                      ? "bg-destructive"
                      : r.severity === "medium"
                        ? "bg-amber-500"
                        : "bg-muted-foreground"
                  }`}
                />
                <span className="truncate flex-1">{r.title}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </WidgetShell>
  );
}
