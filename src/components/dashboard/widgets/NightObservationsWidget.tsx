import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { WidgetEmpty, WidgetError, WidgetShell } from "./WidgetShell";
import type { DashboardWidgetProps } from "./types";

type Row = { id: string; created_at: string; severity: string | null; kind: string | null; summary: string | null };

export function NightObservationsWidget({ size, onOpen }: DashboardWidgetProps) {
  const navigate = useNavigate();
  const [rows, setRows] = useState<Row[] | null>(null);
  const [count, setCount] = useState<number>(0);
  const [error, setError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
      const { data, error, count } = await supabase
        .from("night_observations")
        .select("id,created_at,severity,kind,summary", { count: "exact" })
        .gte("created_at", since)
        .order("created_at", { ascending: false })
        .limit(10);
      if (cancelled) return;
      if (error) {
        setError(true);
        return;
      }
      setRows((data ?? []) as Row[]);
      setCount(count ?? 0);
    };
    load();
    const ch = supabase
      .channel("widget_night_obs")
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "night_observations" }, () => load())
      .subscribe();
    return () => {
      cancelled = true;
      supabase.removeChannel(ch);
    };
  }, []);

  const max = size === "lg" ? 6 : size === "md" ? 3 : 2;

  return (
    <WidgetShell title="Night observations · 24h" onOpen={onOpen ?? (() => navigate("/night-shifts"))} scrollable={size === "lg"}>
      {error ? (
        <WidgetError />
      ) : !rows ? (
        <WidgetEmpty>Loading…</WidgetEmpty>
      ) : count === 0 ? (
        <WidgetEmpty>No observations in the last 24h.</WidgetEmpty>
      ) : (
        <div className="space-y-1.5">
          <div className="flex items-baseline gap-2">
            <span className="text-2xl font-semibold tabular-nums">{count}</span>
            <span className="text-xs text-muted-foreground">observations</span>
          </div>
          <ul className="space-y-1 text-xs">
            {rows.slice(0, max).map((r) => (
              <li key={r.id} className="flex items-center gap-2">
                <span
                  className={`h-1.5 w-1.5 shrink-0 rounded-full ${
                    r.severity === "high"
                      ? "bg-destructive"
                      : r.severity === "medium"
                        ? "bg-amber-500"
                        : "bg-emerald-500"
                  }`}
                />
                <span className="truncate flex-1">{r.summary ?? r.kind ?? "observation"}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </WidgetShell>
  );
}
