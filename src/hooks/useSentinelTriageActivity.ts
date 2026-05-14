import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

export type TriageActivityRow = {
  id: string;
  action_id: string;
  action_short_num: number | null;
  action_title: string | null;
  event_kind: "group_formed" | "group_grew";
  finding_count: number;
  finding_ids: string[];
  triggered_by_label: string | null;
  acknowledged_by: string[];
  created_at: string;
};

export function useTriageUnackedCount() {
  const [count, setCount] = useState<number>(0);

  const refresh = useCallback(async () => {
    const { data, error } = await supabase.rpc("sentinel_triage_unacked_count");
    if (!error && typeof data === "number") setCount(data);
  }, []);

  useEffect(() => {
    refresh();
    const ch = supabase
      .channel("sentinel-triage-badge")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "sentinel_triage_activity" },
        () => refresh(),
      )
      .subscribe();
    const t = setInterval(refresh, 60_000);
    return () => {
      supabase.removeChannel(ch);
      clearInterval(t);
    };
  }, [refresh]);

  return { count, refresh };
}

export function useTriageActivity(limit = 50) {
  const [rows, setRows] = useState<TriageActivityRow[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    const { data } = await supabase
      .from("sentinel_triage_activity")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(limit);
    setRows((data ?? []) as TriageActivityRow[]);
    setLoading(false);
  }, [limit]);

  useEffect(() => {
    refresh();
    const ch = supabase
      .channel("sentinel-triage-feed")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "sentinel_triage_activity" },
        () => refresh(),
      )
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
  }, [refresh]);

  return { rows, loading, refresh };
}

export async function acknowledgeTriage(id: string) {
  await supabase.rpc("acknowledge_triage_activity", { _id: id });
}

export async function acknowledgeAllTriage() {
  await supabase.rpc("acknowledge_all_triage_activity");
}
