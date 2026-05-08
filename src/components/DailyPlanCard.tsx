import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Sunrise, Loader2, ChevronDown, ChevronRight } from "lucide-react";
import { toast } from "@/hooks/use-toast";

type Risk = { title: string; detail?: string; severity: "low" | "medium" | "high" };
type Rec = { title: string; detail?: string };
type Plan = {
  id: string; for_date: string; model: string; focus: string | null;
  plan_md: string; risks: Risk[]; recommendations: Rec[];
  generated_at: string; inputs_summary: Record<string, number>;
};

const sevTone = (s: string) =>
  s === "high" ? "bg-destructive/10 text-destructive border-destructive/30"
  : s === "medium" ? "bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-500/30"
  : "bg-muted text-muted-foreground border-border";

export const DailyPlanCard = () => {
  const [plan, setPlan] = useState<Plan | null>(null);
  const [open, setOpen] = useState(true);
  const [running, setRunning] = useState(false);

  const load = async () => {
    const { data } = await supabase.from("daily_plans")
      .select("*").order("for_date", { ascending: false }).limit(1).maybeSingle();
    setPlan((data as unknown as Plan) ?? null);
  };

  useEffect(() => {
    load();
    const ch = supabase.channel("daily_plans")
      .on("postgres_changes", { event: "*", schema: "public", table: "daily_plans" }, load)
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, []);

  const runNow = async () => {
    setRunning(true);
    try {
      const { error } = await supabase.functions.invoke("daily-plan", { body: {} });
      if (error) throw error;
      toast({ title: "Daily plan generated" });
      await load();
    } catch (e) {
      toast({ title: "Plan failed", description: e instanceof Error ? e.message : String(e), variant: "destructive" });
    } finally { setRunning(false); }
  };

  return (
    <div className="border border-border rounded-md p-3 mb-3 bg-card">
      <div className="flex items-center gap-2">
        <button onClick={() => setOpen(o => !o)} className="text-muted-foreground hover:text-foreground">
          {open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
        </button>
        <Sunrise className="h-4 w-4 text-amber-500" />
        <h3 className="text-sm font-semibold">Daily plan</h3>
        {plan && <span className="text-xs text-muted-foreground">· {plan.for_date}</span>}
        <div className="ml-auto flex items-center gap-2">
          <button
            onClick={runNow}
            disabled={running}
            className="text-[10px] inline-flex items-center gap-1 px-2 py-0.5 rounded border border-border text-muted-foreground hover:text-foreground hover:bg-muted disabled:opacity-50"
          >
            {running && <Loader2 className="h-3 w-3 animate-spin" />}
            {running ? "Generating…" : "Generate now"}
          </button>
        </div>
      </div>

      {open && (
        <div className="mt-2 space-y-3">
          {!plan && <p className="text-xs text-muted-foreground">No plan yet. Cron runs nightly at 05:30 UTC, or click Generate now.</p>}
          {plan && (
            <>
              {plan.focus && (
                <div className="text-sm border-l-2 border-amber-500 pl-2">
                  <span className="font-semibold">Focus:</span> {plan.focus}
                </div>
              )}
              <pre className="text-xs whitespace-pre-wrap font-sans text-foreground/90">{plan.plan_md}</pre>
              {plan.risks?.length > 0 && (
                <div>
                  <h4 className="text-xs font-semibold mb-1">Risks</h4>
                  <ul className="space-y-1">
                    {plan.risks.map((r, i) => (
                      <li key={i} className="text-xs flex gap-2">
                        <span className={`px-1.5 py-0.5 rounded border text-[10px] uppercase ${sevTone(r.severity)}`}>{r.severity}</span>
                        <span><span className="font-medium">{r.title}</span>{r.detail ? <> — <span className="text-muted-foreground">{r.detail}</span></> : null}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {plan.recommendations?.length > 0 && (
                <div>
                  <h4 className="text-xs font-semibold mb-1">Recommendations</h4>
                  <ul className="text-xs list-disc pl-5 space-y-0.5">
                    {plan.recommendations.map((r, i) => (
                      <li key={i}><span className="font-medium">{r.title}</span>{r.detail ? <> — <span className="text-muted-foreground">{r.detail}</span></> : null}</li>
                    ))}
                  </ul>
                </div>
              )}
              <p className="text-[10px] text-muted-foreground">Generated {new Date(plan.generated_at).toLocaleString()} · {plan.model}</p>
            </>
          )}
        </div>
      )}
    </div>
  );
};
