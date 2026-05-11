import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

export type TriageKind =
  | "panel"
  | "discussion_action"
  | "sentinel_finding"
  | "code_review_finding"
  | "cron_stuck"
  | "deferred"
  | "promotion_drift"
  | "night_throughput";

export type TriageState = "focus" | "revisit" | "done" | "skip";

export type TriageRow = {
  item_kind: TriageKind;
  item_ref: string;
  state: TriageState;
};

const key = (k: TriageKind, r: string) => `${k}::${r}`;

export function useMorningReviewTriage() {
  const [map, setMap] = useState<Record<string, TriageState>>({});
  const [loading, setLoading] = useState(true);
  const channelId = useRef(`mr-triage-${Math.random().toString(36).slice(2)}`);

  const load = useCallback(async () => {
    const { data } = await supabase
      .from("morning_review_triage_active" as never)
      .select("item_kind,item_ref,state");
    const next: Record<string, TriageState> = {};
    for (const r of (data ?? []) as TriageRow[]) {
      next[key(r.item_kind, r.item_ref)] = r.state;
    }
    setMap(next);
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
    const ch = supabase
      .channel(channelId.current)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "morning_review_triage" },
        () => load(),
      )
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
  }, [load]);

  const getState = useCallback(
    (kind: TriageKind, ref: string): TriageState | undefined =>
      map[key(kind, ref)],
    [map],
  );

  const setState = useCallback(
    async (kind: TriageKind, ref: string, state: TriageState | null) => {
      const k = key(kind, ref);
      const prev = map[k];
      // optimistic
      setMap((m) => {
        const next = { ...m };
        if (state) next[k] = state;
        else delete next[k];
        return next;
      });
      try {
        if (state === null) {
          await supabase
            .from("morning_review_triage")
            .update({ cleared_at: new Date().toISOString() })
            .eq("item_kind", kind)
            .eq("item_ref", ref)
            .is("cleared_at", null);
        } else {
          const { data: u } = await supabase.auth.getUser();
          await supabase.from("morning_review_triage").insert({
            item_kind: kind,
            item_ref: ref,
            state,
            set_by: u.user?.id ?? null,
          });
        }
      } catch (e) {
        // revert
        setMap((m) => {
          const next = { ...m };
          if (prev) next[k] = prev;
          else delete next[k];
          return next;
        });
        throw e;
      }
    },
    [map],
  );

  const counts = useMemo(() => {
    const c = { focus: 0, revisit: 0, done: 0, skip: 0 } as Record<TriageState, number>;
    for (const v of Object.values(map)) c[v]++;
    return c;
  }, [map]);

  return { loading, getState, setState, map, counts };
}
