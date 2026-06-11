// Lightweight per-source "has data" signals used by the layout to:
//   1. Show a subtle dot on the right/bottom pane toggles when a hidden pane
//      currently holds something worth looking at.
//   2. Auto-open the corresponding pane on first visit per route per session.
//
// Each query is small (head:count, narrow filter) and refreshes on a 60s
// interval plus realtime pings on the underlying tables.
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { PaneSourceId } from "@/components/panes/sources";

export type PaneDataSignals = Record<PaneSourceId, { count: number; hasData: boolean }>;

const EMPTY: PaneDataSignals = {
  "night-agent": { count: 0, hasData: false },
  "event-ticker": { count: 0, hasData: false },
  approvals: { count: 0, hasData: false },
  "discussion-actions": { count: 0, hasData: false },
};

async function countRows(builder: any): Promise<number> {
  const { count, error } = await builder;
  if (error) return 0;
  return count ?? 0;
}

export function usePaneDataSignals(): PaneDataSignals {
  const [signals, setSignals] = useState<PaneDataSignals>(EMPTY);

  useEffect(() => {
    let cancelled = false;
    const since1h = () => new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const since24h = () => new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

    const refresh = async () => {
      const [night, events, approvals, actions] = await Promise.all([
        countRows(
          supabase
            .from("night_observations" as any)
            .select("id", { count: "exact", head: true })
            .gte("created_at", since24h()),
        ),
        countRows(
          supabase
            .from("okr_node_events" as any)
            .select("id", { count: "exact", head: true })
            .gte("created_at", since1h()),
        ),
        countRows(
          supabase
            .from("approval_queue" as any)
            .select("id", { count: "exact", head: true })
            .eq("status", "pending"),
        ),
        countRows(
          supabase
            .from("discussion_actions" as any)
            .select("id", { count: "exact", head: true })
            .in("status", ["open", "in_progress"]),
        ),
      ]);
      if (cancelled) return;
      setSignals({
        "night-agent": { count: night, hasData: night > 0 },
        "event-ticker": { count: events, hasData: events > 0 },
        approvals: { count: approvals, hasData: approvals > 0 },
        "discussion-actions": { count: actions, hasData: actions > 0 },
      });
    };

    refresh();
    const interval = window.setInterval(refresh, 60_000);
    const ch = supabase
      .channel(`pane-data-signals-${crypto.randomUUID()}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "approval_queue" }, refresh)
      .on("postgres_changes", { event: "*", schema: "public", table: "discussion_actions" }, refresh)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "night_observations" }, refresh)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "okr_node_events" }, refresh)
      .subscribe();

    return () => {
      cancelled = true;
      window.clearInterval(interval);
      supabase.removeChannel(ch);
    };
  }, []);

  return signals;
}
