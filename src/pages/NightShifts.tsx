import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Moon, ChevronDown, ChevronRight, CheckCircle2, AlertTriangle, XCircle, Clock, FileSearch } from "lucide-react";
import PromotionAuditDrawer from "@/components/promotion/PromotionAuditDrawer";
import NightBacklogTable from "@/components/night/NightBacklogTable";

type Shift = {
  id: string;
  status: string;
  started_at: string;
  ended_at: string | null;
  window_start: string;
  window_end: string;
  summary: any;
  commit_sha: string | null;
};

type Audit = { shift_id: string; discussion_action_id: string; short_num: number | null; audit_complete: boolean | null; worst_severity: string | null; step_count: number | null };
type Proposal = { id: string; shift_id: string; status: string; kind: string; rationale: string | null; target_ref: any; payload: any; decided_at: string | null };

const fmt = (iso: string | null) => {
  if (!iso) return "—";
  const d = new Date(iso);
  return d.toLocaleString(undefined, { month: "short", day: "2-digit", hour: "2-digit", minute: "2-digit" });
};

const dur = (a: string, b: string | null) => {
  if (!b) return "running";
  const ms = new Date(b).getTime() - new Date(a).getTime();
  const m = Math.round(ms / 60000);
  if (m < 60) return `${m}m`;
  return `${Math.floor(m / 60)}h ${m % 60}m`;
};

const sevTone = (s: string | null | undefined) =>
  s === "high" ? "bg-destructive/10 text-destructive border-destructive/30"
  : s === "medium" ? "bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-500/30"
  : s === "low" ? "bg-yellow-500/10 text-yellow-700 dark:text-yellow-500 border-yellow-500/30"
  : "bg-muted text-muted-foreground border-border";

const statusIcon = (s: string) =>
  s === "completed" ? <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" />
  : s === "running" ? <Clock className="h-3.5 w-3.5 text-blue-600 dark:text-blue-400 animate-pulse" />
  : <AlertTriangle className="h-3.5 w-3.5 text-destructive" />;

const propTone = (s: string) =>
  s === "accepted" ? "text-emerald-600 dark:text-emerald-400"
  : s === "rejected" ? "text-destructive"
  : "text-muted-foreground";

export default function NightShifts() {
  const [shifts, setShifts] = useState<Shift[]>([]);
  const [audits, setAudits] = useState<Audit[]>([]);
  const [proposals, setProposals] = useState<Proposal[]>([]);
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [auditProposalId, setAuditProposalId] = useState<string | null>(null);
  const [filter, setFilter] = useState<"all" | "completed" | "running" | "with_failures">("all");

  const load = async () => {
    const [{ data: s }, { data: a }, { data: p }] = await Promise.all([
      supabase.from("night_shifts" as any)
        .select("id, status, started_at, ended_at, window_start, window_end, summary, commit_sha")
        .order("started_at", { ascending: false }).limit(50),
      supabase.from("night_task_audit" as any)
        .select("shift_id, discussion_action_id, short_num, audit_complete, worst_severity, step_count"),
      supabase.from("night_proposals" as any)
        .select("id, shift_id, status, kind, rationale, target_ref, payload, decided_at")
        .order("created_at", { ascending: false }),
    ]);
    setShifts((s as any) ?? []);
    setAudits((a as any) ?? []);
    setProposals((p as any) ?? []);
  };

  useEffect(() => {
    load();
    const ch = supabase.channel("night_shifts_page")
      .on("postgres_changes", { event: "*", schema: "public", table: "night_shifts" }, load)
      .on("postgres_changes", { event: "*", schema: "public", table: "night_proposals" }, load)
      .on("postgres_changes", { event: "*", schema: "public", table: "night_observations" }, load)
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, []);

  const auditsByShift = useMemo(() => {
    const m = new Map<string, Audit[]>();
    audits.forEach((a) => {
      const arr = m.get(a.shift_id) ?? [];
      arr.push(a);
      m.set(a.shift_id, arr);
    });
    return m;
  }, [audits]);

  const proposalsByShift = useMemo(() => {
    const m = new Map<string, Proposal[]>();
    proposals.forEach((p) => {
      const arr = m.get(p.shift_id) ?? [];
      arr.push(p);
      m.set(p.shift_id, arr);
    });
    return m;
  }, [proposals]);

  const sevRank: Record<string, number> = { info: 0, low: 1, medium: 2, high: 3 };
  const worstFor = (shiftId: string): string => {
    const list = auditsByShift.get(shiftId) ?? [];
    return list.reduce<string>((acc, a) => {
      const cur = a.worst_severity ?? "info";
      return (sevRank[cur] ?? 0) > (sevRank[acc] ?? 0) ? cur : acc;
    }, "info");
  };

  const counts = (shiftId: string) => {
    const a = auditsByShift.get(shiftId) ?? [];
    const p = proposalsByShift.get(shiftId) ?? [];
    return {
      audited: a.length,
      complete: a.filter((x) => x.audit_complete).length,
      pending: p.filter((x) => x.status === "pending").length,
      accepted: p.filter((x) => x.status === "accepted").length,
      rejected: p.filter((x) => x.status === "rejected").length,
    };
  };

  const filtered = shifts.filter((sh) => {
    if (filter === "all") return true;
    if (filter === "completed") return sh.status === "completed";
    if (filter === "running") return sh.status === "running";
    if (filter === "with_failures") return worstFor(sh.id) === "high";
    return true;
  });

  const toggle = (id: string) => {
    setOpen((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  return (
    <div className="p-6 space-y-4 max-w-6xl">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold flex items-center gap-2">
            <Moon className="h-5 w-5" /> Night Agent shifts
          </h1>
          <p className="text-sm text-muted-foreground">
            History of audited out-of-hours shifts with proposal outcomes.
          </p>
        </div>
        <select
          value={filter}
          onChange={(e) => setFilter(e.target.value as any)}
          className="text-xs bg-background border border-border rounded px-2 py-1"
        >
          <option value="all">All shifts</option>
          <option value="completed">Completed</option>
          <option value="running">Running</option>
          <option value="with_failures">With high-severity</option>
        </select>
      </header>

      <NightBacklogTable />


      {filtered.length === 0 ? (
        <div className="rounded-md border border-border bg-card p-6 text-sm text-muted-foreground">
          No shifts recorded yet.
        </div>
      ) : (
        <ul className="space-y-2">
          {filtered.map((sh) => {
            const c = counts(sh.id);
            const worst = worstFor(sh.id);
            const isOpen = open.has(sh.id);
            const tz = sh.summary?.tz ?? "UTC";
            return (
              <li key={sh.id} id={`shift-${sh.id}`} className="rounded-md border border-border bg-card scroll-mt-4">
                <button
                  type="button"
                  onClick={() => toggle(sh.id)}
                  className="w-full flex items-center gap-3 p-3 text-left hover:bg-muted/40"
                  aria-expanded={isOpen}
                >
                  {isOpen ? <ChevronDown className="h-4 w-4 text-muted-foreground" /> : <ChevronRight className="h-4 w-4 text-muted-foreground" />}
                  {statusIcon(sh.status)}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 text-sm">
                      <span className="font-mono">{fmt(sh.started_at)}</span>
                      <span className="text-muted-foreground">→</span>
                      <span className="font-mono">{fmt(sh.ended_at)}</span>
                      <span className="text-[10px] text-muted-foreground">· {dur(sh.started_at, sh.ended_at)} · {tz}</span>
                    </div>
                    <div className="text-[11px] text-muted-foreground">
                      window {fmt(sh.window_start)} → {fmt(sh.window_end)}
                    </div>
                  </div>
                  <span className={`text-[10px] font-mono px-1.5 py-0.5 rounded border ${sevTone(worst)}`}>worst: {worst}</span>
                  <div className="flex items-center gap-2 text-[11px] font-mono text-muted-foreground">
                    <span title="audits complete / total">{c.complete}/{c.audited} audited</span>
                    <span>·</span>
                    <span className="text-foreground">{c.pending}p</span>
                    <span className="text-emerald-600 dark:text-emerald-400">{c.accepted}a</span>
                    <span className="text-destructive">{c.rejected}r</span>
                  </div>
                </button>

                {isOpen && (
                  <div className="border-t border-border px-3 py-3 space-y-3">
                    {/* Summary */}
                    {sh.summary && Object.keys(sh.summary).length > 0 && (
                      <div className="text-[11px] text-muted-foreground font-mono">
                        {sh.summary.observations != null && <span className="mr-3">obs: {sh.summary.observations}</span>}
                        {sh.summary.failures != null && <span className="mr-3">failures: {sh.summary.failures}</span>}
                        {sh.summary.window && <span className="mr-3">window: {sh.summary.window}</span>}
                        {Array.isArray(sh.summary.allowed_kinds) && (
                          <span>allowed: {sh.summary.allowed_kinds.join(", ")}</span>
                        )}
                      </div>
                    )}

                    {/* Audits */}
                    <div>
                      <div className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1">Audited tasks</div>
                      {(auditsByShift.get(sh.id) ?? []).length === 0 ? (
                        <div className="text-xs text-muted-foreground italic">No audits recorded.</div>
                      ) : (
                        <ul className="divide-y divide-border text-xs">
                          {(auditsByShift.get(sh.id) ?? []).map((a) => (
                            <li key={a.discussion_action_id} className="py-1.5 flex items-center gap-2">
                              <span className="font-mono text-muted-foreground">#{a.short_num ?? "?"}</span>
                              <span className={`text-[10px] font-mono px-1.5 py-0.5 rounded border ${sevTone(a.worst_severity)}`}>
                                {a.worst_severity ?? "info"}
                              </span>
                              <span className="text-[10px] font-mono text-muted-foreground">{a.step_count ?? 0} steps</span>
                              {a.audit_complete
                                ? <CheckCircle2 className="h-3 w-3 text-emerald-600 dark:text-emerald-400 ml-auto" />
                                : <XCircle className="h-3 w-3 text-amber-600 dark:text-amber-400 ml-auto" aria-label="incomplete" />}
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>

                    {/* Proposals */}
                    <div>
                      <div className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1">Proposals</div>
                      {(proposalsByShift.get(sh.id) ?? []).length === 0 ? (
                        <div className="text-xs text-muted-foreground italic">No proposals queued.</div>
                      ) : (
                        <ul className="divide-y divide-border text-xs">
                          {(proposalsByShift.get(sh.id) ?? []).map((p) => (
                            <li key={p.id} className="py-1.5 flex items-start gap-2">
                              <span className={`text-[10px] font-mono uppercase w-16 shrink-0 ${propTone(p.status)}`}>{p.status}</span>
                              <span className="font-mono text-muted-foreground shrink-0">#{p.target_ref?.short_num ?? "?"}</span>
                              <span className="flex-1 text-foreground/90 leading-snug">{p.rationale ?? p.kind}</span>
                              {(p.status === "accepted" || p.status === "rejected") && (
                                <button
                                  onClick={() => setAuditProposalId(p.id)}
                                  className="text-[10px] font-mono text-muted-foreground hover:text-foreground inline-flex items-center gap-1 shrink-0"
                                  title="View promotion audit report"
                                >
                                  <FileSearch className="h-3 w-3" /> audit
                                </button>
                              )}
                              {p.decided_at && (
                                <span className="text-[10px] text-muted-foreground font-mono shrink-0">{fmt(p.decided_at)}</span>
                              )}
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
      <PromotionAuditDrawer
        proposalId={auditProposalId}
        onOpenChange={(o) => !o && setAuditProposalId(null)}
      />
    </div>
  );
}
