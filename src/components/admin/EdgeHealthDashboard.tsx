// Edge function health & error-rate dashboard for the W2/W3/W4 jobs.
// Reads recent automation_runs rows for the three jobs and renders:
//   - per-job KPI card: success rate (1h / 24h / 7d), p50/p95 duration,
//     last success, last error, total runs in window
//   - 24h timeline bar (one cell per hour, green=ok, red=error, grey=none)
//   - last-N errors list with message + status code

import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Activity, AlertTriangle, CheckCircle2, Loader2, RefreshCw } from "lucide-react";

const JOBS = [
  { name: "morning-review", label: "Morning Review (W2)" },
  { name: "sentinel-tick", label: "Sentinel Agent (W3)" },
  { name: "lessons-synthesize", label: "Lessons Loop (W4)" },
] as const;
type JobName = typeof JOBS[number]["name"];

type Run = {
  id: string;
  job: string;
  status: string;
  status_code: number | null;
  message: string | null;
  duration_ms: number | null;
  created_at: string;
};

const LOOKBACK_HOURS = 24 * 7;
const isOk = (r: Run) => r.status === "ok" && (r.status_code ?? 0) < 400;

function p(rs: Run[], q: number) {
  const xs = rs.map((r) => r.duration_ms ?? 0).filter((x) => x > 0).sort((a, b) => a - b);
  if (!xs.length) return null;
  const i = Math.min(xs.length - 1, Math.floor(q * xs.length));
  return xs[i];
}

function rel(iso: string | null) {
  if (!iso) return "—";
  const m = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

function rate(rs: Run[]) {
  if (!rs.length) return null;
  const ok = rs.filter(isOk).length;
  return ok / rs.length;
}

function rateColor(r: number | null) {
  if (r == null) return "text-muted-foreground";
  if (r >= 0.99) return "text-emerald-600 dark:text-emerald-400";
  if (r >= 0.9) return "text-amber-600 dark:text-amber-400";
  return "text-destructive";
}

function HourTimeline({ runs }: { runs: Run[] }) {
  // 24 cells, newest on right
  const cells = useMemo(() => {
    const now = Date.now();
    const out: { hour: number; ok: number; err: number }[] = [];
    for (let i = 23; i >= 0; i--) {
      const start = now - (i + 1) * 3600_000;
      const end = now - i * 3600_000;
      const inHour = runs.filter((r) => {
        const t = +new Date(r.created_at);
        return t >= start && t < end;
      });
      out.push({
        hour: i,
        ok: inHour.filter(isOk).length,
        err: inHour.filter((r) => !isOk(r)).length,
      });
    }
    return out;
  }, [runs]);
  return (
    <div className="flex gap-0.5 h-5" aria-label="24h timeline">
      {cells.map((c, i) => {
        const cls =
          c.err > 0
            ? "bg-destructive/80"
            : c.ok > 0
              ? "bg-emerald-500/70"
              : "bg-muted/40";
        const total = c.ok + c.err;
        return (
          <div
            key={i}
            className={`flex-1 rounded-sm ${cls}`}
            title={`${c.hour}h ago · ${total} run(s)${c.err ? ` · ${c.err} error(s)` : ""}`}
          />
        );
      })}
    </div>
  );
}

export default function EdgeHealthDashboard() {
  const [runs, setRuns] = useState<Run[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshedAt, setRefreshedAt] = useState<Date>(new Date());

  const load = async () => {
    const since = new Date(Date.now() - LOOKBACK_HOURS * 3600_000).toISOString();
    const { data } = await supabase
      .from("automation_runs" as any)
      .select("id,job,status,status_code,message,duration_ms,created_at")
      .in("job", JOBS.map((j) => j.name) as string[])
      .gte("created_at", since)
      .order("created_at", { ascending: false })
      .limit(2000);
    setRuns((data as Run[]) ?? []);
    setRefreshedAt(new Date());
    setLoading(false);
  };

  useEffect(() => {
    load();
    const ch = supabase
      .channel("edge_health_dashboard")
      .on("postgres_changes",
        { event: "INSERT", schema: "public", table: "automation_runs" },
        load)
      .subscribe();
    const t = setInterval(load, 30_000);
    return () => { supabase.removeChannel(ch); clearInterval(t); };
  }, []);

  const byJob = useMemo(() => {
    const now = Date.now();
    const since1h = now - 3600_000;
    const since24h = now - 24 * 3600_000;
    return JOBS.map((j) => {
      const all = runs.filter((r) => r.job === j.name);
      const last1h = all.filter((r) => +new Date(r.created_at) >= since1h);
      const last24h = all.filter((r) => +new Date(r.created_at) >= since24h);
      return {
        ...j,
        all,
        last1h,
        last24h,
        lastSuccess: all.find(isOk) ?? null,
        lastError: all.find((r) => !isOk(r)) ?? null,
        rate1h: rate(last1h),
        rate24h: rate(last24h),
        rate7d: rate(all),
        p50: p(last24h, 0.5),
        p95: p(last24h, 0.95),
      };
    });
  }, [runs]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-xs text-muted-foreground uppercase tracking-wide">
          <Activity className="h-3.5 w-3.5" /> Edge function health (W2 / W3 / W4)
        </div>
        <Button variant="ghost" size="sm" onClick={load} disabled={loading}>
          <RefreshCw className={`h-3 w-3 mr-1 ${loading ? "animate-spin" : ""}`} />
          {rel(refreshedAt.toISOString())}
        </Button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        {byJob.map((j) => {
          const tone =
            j.rate24h == null ? "muted" :
            j.rate24h >= 0.99 ? "ok" :
            j.rate24h >= 0.9 ? "warn" : "bad";
          return (
            <Card key={j.name} className={
              tone === "bad" ? "border-destructive/40" :
              tone === "warn" ? "border-amber-500/40" : ""
            }>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm flex items-center justify-between">
                  <span>{j.label}</span>
                  {tone === "ok" && <CheckCircle2 className="h-4 w-4 text-emerald-600" />}
                  {tone === "warn" && <AlertTriangle className="h-4 w-4 text-amber-600" />}
                  {tone === "bad" && <AlertTriangle className="h-4 w-4 text-destructive" />}
                </CardTitle>
                <code className="text-[10px] text-muted-foreground">{j.name}</code>
              </CardHeader>
              <CardContent className="space-y-3 text-xs">
                <div className="grid grid-cols-3 gap-2">
                  {([
                    ["1h", j.rate1h, j.last1h.length],
                    ["24h", j.rate24h, j.last24h.length],
                    ["7d", j.rate7d, j.all.length],
                  ] as const).map(([label, r, n]) => (
                    <div key={label} className="rounded border border-border p-2">
                      <div className="text-[10px] uppercase text-muted-foreground">{label} success</div>
                      <div className={`text-base font-mono ${rateColor(r)}`}>
                        {r == null ? "—" : `${(r * 100).toFixed(0)}%`}
                      </div>
                      <div className="text-[10px] text-muted-foreground">{n} run{n === 1 ? "" : "s"}</div>
                    </div>
                  ))}
                </div>

                <HourTimeline runs={j.all} />

                <div className="flex flex-wrap gap-x-4 gap-y-1 font-mono text-[11px]">
                  <span>p50 {j.p50 == null ? "—" : `${j.p50}ms`}</span>
                  <span>p95 {j.p95 == null ? "—" : `${j.p95}ms`}</span>
                </div>

                <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px]">
                  <span className="font-mono">
                    last success:{" "}
                    {j.lastSuccess
                      ? <span className="text-emerald-600 dark:text-emerald-400">{rel(j.lastSuccess.created_at)}</span>
                      : <span className="text-destructive">never</span>}
                  </span>
                  <span className="font-mono">
                    last error:{" "}
                    {j.lastError
                      ? <span className="text-destructive">{rel(j.lastError.created_at)}</span>
                      : <span className="text-muted-foreground">—</span>}
                  </span>
                </div>

                {j.lastError && (
                  <div className="rounded bg-destructive/5 border border-destructive/20 p-2">
                    <div className="flex items-center gap-2 mb-1">
                      <Badge variant="destructive" className="text-[10px]">
                        {j.lastError.status_code ?? "err"}
                      </Badge>
                      <span className="text-[10px] text-muted-foreground">{rel(j.lastError.created_at)}</span>
                    </div>
                    <div className="text-[11px] line-clamp-2 break-words">
                      {j.lastError.message ?? "(no message)"}
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>

      {loading && runs.length === 0 && (
        <div className="text-xs text-muted-foreground flex items-center gap-1">
          <Loader2 className="h-3 w-3 animate-spin" /> Loading…
        </div>
      )}
    </div>
  );
}
