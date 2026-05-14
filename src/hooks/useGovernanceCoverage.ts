import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

type Coverage = { pct: number | null; total: number; withEntity: number } | null;

let cache: { ts: number; value: Coverage } | null = null;
const TTL_MS = 5 * 60 * 1000;

export function useGovernanceCoverage(days = 30): Coverage {
  const [value, setValue] = useState<Coverage>(cache?.value ?? null);

  useEffect(() => {
    if (cache && Date.now() - cache.ts < TTL_MS) {
      setValue(cache.value);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const { data, error } = await supabase.rpc("governance_coverage", { _days: days });
        if (error || !data) return;
        const obj = data as { tasks_shipped?: number; with_entity?: number };
        const total = Number(obj.tasks_shipped ?? 0);
        const withEntity = Number(obj.with_entity ?? 0);
        const pct = total > 0 ? Math.round((withEntity / total) * 100) : null;
        const next = { pct, total, withEntity };
        cache = { ts: Date.now(), value: next };
        if (!cancelled) setValue(next);
      } catch {
        /* ignore */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [days]);

  return value;
}
