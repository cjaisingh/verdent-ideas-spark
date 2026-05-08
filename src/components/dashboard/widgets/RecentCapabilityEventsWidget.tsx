import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { WidgetEmpty, WidgetError, WidgetShell } from "./WidgetShell";
import type { DashboardWidgetProps } from "./types";

type Row = { id: string; event_type: string; capability_id: string | null; created_at: string };

export function RecentCapabilityEventsWidget({ size, onOpen }: DashboardWidgetProps) {
  const navigate = useNavigate();
  const [rows, setRows] = useState<Row[] | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      const { data, error } = await supabase
        .from("capability_events")
        .select("id,event_type,capability_id,created_at")
        .order("created_at", { ascending: false })
        .limit(10);
      if (cancelled) return;
      if (error) setError(true);
      else setRows((data ?? []) as Row[]);
    };
    load();
    const ch = supabase
      .channel("widget_capability_events")
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "capability_events" }, () => load())
      .subscribe();
    return () => {
      cancelled = true;
      supabase.removeChannel(ch);
    };
  }, []);

  const max = size === "lg" ? 8 : size === "md" ? 5 : 3;

  return (
    <WidgetShell title="Recent capability events" onOpen={onOpen ?? (() => navigate("/capabilities"))} scrollable={size === "lg"}>
      {error ? (
        <WidgetError />
      ) : !rows ? (
        <WidgetEmpty>Loading…</WidgetEmpty>
      ) : rows.length === 0 ? (
        <WidgetEmpty>No recent events.</WidgetEmpty>
      ) : (
        <ul className="space-y-1 text-xs">
          {rows.slice(0, max).map((r) => (
            <li key={r.id} className="flex items-center gap-2">
              <span className="font-mono text-[10px] text-muted-foreground shrink-0">
                {new Date(r.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
              </span>
              <span className="truncate flex-1">{r.event_type}</span>
            </li>
          ))}
        </ul>
      )}
    </WidgetShell>
  );
}
