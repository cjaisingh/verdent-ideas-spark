import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Moon, Loader2, Check, X, AlertTriangle } from "lucide-react";
import { toast } from "@/hooks/use-toast";

type Shift = {
  id: string;
  started_at: string;
  ended_at: string | null;
  status: string;
  summary: any;
};
type Proposal = {
  id: string;
  shift_id: string;
  kind: string;
  target_ref: any;
  rationale: string | null;
  status: string;
  created_at: string;
  payload: any;
};
type AuditRow = {
  discussion_action_id: string;
  shift_id: string;
  audit_complete: boolean;
  worst_severity: string;
  step_count: number;
  steps: Array<{ kind: string; severity: string; summary: string; created_at: string }>;
};

const ago = (iso: string | null) => {
  if (!iso) return "never";
  const d = Date.now() - new Date(iso).getTime();
  const m = Math.floor(d / 60_000);
  if (m < 60) return `${Math.max(1, m)}m ago`;
  if (m < 1440) return `${Math.floor(m / 60)}h ago`;
  return `${Math.floor(m / 1440)}d ago`;
};

const sevDot = (s: string) =>
  s === "high" ? "bg-destructive"
  : s === "medium" ? "bg-amber-500"
  : s === "low" ? "bg-amber-300"
  : "bg-emerald-500";

export const NightAgentCard = () => {
  const [shift, setShift] = useState<Shift | null>(null);
  const [proposals, setProposals] = useState<Proposal[]>([]);
  const [audits, setAudits] = useState<Record<string, AuditRow>>({});
  const [running, setRunning] = useState<"open" | "close" | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const load = async () => {
    const { data: s } = await supabase
      .from("night_shifts" as any)
      .select("id, started_at, ended_at, status, summary")
      .order("started_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    setShift((s as any) ?? null);
    if (s && (s as any).id) {
      const sid = (s as any).id;
      const [{ data: p }, { data: a }] = await Promise.all([
        supabase.from("night_proposals" as any).select("*").eq("status", "pending").order("created_at", { ascending: false }),
        supabase.from("night_task_audit" as any).select("*").eq("shift_id", sid),
      ]);
      setProposals((p as any) ?? []);
      const map: Record<string, AuditRow> = {};
      for (const row of (a as any) ?? []) map[row.discussion_action_id] = row;
      setAudits(map);
    }
  };

  useEffect(() => {
    load();
    const ch = supabase
      .channel("night_agent_panel")
      .on("postgres_changes", { event: "*", schema: "public", table: "night_shifts" }, load)
      .on("postgres_changes", { event: "*", schema: "public", table: "night_proposals" }, load)
      .on("postgres_changes", { event: "*", schema: "public", table: "night_observations" }, load)
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, []);

  const trigger = async (which: "open" | "close") => {
    setRunning(which);
    const { data, error } = await supabase.functions.invoke(`night-agent/${which}`, { body: {} });
    setRunning(null);
    if (error) {
      toast({ title: `Night agent ${which} failed`, description: error.message, variant: "destructive" });
    } else {
      toast({ title: `Night shift ${which === "open" ? "opened" : "closed"}`, description: JSON.stringify(data).slice(0, 140) });
    }
    load();
  };

  const decide = async (p: Proposal, status: "accepted" | "rejected") => {
    const audit = audits[p.target_ref?.discussion_action_id];
    if (status === "accepted" && audit?.worst_severity === "high") {
      if (!confirm(`Audit worst-severity is HIGH. Force-accept #${p.target_ref?.short_num}?`)) return;
    }
    const { error } = await supabase
      .from("night_proposals" as any)
      .update({ status, decided_at: new Date().toISOString() })
      .eq("id", p.id);
    if (error) { toast({ title: "Update failed", description: error.message, variant: "destructive" }); return; }
    // Trailing audit observation
    if (shift) {
      await supabase.from("night_observations" as any).insert({
        shift_id: shift.id,
        kind: "job_review",
        severity: "info",
        subject_ref: p.target_ref ?? {},
        summary: status === "accepted" ? "promoted" : "rejected",
        payload: { proposal_id: p.id },
      } as any);
    }
  };

  const toggleExpand = (id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const summary = shift?.summary ?? {};
  const byKind = (summary.by_kind ?? {}) as Record<string, number>;
  const counts = Object.entries(byKind).map(([k, v]) => `${k}:${v}`).join(" · ");

  return (
    <section className="rounded-md border border-border bg-card p-3 space-y-2">
      <header className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-sm font-medium">
          <Moon className="h-4 w-4" /> Night Agent
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={() => trigger("open")}
            disabled={running !== null}
            className="text-[10px] inline-flex items-center gap-1 px-2 py-0.5 rounded border border-border text-muted-foreground hover:text-foreground hover:bg-muted"
          >
            {running === "open" ? <Loader2 className="h-3 w-3 animate-spin" /> : null}
            Open shift
          </button>
          <button
            onClick={() => trigger("close")}
            disabled={running !== null}
            className="text-[10px] inline-flex items-center gap-1 px-2 py-0.5 rounded border border-border text-muted-foreground hover:text-foreground hover:bg-muted"
          >
            {running === "close" ? <Loader2 className="h-3 w-3 animate-spin" /> : null}
            Close shift
          </button>
        </div>
      </header>
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
        observation-only · 22:00–06:00 UTC · pulls only night-eligible jobs · operator accepts every promotion
      </div>

      {!shift ? (
        <div className="text-xs text-muted-foreground py-2 italic">No shift recorded yet.</div>
      ) : (
        <div className="text-[11px] rounded border border-border bg-muted/30 px-2 py-1.5 space-y-1">
          <div className="flex items-center gap-2 font-mono text-[10px]">
            <span className={shift.status === "running" ? "text-amber-600 dark:text-amber-400" : "text-emerald-600 dark:text-emerald-400"}>
              {shift.status}
            </span>
            <span>· {ago(shift.started_at)}</span>
            {summary.audits_complete != null && <span>· {summary.audits_complete} audits</span>}
          </div>
          {counts && <div className="text-[11px] text-foreground/80">{counts}</div>}
          {summary.failures > 0 && (
            <div className="text-[11px] text-destructive">{summary.failures} high-severity observations</div>
          )}
        </div>
      )}

      {proposals.length > 0 && (
        <div className="space-y-1">
          <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
            Pending proposals ({proposals.length})
          </div>
          <ul className="divide-y divide-border max-h-72 overflow-y-auto">
            {proposals.map((p) => {
              const audit = audits[p.target_ref?.discussion_action_id];
              const worst = (p.payload?.worst_severity ?? audit?.worst_severity ?? "info") as string;
              const isHigh = worst === "high";
              const isOpen = expanded.has(p.id);
              return (
                <li key={p.id} className="py-1.5 space-y-1">
                  <div className="flex items-start gap-2">
                    <span className={`mt-1 h-2 w-2 rounded-full shrink-0 ${sevDot(worst)}`} aria-label={`severity ${worst}`} />
                    <div className="flex-1 min-w-0">
                      <div className="text-xs leading-snug">{p.rationale ?? p.kind}</div>
                      <div className="text-[10px] text-muted-foreground font-mono">
                        {p.kind} · {ago(p.created_at)}
                        {p.target_ref?.short_num ? ` · #${p.target_ref.short_num}` : ""}
                        {audit ? ` · ${audit.step_count} steps` : ""}
                        <button
                          onClick={() => toggleExpand(p.id)}
                          className="ml-2 underline hover:text-foreground"
                        >
                          {isOpen ? "hide audit" : "view audit"}
                        </button>
                      </div>
                    </div>
                    <button
                      onClick={() => decide(p, "accepted")}
                      className={`p-1 rounded border ${isHigh ? "border-destructive/40 text-destructive" : "border-emerald-500/40 text-emerald-600 dark:text-emerald-400"} hover:bg-muted`}
                      title={isHigh ? "Audit failed — confirm to force-accept" : "Accept proposal"}
                      aria-label="Accept proposal"
                    >
                      {isHigh ? <AlertTriangle className="h-3 w-3" /> : <Check className="h-3 w-3" />}
                    </button>
                    <button
                      onClick={() => decide(p, "rejected")}
                      className="p-1 rounded border border-destructive/40 text-destructive hover:bg-destructive/10"
                      aria-label="Reject proposal"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </div>
                  {isOpen && audit && (
                    <ul className="ml-4 space-y-0.5 text-[11px] border-l border-border pl-2">
                      {audit.steps.map((s, i) => (
                        <li key={i} className="flex items-baseline gap-1.5">
                          <span className={`h-1.5 w-1.5 rounded-full shrink-0 ${sevDot(s.severity)}`} />
                          <span className="font-mono text-[10px] text-muted-foreground">{s.kind}</span>
                          <span className="leading-snug">{s.summary}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </section>
  );
};
