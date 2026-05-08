import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { ShieldCheck, Loader2, PlayCircle, AlertTriangle, CheckCircle2 } from "lucide-react";
import { toast } from "@/hooks/use-toast";

type GateResult = {
  test_mode: boolean;
  actor_id: string;
  triggered_at: string;
  gates: {
    timezone: string;
    window: string;
    local_date: string;
    local_time: string;
    enabled: boolean;
    in_window: boolean;
    blackout_hit: boolean;
    allowed_kinds: string[];
    blackout_dates: string[];
  };
  would_open_shift: boolean;
  skip_reasons: string[];
  candidates_total: number;
  would_audit: number;
  would_skip: number;
  jobs: Array<{
    id: string;
    short_num: number;
    title: string;
    risk: "low" | "med" | "high";
    phase: string;
    suite: string;
    would_audit: boolean;
    skip_reasons: string[];
  }>;
  note: string;
};

const riskTone = (r: string) =>
  r === "high"
    ? "text-rose-600 dark:text-rose-400"
    : r === "med"
      ? "text-amber-600 dark:text-amber-400"
      : "text-muted-foreground";

export const NightAgentTestModeCard = () => {
  const [isAdmin, setIsAdmin] = useState<boolean | null>(null);
  const [at, setAt] = useState("");
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<GateResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { setIsAdmin(false); return; }
      const { data } = await supabase
        .from("user_roles")
        .select("role")
        .eq("user_id", user.id)
        .eq("role", "admin")
        .maybeSingle();
      setIsAdmin(!!data);
    })();
  }, []);

  const run = async () => {
    setRunning(true);
    setError(null);
    setResult(null);
    try {
      const qs = new URLSearchParams({ test: "1" });
      if (at.trim()) {
        const iso = new Date(at).toISOString();
        qs.set("at", iso);
      }
      const { data, error } = await supabase.functions.invoke(
        `night-agent/open?${qs.toString()}`,
        { method: "POST" },
      );
      if (error) throw error;
      if ((data as any)?.error) throw new Error((data as any).error);
      setResult(data as GateResult);
      toast({
        title: (data as any).would_open_shift ? "Would open shift" : "Would skip",
        description: (data as any).would_open_shift
          ? `${(data as any).would_audit}/${(data as any).candidates_total} jobs would audit`
          : `Reasons: ${((data as any).skip_reasons ?? []).join(", ") || "n/a"}`,
      });
    } catch (e: any) {
      const msg = e?.message ?? String(e);
      setError(msg);
      toast({ title: "Test mode failed", description: msg, variant: "destructive" });
    } finally {
      setRunning(false);
    }
  };

  if (isAdmin === null) return null;
  if (!isAdmin) return null;

  return (
    <section className="rounded-md border border-border bg-card p-3 space-y-3">
      <header className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-sm font-medium">
          <ShieldCheck className="h-4 w-4" /> Night Agent · admin test mode
        </div>
        <span className="text-[10px] text-muted-foreground italic">read-only · admin only</span>
      </header>

      <p className="text-[11px] text-muted-foreground">
        Calls <span className="font-mono">/night-agent/open?test=1</span> with your operator JWT and
        returns the gate evaluation plus per-candidate audit preview. No shift, observation, or
        proposal is written.
      </p>

      <div className="flex items-end gap-2 flex-wrap">
        <label className="flex flex-col gap-1 text-[11px]">
          <span className="text-muted-foreground">Evaluate at (optional)</span>
          <input
            type="datetime-local"
            value={at}
            onChange={(e) => setAt(e.target.value)}
            className="bg-background border border-border rounded px-2 py-1 font-mono text-[11px]"
          />
        </label>
        {at && (
          <button
            type="button"
            onClick={() => setAt("")}
            className="text-[11px] px-2 py-1 rounded border border-border hover:bg-muted"
          >
            Use now
          </button>
        )}
        <button
          type="button"
          onClick={run}
          disabled={running}
          className="text-[11px] px-2 py-1 rounded border border-primary/40 bg-primary/10 hover:bg-primary/20 disabled:opacity-50 inline-flex items-center gap-1"
        >
          {running ? <Loader2 className="h-3 w-3 animate-spin" /> : <PlayCircle className="h-3 w-3" />}
          Run test
        </button>
      </div>

      {error && (
        <div className="text-[11px] rounded border border-destructive/40 bg-destructive/5 p-2 text-destructive flex items-start gap-1.5">
          <AlertTriangle className="h-3 w-3 mt-0.5 shrink-0" />
          <span className="font-mono">{error}</span>
        </div>
      )}

      {result && (
        <div className="space-y-2">
          {/* Verdict */}
          <div
            className={`rounded border p-2 text-[11px] flex items-start gap-2 ${
              result.would_open_shift
                ? "border-emerald-500/40 bg-emerald-500/5"
                : "border-amber-500/40 bg-amber-500/5"
            }`}
          >
            {result.would_open_shift ? (
              <CheckCircle2 className="h-4 w-4 text-emerald-600 dark:text-emerald-400 mt-0.5" />
            ) : (
              <AlertTriangle className="h-4 w-4 text-amber-600 dark:text-amber-400 mt-0.5" />
            )}
            <div className="space-y-0.5">
              <div className="font-medium">
                {result.would_open_shift ? "Would open shift" : "Would skip shift"}
              </div>
              {result.skip_reasons.length > 0 && (
                <div className="font-mono">skip: {result.skip_reasons.join(", ")}</div>
              )}
              <div className="text-muted-foreground">
                evaluated at <span className="font-mono">{result.triggered_at}</span>
              </div>
            </div>
          </div>

          {/* Gates grid */}
          <div className="rounded border border-border bg-muted/20 p-2 grid grid-cols-2 md:grid-cols-3 gap-x-3 gap-y-1 text-[11px] font-mono">
            <div><span className="text-muted-foreground">tz:</span> {result.gates.timezone}</div>
            <div><span className="text-muted-foreground">window:</span> {result.gates.window}</div>
            <div><span className="text-muted-foreground">enabled:</span> {String(result.gates.enabled)}</div>
            <div><span className="text-muted-foreground">local:</span> {result.gates.local_date} {result.gates.local_time}</div>
            <div><span className="text-muted-foreground">in_window:</span> {String(result.gates.in_window)}</div>
            <div><span className="text-muted-foreground">blackout:</span> {String(result.gates.blackout_hit)}</div>
            <div className="col-span-2 md:col-span-3">
              <span className="text-muted-foreground">allowed_kinds:</span>{" "}
              {result.gates.allowed_kinds.join(", ") || <span className="italic">none</span>}
            </div>
          </div>

          {/* Jobs preview */}
          <div className="rounded border border-border">
            <div className="flex items-center justify-between px-2 py-1.5 border-b border-border text-[11px]">
              <span className="font-medium">Candidate jobs</span>
              <span className="text-muted-foreground font-mono">
                {result.would_audit} audit · {result.would_skip} skip · {result.candidates_total} total
              </span>
            </div>
            {result.jobs.length === 0 ? (
              <div className="px-2 py-3 text-[11px] text-muted-foreground italic">
                No eligible candidates.
              </div>
            ) : (
              <ul className="divide-y divide-border">
                {result.jobs.map((j) => (
                  <li key={j.id} className="px-2 py-1.5 text-[11px] flex items-start gap-2">
                    <span
                      className={`mt-0.5 inline-block h-1.5 w-1.5 rounded-full shrink-0 ${
                        j.would_audit ? "bg-emerald-500" : "bg-amber-500"
                      }`}
                      aria-hidden
                    />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span className="font-mono text-muted-foreground">#{j.short_num}</span>
                        <span className="truncate">{j.title}</span>
                        <span className={`font-mono text-[10px] ${riskTone(j.risk)}`}>
                          risk={j.risk}
                        </span>
                        <span className="font-mono text-[10px] text-muted-foreground">
                          phase={j.phase}
                        </span>
                      </div>
                      {j.skip_reasons.length > 0 && (
                        <div className="font-mono text-[10px] text-amber-600 dark:text-amber-400 mt-0.5">
                          {j.skip_reasons.join(" · ")}
                        </div>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="text-[10px] text-muted-foreground italic">{result.note}</div>
        </div>
      )}
    </section>
  );
};
