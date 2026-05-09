import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { AlertTriangle, ChevronDown, ChevronRight, XCircle, Lightbulb, ArrowRight } from "lucide-react";
import { classifyError, type ErrorCause } from "@/lib/automation-error-classify";

export type AutomationRun = {
  id: string;
  job: string;
  trigger: string;
  status: string;
  status_code: number | null;
  message: string | null;
  duration_ms: number | null;
  created_at: string;
};

const rel = (iso: string) => {
  const m = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
};

type GroupedJob = {
  job: string;
  total: number;
  causes: { cause: ErrorCause; runs: AutomationRun[] }[];
};

function groupErrors(errors: AutomationRun[]): GroupedJob[] {
  const byJob = new Map<string, AutomationRun[]>();
  for (const e of errors) {
    if (!byJob.has(e.job)) byJob.set(e.job, []);
    byJob.get(e.job)!.push(e);
  }
  const out: GroupedJob[] = [];
  for (const [job, runs] of byJob) {
    const byCause = new Map<string, { cause: ErrorCause; runs: AutomationRun[] }>();
    for (const r of runs) {
      const c = classifyError(r.job, r.status_code, r.message);
      if (!byCause.has(c.id)) byCause.set(c.id, { cause: c, runs: [] });
      byCause.get(c.id)!.runs.push(r);
    }
    out.push({
      job,
      total: runs.length,
      causes: Array.from(byCause.values()).sort((a, b) => b.runs.length - a.runs.length),
    });
  }
  return out.sort((a, b) => b.total - a.total);
}

export default function ErrorGroupsPanel({ errors }: { errors: AutomationRun[] }) {
  const groups = useMemo(() => groupErrors(errors), [errors]);
  const [openJob, setOpenJob] = useState<string | null>(groups[0]?.job ?? null);
  const [openCause, setOpenCause] = useState<string | null>(null);

  if (errors.length === 0) {
    return <div className="text-sm text-muted-foreground">No errors in the window.</div>;
  }

  return (
    <div className="space-y-2">
      {groups.map((g) => {
        const isOpen = openJob === g.job;
        return (
          <div key={g.job} className="border border-border rounded-md">
            <button
              type="button"
              onClick={() => { setOpenJob(isOpen ? null : g.job); setOpenCause(null); }}
              className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-accent/40"
            >
              {isOpen ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
              <span className="font-mono text-sm text-foreground">{g.job}</span>
              <span className="text-xs text-destructive font-mono ml-auto tabular-nums">
                {g.total} error{g.total === 1 ? "" : "s"}
              </span>
              <span className="text-[10px] text-muted-foreground font-mono">
                {g.causes.length} cause{g.causes.length === 1 ? "" : "s"}
              </span>
            </button>

            {isOpen && (
              <div className="border-t border-border p-2 space-y-1.5 bg-background/50">
                {g.causes.map(({ cause, runs }) => {
                  const causeKey = `${g.job}:${cause.id}`;
                  const causeOpen = openCause === causeKey;
                  return (
                    <div key={cause.id} className="border border-border/60 rounded">
                      <button
                        type="button"
                        onClick={() => setOpenCause(causeOpen ? null : causeKey)}
                        className="w-full flex items-start gap-2 px-2.5 py-1.5 text-left hover:bg-accent/30"
                      >
                        {causeOpen ? <ChevronDown className="h-3 w-3 mt-0.5" /> : <ChevronRight className="h-3 w-3 mt-0.5" />}
                        <AlertTriangle className="h-3.5 w-3.5 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
                        <div className="flex-1 min-w-0">
                          <div className="text-xs font-medium text-foreground">{cause.label}</div>
                          <div className="text-[11px] text-muted-foreground truncate">{cause.hint}</div>
                        </div>
                        <span className="text-[10px] font-mono text-muted-foreground tabular-nums shrink-0">
                          ×{runs.length}
                        </span>
                      </button>

                      {causeOpen && (
                        <div className="border-t border-border/60 px-2.5 py-2 space-y-2 bg-card">
                          <div className="text-xs flex items-start gap-2 p-2 rounded bg-amber-500/10 border border-amber-500/20">
                            <Lightbulb className="h-3.5 w-3.5 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
                            <div className="space-y-1.5">
                              <div className="text-foreground">{cause.hint}</div>
                              {cause.fix && (
                                <Link
                                  to={cause.fix.to}
                                  className="inline-flex items-center gap-1 text-[11px] text-primary hover:underline"
                                >
                                  {cause.fix.label} <ArrowRight className="h-3 w-3" />
                                </Link>
                              )}
                            </div>
                          </div>

                          <ul className="divide-y divide-border text-xs max-h-64 overflow-y-auto">
                            {runs.slice(0, 30).map((r) => (
                              <li key={r.id} className="py-1 flex items-start gap-2">
                                <XCircle className="h-3 w-3 text-destructive shrink-0 mt-0.5" />
                                <span className="font-mono text-muted-foreground shrink-0 w-16">{rel(r.created_at)}</span>
                                <span className="font-mono text-[10px] px-1 rounded border border-border text-muted-foreground shrink-0">
                                  {r.trigger}
                                </span>
                                <span className="font-mono text-destructive shrink-0">{r.status_code ?? r.status}</span>
                                <span className="text-foreground/90 truncate" title={r.message ?? ""}>
                                  {r.message ?? "(no message)"}
                                </span>
                              </li>
                            ))}
                            {runs.length > 30 && (
                              <li className="py-1 text-[11px] text-muted-foreground italic">
                                + {runs.length - 30} more
                              </li>
                            )}
                          </ul>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
