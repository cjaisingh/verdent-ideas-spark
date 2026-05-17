import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { History, ChevronRight, ChevronDown, ExternalLink } from "lucide-react";
import { Link } from "react-router-dom";

type Finding = {
  id: string;
  kind: string;
  severity: string;
  summary: string;
  subject_ref: any;
  payload: any;
  status: string;
  first_seen_at: string;
  last_seen_at: string;
  resolved_at: string | null;
  updated_at: string;
};

type AutoRow = {
  id: string;
  job: string;
  status: string;
  status_code: number | null;
  created_at: string;
  duration_ms: number | null;
  message: string | null;
};

type PhaseRow = {
  id: string;
  phase_key: string;
  status: string;
  scheduled_for: string;
  requested_at: string;
  finished_at: string | null;
};

const fmt = (iso: string | null) =>
  iso
    ? new Date(iso).toLocaleString(undefined, {
        month: "short",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
      })
    : "—";

const rel = (iso: string | null) => {
  if (!iso) return "—";
  const m = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
};

const sevColor: Record<string, string> = {
  critical: "bg-destructive text-destructive-foreground",
  high: "bg-destructive/15 text-destructive",
  medium: "bg-amber-500/15 text-amber-700 dark:text-amber-400",
  low: "bg-muted text-muted-foreground",
  info: "bg-muted text-muted-foreground",
};

// Try to extract any job/phase hints from a finding's subject_ref/payload.
const extractHints = (f: Finding): { jobs: string[]; phaseKeys: string[] } => {
  const jobs = new Set<string>();
  const phases = new Set<string>();
  const walk = (v: any) => {
    if (!v) return;
    if (typeof v === "string") return;
    if (Array.isArray(v)) return v.forEach(walk);
    if (typeof v === "object") {
      for (const [k, val] of Object.entries(v)) {
        if ((k === "job" || k === "function_name" || k === "jobname") && typeof val === "string") jobs.add(val);
        if ((k === "phase_key" || k === "phase") && typeof val === "string") phases.add(val);
        walk(val);
      }
    }
  };
  walk(f.subject_ref);
  walk(f.payload);
  // Kind-based fallback: voice_pipeline_red → voice jobs; companion_streams_stalled etc don't map cleanly.
  if (f.kind.includes("overnight") || f.kind.includes("phase")) jobs.add("overnight-phase-runner-15m");
  if (f.kind.includes("night")) {
    jobs.add("night-agent-open");
    jobs.add("night-agent-close");
  }
  if (f.kind.includes("sentinel")) jobs.add("scheduled-sentinel-tick");
  return { jobs: Array.from(jobs), phaseKeys: Array.from(phases) };
};

const EvidenceRow = ({ finding }: { finding: Finding }) => {
  const [auto, setAuto] = useState<AutoRow[] | null>(null);
  const [phases, setPhases] = useState<PhaseRow[] | null>(null);

  useEffect(() => {
    if (!finding.resolved_at) return;
    const anchor = new Date(finding.resolved_at).getTime();
    const lo = new Date(anchor - 30 * 60_000).toISOString();
    const hi = new Date(anchor + 10 * 60_000).toISOString();
    const { jobs, phaseKeys } = extractHints(finding);

    (async () => {
      const promises: any[] = [];
      if (jobs.length > 0) {
        promises.push(
          supabase
            .from("automation_runs" as any)
            .select("id, job, status, status_code, created_at, duration_ms, message")
            .in("job", jobs)
            .gte("created_at", lo)
            .lte("created_at", hi)
            .order("created_at", { ascending: false })
            .limit(8),
        );
      } else {
        promises.push(Promise.resolve({ data: [] }));
      }
      if (phaseKeys.length > 0) {
        promises.push(
          supabase
            .from("roadmap_phase_overnight_runs" as any)
            .select("id, phase_key, status, scheduled_for, requested_at, finished_at")
            .in("phase_key", phaseKeys)
            .gte("requested_at", lo)
            .order("requested_at", { ascending: false })
            .limit(8),
        );
      } else {
        promises.push(Promise.resolve({ data: [] }));
      }
      const [{ data: a }, { data: p }] = await Promise.all(promises);
      setAuto((a as any) ?? []);
      setPhases((p as any) ?? []);
    })();
  }, [finding.id, finding.resolved_at]);

  const { jobs, phaseKeys } = extractHints(finding);

  if (jobs.length === 0 && phaseKeys.length === 0) {
    return (
      <div className="mt-2 text-[11px] text-muted-foreground italic">
        No cron/phase hints in finding payload — open finding for full subject_ref.
      </div>
    );
  }

  return (
    <div className="mt-2 space-y-2 text-[11px]">
      {auto === null ? (
        <div className="text-muted-foreground">Loading evidence…</div>
      ) : (
        <>
          {auto.length > 0 && (
            <div>
              <div className="uppercase tracking-wide text-muted-foreground mb-1">
                automation_runs near resolved_at (±30m / +10m)
              </div>
              <ul className="divide-y divide-border">
                {auto.map((r) => {
                  const ok = r.status === "ok" && (r.status_code === null || r.status_code < 400);
                  return (
                    <li key={r.id} className="py-1 flex items-center gap-2 font-mono">
                      <span
                        className={`inline-block h-2 w-2 rounded-full ${ok ? "bg-emerald-500" : "bg-destructive"}`}
                      />
                      <span>{r.job}</span>
                      <span className="text-muted-foreground">{r.status_code ?? r.status}</span>
                      <span className="ml-auto text-muted-foreground">{fmt(r.created_at)}</span>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}
          {phases && phases.length > 0 && (
            <div>
              <div className="uppercase tracking-wide text-muted-foreground mb-1">phase runs</div>
              <ul className="divide-y divide-border">
                {phases.map((r) => (
                  <li key={r.id} className="py-1 flex items-center gap-2 font-mono">
                    <span className="capitalize w-20">{r.status}</span>
                    <span>{r.phase_key}</span>
                    <span className="ml-auto text-muted-foreground">
                      {r.finished_at ? `done ${fmt(r.finished_at)}` : `req ${fmt(r.requested_at)}`}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {auto.length === 0 && (!phases || phases.length === 0) && (
            <div className="text-muted-foreground italic">
              No matching runs in window (hints: {[...jobs, ...phaseKeys].join(", ")}).
            </div>
          )}
        </>
      )}
    </div>
  );
};

const ClearedFindingsTimeline = () => {
  const [findings, setFindings] = useState<Finding[]>([]);
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState(true);
  const [days, setDays] = useState(7);

  const load = async () => {
    const since = new Date(Date.now() - days * 24 * 3600 * 1000).toISOString();
    const { data } = await supabase
      .from("sentinel_findings" as any)
      .select(
        "id, kind, severity, summary, subject_ref, payload, status, first_seen_at, last_seen_at, resolved_at, updated_at",
      )
      .eq("status", "resolved")
      .gte("resolved_at", since)
      .order("resolved_at", { ascending: false })
      .limit(50);
    setFindings((data as any) ?? []);
    setLoading(false);
  };

  useEffect(() => {
    load();
    const ch = supabase
      .channel("cleared_findings_timeline_widget")
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "sentinel_findings" },
        load,
      )
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
  }, [days]);

  return (
    <div className="rounded-md border border-border bg-card p-4 space-y-3">
      <header className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-sm font-semibold flex items-center gap-2 uppercase tracking-wide text-muted-foreground">
            <History className="h-3.5 w-3.5" /> Cleared sentinel findings — incident timeline
          </h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            Each entry shows when a finding flipped to <code>resolved</code> and the cron/phase runs around that
            window so you can verify the recovery, not just the status change.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <select
            value={days}
            onChange={(e) => setDays(Number(e.target.value))}
            className="text-xs px-2 py-0.5 rounded border border-border bg-background"
          >
            <option value={1}>last 24h</option>
            <option value={7}>last 7d</option>
            <option value={30}>last 30d</option>
          </select>
          <Link
            to="/admin/sentinel-findings"
            className="text-xs flex items-center gap-1 px-2 py-0.5 rounded border border-border hover:bg-accent"
          >
            All findings <ExternalLink className="h-3 w-3" />
          </Link>
        </div>
      </header>

      {loading ? (
        <div className="text-xs text-muted-foreground">Loading…</div>
      ) : findings.length === 0 ? (
        <div className="text-xs text-muted-foreground italic">
          No findings cleared in the selected window.
        </div>
      ) : (
        <ol className="relative border-l border-border ml-2">
          {findings.map((f) => {
            const isOpen = !!open[f.id];
            const dur = f.resolved_at
              ? Math.max(
                  1,
                  Math.round(
                    (new Date(f.resolved_at).getTime() - new Date(f.first_seen_at).getTime()) / 60_000,
                  ),
                )
              : null;
            return (
              <li key={f.id} className="ml-4 pb-3">
                <span className="absolute -left-1.5 flex h-3 w-3 items-center justify-center rounded-full bg-emerald-500 border border-card" />
                <button
                  className="w-full text-left flex flex-wrap items-center gap-2 text-xs hover:opacity-80"
                  onClick={() => setOpen((o) => ({ ...o, [f.id]: !o[f.id] }))}
                >
                  {isOpen ? (
                    <ChevronDown className="h-3 w-3 shrink-0" />
                  ) : (
                    <ChevronRight className="h-3 w-3 shrink-0" />
                  )}
                  <span className={`px-1.5 py-0.5 rounded text-[10px] font-mono uppercase ${sevColor[f.severity] ?? sevColor.info}`}>
                    {f.severity}
                  </span>
                  <span className="font-mono text-muted-foreground">{f.kind}</span>
                  <span className="truncate">{f.summary}</span>
                  <span className="ml-auto font-mono text-muted-foreground">
                    cleared {rel(f.resolved_at)}
                  </span>
                  {dur !== null && (
                    <span className="font-mono text-[10px] text-muted-foreground">
                      · open {dur < 60 ? `${dur}m` : `${Math.round(dur / 60)}h`}
                    </span>
                  )}
                </button>
                {isOpen && (
                  <div className="ml-5 mt-1 border-l border-dashed border-border pl-3">
                    <div className="text-[11px] font-mono text-muted-foreground">
                      first seen {fmt(f.first_seen_at)} · last seen {fmt(f.last_seen_at)} · resolved {fmt(f.resolved_at)}
                    </div>
                    <EvidenceRow finding={f} />
                  </div>
                )}
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
};

export default ClearedFindingsTimeline;
