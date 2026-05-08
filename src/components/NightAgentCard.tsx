import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Moon, Loader2, Check, X } from "lucide-react";
import { toast } from "@/hooks/use-toast";

type Shift = {
  id: string;
  started_at: string;
  ended_at: string | null;
  window_start: string;
  window_end: string;
  commit_sha: string | null;
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
};
type Obs = {
  id: string;
  kind: string;
  severity: string;
  summary: string;
  created_at: string;
};

const ago = (iso: string | null) => {
  if (!iso) return "never";
  const d = Date.now() - new Date(iso).getTime();
  const m = Math.floor(d / 60_000);
  if (m < 60) return `${Math.max(1, m)}m ago`;
  if (m < 1440) return `${Math.floor(m / 60)}h ago`;
  return `${Math.floor(m / 1440)}d ago`;
};

export const NightAgentCard = () => {
  const [shift, setShift] = useState<Shift | null>(null);
  const [proposals, setProposals] = useState<Proposal[]>([]);
  const [obs, setObs] = useState<Obs[]>([]);
  const [running, setRunning] = useState<"open" | "close" | null>(null);
  const [showDigest, setShowDigest] = useState(false);

  const load = async () => {
    const { data: s } = await supabase
      .from("night_shifts" as any)
      .select("id, started_at, ended_at, window_start, window_end, commit_sha, status, summary")
      .order("started_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    setShift((s as any) ?? null);
    if (s && (s as any).id) {
      const [{ data: p }, { data: o }] = await Promise.all([
        supabase.from("night_proposals" as any).select("*").eq("status", "pending").order("created_at", { ascending: false }),
        supabase.from("night_observations" as any).select("id, kind, severity, summary, created_at").eq("shift_id", (s as any).id).order("created_at", { ascending: false }),
      ]);
      setProposals((p as any) ?? []);
      setObs((o as any) ?? []);
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
      toast({ title: `Night shift ${which === "open" ? "opened" : "closed"}`, description: JSON.stringify(data).slice(0, 120) });
    }
    load();
  };

  const decide = async (id: string, status: "accepted" | "rejected") => {
    const { error } = await supabase
      .from("night_proposals" as any)
      .update({ status, decided_at: new Date().toISOString() })
      .eq("id", id);
    if (error) toast({ title: "Update failed", description: error.message, variant: "destructive" });
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
        observation-only · 22:00–06:00 UTC · proposals require operator accept
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
            {shift.commit_sha && <span>· {shift.commit_sha.slice(0, 7)}</span>}
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
          <ul className="divide-y divide-border max-h-48 overflow-y-auto">
            {proposals.map((p) => (
              <li key={p.id} className="py-1.5 flex items-start gap-2">
                <div className="flex-1 min-w-0">
                  <div className="text-xs leading-snug">{p.rationale ?? p.kind}</div>
                  <div className="text-[10px] text-muted-foreground font-mono">
                    {p.kind} · {ago(p.created_at)}
                    {p.target_ref?.short_num ? ` · #${p.target_ref.short_num}` : ""}
                  </div>
                </div>
                <button
                  onClick={() => decide(p.id, "accepted")}
                  className="p-1 rounded border border-emerald-500/40 text-emerald-600 dark:text-emerald-400 hover:bg-emerald-500/10"
                  aria-label="Accept proposal"
                >
                  <Check className="h-3 w-3" />
                </button>
                <button
                  onClick={() => decide(p.id, "rejected")}
                  className="p-1 rounded border border-destructive/40 text-destructive hover:bg-destructive/10"
                  aria-label="Reject proposal"
                >
                  <X className="h-3 w-3" />
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {shift && obs.length > 0 && (
        <div>
          <button
            onClick={() => setShowDigest((v) => !v)}
            className="text-[10px] text-muted-foreground hover:text-foreground underline"
          >
            {showDigest ? "Hide" : "Show"} digest ({obs.length})
          </button>
          {showDigest && (
            <ul className="mt-1 space-y-0.5 max-h-56 overflow-y-auto text-[11px]">
              {obs.map((o) => (
                <li key={o.id} className="flex items-baseline gap-1.5">
                  <span className={`font-mono text-[10px] ${o.severity === "high" ? "text-destructive" : "text-muted-foreground"}`}>
                    {o.kind}
                  </span>
                  <span className="leading-snug">{o.summary}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  );
};
