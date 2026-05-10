import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Activity } from "lucide-react";

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

const ago = (iso: string) => {
  const diff = Date.now() - new Date(iso).getTime();
  const h = Math.floor(diff / 3_600_000);
  if (h < 1) return `${Math.max(1, Math.floor(diff / 60_000))}m ago`;
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
};

/**
 * Tiny visibility chip: how many work-log entries this week + when the last one was.
 * If there hasn't been a log in >24h while a sprint is active, tints amber so drift is obvious.
 */
export const WorkLogPulse = () => {
  const [count, setCount] = useState<number | null>(null);
  const [last, setLast] = useState<string | null>(null);

  const load = async () => {
    const since = new Date(Date.now() - WEEK_MS).toISOString();
    const { data } = await supabase
      .from("roadmap_work_log")
      .select("created_at")
      .gte("created_at", since)
      .order("created_at", { ascending: false })
      .limit(200);
    setCount(data?.length ?? 0);
    setLast(data?.[0]?.created_at ?? null);
  };

  useEffect(() => {
    load();
    // Unique channel name per mount — supabase-js caches channels by name and a
    // StrictMode/HMR remount that hits a still-cached `joined` channel throws
    // "cannot add postgres_changes callbacks ... after subscribe()".
    const channel = supabase
      .channel(`work_log_pulse:${crypto.randomUUID()}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "roadmap_work_log" },
        () => load(),
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  const stale = last ? Date.now() - new Date(last).getTime() > 24 * 3_600_000 : true;
  const tone = count === 0 || stale
    ? "border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-400"
    : "border-border bg-muted/40 text-muted-foreground";

  return (
    <div
      className={`rounded-md border ${tone} px-3 py-2 flex items-center gap-2`}
      title={
        count === 0
          ? "No turns logged in the last 7 days — meta-work is drifting from the roadmap."
          : stale
            ? "No turns logged in over 24 hours."
            : "Recent activity is being logged."
      }
    >
      <Activity className="h-3.5 w-3.5" />
      <div className="text-left leading-tight">
        <div className="text-[10px] uppercase tracking-wide">This week</div>
        <div className="text-sm font-mono tabular-nums">
          {count ?? "…"}{" "}
          <span className="text-[10px] uppercase tracking-wide">
            {count === 1 ? "log" : "logs"}
          </span>
          {last && <span className="ml-1 text-[10px]">· last {ago(last)}</span>}
        </div>
      </div>
    </div>
  );
};
