import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Activity, AlertTriangle, Gauge } from "lucide-react";

type StepRow = {
  id: string;
  job: string;
  step_key: string;
  status: string;
  duration_ms: number | null;
  started_at: string;
  finished_at: string | null;
};

type P95Row = {
  job: string;
  step_key: string;
  p95_ms: number;
};

type SentinelPerfRow = { check_key: string; p95_ms: number };

export default function TimelineNowChip() {
  const [running, setRunning] = useState(0);
  const [overP95, setOverP95] = useState(0);
  const [slowChecks, setSlowChecks] = useState<SentinelPerfRow[]>([]);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      const sinceHour = new Date(Date.now() - 60 * 60_000).toISOString();
      const [runningRes, recentRes, p95Res, perfRes] = await Promise.all([
        supabase.from("automation_steps").select("id", { count: "exact", head: true }).eq("status", "running"),
        supabase.from("automation_steps")
          .select("id,job,step_key,status,duration_ms,started_at,finished_at")
          .gte("started_at", sinceHour)
          .eq("status", "ok")
          .not("duration_ms", "is", null)
          .limit(500),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        supabase.from("v_automation_step_p95_30d" as any).select("job,step_key,p95_ms"),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (supabase as any).from("v_sentinel_check_perf_24h")
          .select("check_key,p95_ms").order("p95_ms", { ascending: false }).limit(3),
      ]);
      if (cancelled) return;
      setRunning(runningRes.count ?? 0);
      const p95map = new Map<string, number>();
      for (const r of ((p95Res.data ?? []) as unknown) as P95Row[]) {
        p95map.set(`${r.job}|${r.step_key}`, r.p95_ms);
      }
      let over = 0;
      for (const r of ((recentRes.data ?? []) as unknown) as StepRow[]) {
        const p = p95map.get(`${r.job}|${r.step_key}`);
        if (p && r.duration_ms && r.duration_ms > p && (r.duration_ms - p) > 50) over++;
      }
      setOverP95(over);
      setSlowChecks((perfRes.data ?? []) as SentinelPerfRow[]);
    }

    load();
    const t = setInterval(load, 30_000);
    return () => { cancelled = true; clearInterval(t); };
  }, []);

  const slowLabel = slowChecks.length === 0
    ? "no data"
    : slowChecks.map(s => `${s.check_key} ${s.p95_ms}ms`).join(" · ");

  return (
    <div className="inline-flex flex-wrap items-center gap-2">
      <Link
        to="/admin/timeline"
        className="inline-flex items-center gap-2 rounded-md border border-border bg-card px-3 py-1.5 text-xs text-muted-foreground hover:bg-accent transition-colors"
      >
        <Activity className="h-3.5 w-3.5" />
        <span>
          running <span className="font-medium text-foreground">{running}</span>
        </span>
        <span className="opacity-50">·</span>
        <AlertTriangle className={`h-3.5 w-3.5 ${overP95 > 0 ? "text-amber-500" : "opacity-40"}`} />
        <span>
          over p95 <span className={`font-medium ${overP95 > 0 ? "text-amber-500" : "text-foreground"}`}>{overP95}</span> <span className="opacity-60">(1h)</span>
        </span>
      </Link>
      <Link
        to="/admin/sentinel-perf"
        title={slowLabel}
        className="inline-flex items-center gap-2 rounded-md border border-border bg-card px-3 py-1.5 text-xs text-muted-foreground hover:bg-accent transition-colors max-w-[420px]"
      >
        <Gauge className="h-3.5 w-3.5" />
        <span className="opacity-70">slowest checks:</span>
        <span className="truncate font-medium text-foreground">{slowLabel}</span>
      </Link>
    </div>
  );
}
