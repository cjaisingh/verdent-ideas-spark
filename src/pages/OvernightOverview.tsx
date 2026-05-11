import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Moon, Clock, Layers, AlertTriangle, CheckCircle2, XCircle, Activity, Settings2 } from "lucide-react";

type Shift = {
  id: string;
  status: string;
  started_at: string;
  ended_at: string | null;
  window_start: string;
  window_end: string;
  summary: any;
};
type Settings = {
  night_agent_enabled: boolean;
  night_window_start: string;
  night_window_end: string;
  night_timezone: string;
};
type Run = {
  id: string;
  job: string;
  trigger: string;
  status: string;
  status_code: number | null;
  message: string | null;
  created_at: string;
  duration_ms: number | null;
};
type Alert = {
  id: string;
  job: string;
  reason: string;
  message: string | null;
  created_at: string;
  delivered: boolean;
};
type PhaseCounts = { queued: number; running: number; failed: number };

const fmt = (iso: string | null) => {
  if (!iso) return "—";
  const d = new Date(iso);
  return d.toLocaleString(undefined, { month: "short", day: "2-digit", hour: "2-digit", minute: "2-digit" });
};

const rel = (iso: string) => {
  const m = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
};

const nextWindow = (settings: Settings | null) => {
  if (!settings) return [] as { label: string; at: Date }[];
  const [sh, sm] = settings.night_window_start.split(":").map(Number);
  const [eh, em] = settings.night_window_end.split(":").map(Number);
  const now = new Date();
  const out: { label: string; at: Date }[] = [];
  for (let i = 0; i < 3; i++) {
    const open = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + i, sh, sm));
    if (open > now) out.push({ label: "Open shift", at: open });
    const close = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + i, eh, em));
    if (close > now) out.push({ label: "Close shift", at: close });
  }
  // 15-min phase runner: next 4 ticks
  for (let i = 1; i <= 4; i++) {
    const t = new Date(now.getTime() + i * 15 * 60 * 1000);
    t.setUTCSeconds(0, 0);
    t.setUTCMinutes(Math.ceil(t.getUTCMinutes() / 15) * 15 % 60);
    out.push({ label: "Phase runner", at: t });
  }
  return out.sort((a, b) => +a.at - +b.at).slice(0, 6);
};

const Card = ({ children, className = "" }: { children: React.ReactNode; className?: string }) => (
  <div className={`rounded-md border border-border bg-card p-4 ${className}`}>{children}</div>
);

const OvernightOverview = () => {
  const [shift, setShift] = useState<Shift | null>(null);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [phases, setPhases] = useState<PhaseCounts>({ queued: 0, running: 0, failed: 0 });
  const [runs, setRuns] = useState<Run[]>([]);
  const [alerts, setAlerts] = useState<Alert[]>([]);

  const load = async () => {
    const since = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
    const overnightJobs = ["night-agent-open", "night-agent-close", "overnight-phase-runner", "overnight-prequeue"];
    const [{ data: s }, { data: ms }, { data: ph }, { data: r }, { data: al }] = await Promise.all([
      supabase
        .from("night_shifts" as any)
        .select("id, status, started_at, ended_at, window_start, window_end, summary")
        .order("started_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
      supabase
        .from("memory_settings" as any)
        .select("night_agent_enabled, night_window_start, night_window_end, night_timezone")
        .maybeSingle(),
      supabase
        .from("roadmap_phase_overnight_runs" as any)
        .select("status")
        .in("status", ["queued", "running", "failed"]),
      supabase
        .from("automation_runs" as any)
        .select("id, job, trigger, status, status_code, message, created_at, duration_ms")
        .in("job", overnightJobs)
        .gte("created_at", since)
        .order("created_at", { ascending: false })
        .limit(20),
      supabase
        .from("alert_log" as any)
        .select("id, job, reason, message, created_at, delivered")
        .in("job", overnightJobs)
        .gte("created_at", since)
        .order("created_at", { ascending: false })
        .limit(10),
    ]);
    setShift((s as any) ?? null);
    setSettings((ms as any) ?? null);
    const counts: PhaseCounts = { queued: 0, running: 0, failed: 0 };
    ((ph as any[]) ?? []).forEach((row) => {
      if (row.status in counts) counts[row.status as keyof PhaseCounts]++;
    });
    setPhases(counts);
    setRuns((r as any) ?? []);
    setAlerts((al as any) ?? []);
  };

  useEffect(() => {
    load();
    const ch = supabase
      .channel("overnight_overview")
      .on("postgres_changes", { event: "*", schema: "public", table: "night_shifts" }, load)
      .on("postgres_changes", { event: "*", schema: "public", table: "automation_runs" }, load)
      .on("postgres_changes", { event: "*", schema: "public", table: "alert_log" }, load)
      .on("postgres_changes", { event: "*", schema: "public", table: "roadmap_phase_overnight_runs" }, load)
      .subscribe();
    const t = setInterval(load, 60000);
    return () => {
      supabase.removeChannel(ch);
      clearInterval(t);
    };
  }, []);

  const upcoming = useMemo(() => nextWindow(settings), [settings]);
  const failedRuns = runs.filter((r) => r.status !== "ok" || (r.status_code !== null && r.status_code >= 400));

  return (
    <div className="p-6 space-y-4 max-w-6xl">
      <header className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold flex items-center gap-2">
            <Activity className="h-5 w-5" /> Overnight overview
          </h1>
          <p className="text-sm text-muted-foreground">
            Snapshot of the overnight automation: last shift, upcoming windows, queued phases, recent failures.
          </p>
        </div>
        <Link to="/overnight-activity" className="text-xs text-primary hover:underline whitespace-nowrap mt-1">
          7-day activity →
        </Link>
      </header>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
        {/* Last shift */}
        <Card>
          <div className="flex items-center gap-2 text-xs text-muted-foreground uppercase tracking-wide">
            <Moon className="h-3.5 w-3.5" /> Last night shift
          </div>
          {shift ? (
            <Link to="/night-shifts" className="block mt-2 hover:underline">
              <div className="text-sm font-medium capitalize flex items-center gap-2">
                {shift.status === "completed" && <CheckCircle2 className="h-4 w-4 text-emerald-600" />}
                {shift.status === "running" && <Clock className="h-4 w-4 text-blue-600 animate-pulse" />}
                {(shift.status === "aborted" || shift.status === "failed") && <XCircle className="h-4 w-4 text-destructive" />}
                {shift.status}
              </div>
              <div className="text-[11px] font-mono text-muted-foreground mt-1">
                {fmt(shift.started_at)} → {fmt(shift.ended_at)}
              </div>
              <div className="text-[11px] text-muted-foreground mt-1">
                {shift.summary?.candidates_total != null && (
                  <span>{shift.summary.candidates_total} candidates</span>
                )}
              </div>
            </Link>
          ) : (
            <div className="text-sm text-muted-foreground mt-2">No shifts recorded.</div>
          )}
        </Card>

        {/* Queued phases */}
        <Card>
          <div className="flex items-center gap-2 text-xs text-muted-foreground uppercase tracking-wide">
            <Layers className="h-3.5 w-3.5" /> Phase runs
          </div>
          <div className="mt-2 flex items-baseline gap-3">
            <div className="text-2xl font-semibold tabular-nums">{phases.queued}</div>
            <div className="text-xs text-muted-foreground">queued</div>
          </div>
          <div className="text-[11px] text-muted-foreground font-mono mt-1">
            {phases.running} running · {phases.failed} failed (24h)
          </div>
          <Link to="/roadmap" className="text-[11px] text-primary hover:underline mt-2 inline-block">
            view roadmap →
          </Link>
        </Card>

        {/* Settings */}
        <Card>
          <div className="flex items-center gap-2 text-xs text-muted-foreground uppercase tracking-wide">
            <Settings2 className="h-3.5 w-3.5" /> Agent state
          </div>
          {settings ? (
            <>
              <div className="mt-2 text-sm font-medium">
                {settings.night_agent_enabled ? (
                  <span className="text-emerald-600 dark:text-emerald-400">Enabled</span>
                ) : (
                  <span className="text-destructive">Disabled</span>
                )}
              </div>
              <div className="text-[11px] font-mono text-muted-foreground mt-1">
                {settings.night_window_start}–{settings.night_window_end} {settings.night_timezone}
              </div>
            </>
          ) : (
            <div className="text-sm text-muted-foreground mt-2">No settings.</div>
          )}
        </Card>

        {/* Failures */}
        <Card>
          <div className="flex items-center gap-2 text-xs text-muted-foreground uppercase tracking-wide">
            <AlertTriangle className="h-3.5 w-3.5" /> Failures (24h)
          </div>
          <div className="mt-2 flex items-baseline gap-3">
            <div className={`text-2xl font-semibold tabular-nums ${failedRuns.length > 0 ? "text-destructive" : ""}`}>
              {failedRuns.length}
            </div>
            <div className="text-xs text-muted-foreground">runs</div>
          </div>
          <div className="text-[11px] text-muted-foreground font-mono mt-1">
            {alerts.length} alert{alerts.length === 1 ? "" : "s"} logged
          </div>
        </Card>
      </div>

      {/* Upcoming windows */}
      <Card>
        <div className="flex items-center gap-2 text-xs text-muted-foreground uppercase tracking-wide mb-2">
          <Clock className="h-3.5 w-3.5" /> Upcoming cron windows (UTC)
        </div>
        {upcoming.length === 0 ? (
          <div className="text-sm text-muted-foreground">No upcoming windows.</div>
        ) : (
          <ul className="divide-y divide-border text-xs">
            {upcoming.map((u, i) => (
              <li key={i} className="py-1.5 flex items-center gap-3">
                <span className="font-mono text-muted-foreground w-32">{fmt(u.at.toISOString())}</span>
                <span className="text-foreground">{u.label}</span>
                <span className="text-[11px] text-muted-foreground ml-auto font-mono">
                  in {Math.max(1, Math.round((+u.at - Date.now()) / 60000))}m
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {/* Recent errors */}
      <Card>
        <div className="flex items-center gap-2 text-xs text-muted-foreground uppercase tracking-wide mb-2">
          <AlertTriangle className="h-3.5 w-3.5" /> Recent overnight job errors (24h)
        </div>
        {failedRuns.length === 0 && alerts.length === 0 ? (
          <div className="text-sm text-muted-foreground">No errors in the last 24 hours.</div>
        ) : (
          <div className="space-y-3">
            {failedRuns.length > 0 && (
              <ul className="divide-y divide-border text-xs">
                {failedRuns.map((r) => (
                  <li key={r.id} className="py-1.5 flex items-start gap-2">
                    <XCircle className="h-3.5 w-3.5 text-destructive shrink-0 mt-0.5" />
                    <span className="font-mono text-muted-foreground shrink-0">{rel(r.created_at)}</span>
                    <span className="font-mono text-foreground shrink-0">{r.job}</span>
                    <span className="font-mono text-[10px] px-1.5 rounded border border-border text-muted-foreground shrink-0">
                      {r.trigger}
                    </span>
                    <span className="font-mono text-destructive shrink-0">{r.status_code ?? r.status}</span>
                    <span className="text-foreground/90 truncate">{r.message ?? "(no message)"}</span>
                  </li>
                ))}
              </ul>
            )}
            {alerts.length > 0 && (
              <div>
                <div className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1">Alert log</div>
                <ul className="divide-y divide-border text-xs">
                  {alerts.map((a) => (
                    <li key={a.id} className="py-1.5 flex items-start gap-2">
                      <AlertTriangle className="h-3.5 w-3.5 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
                      <span className="font-mono text-muted-foreground shrink-0">{rel(a.created_at)}</span>
                      <span className="font-mono text-foreground shrink-0">{a.job}</span>
                      <span className="font-mono text-[10px] px-1.5 rounded border border-border text-muted-foreground shrink-0">
                        {a.reason}
                      </span>
                      <span className="text-foreground/90 truncate">{a.message ?? ""}</span>
                      {!a.delivered && (
                        <span className="text-[10px] text-muted-foreground ml-auto shrink-0">undelivered</span>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
      </Card>
    </div>
  );
};

export default OvernightOverview;
