import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Sparkles, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import {
  recommend,
  TASK_TYPES,
  TOOL_LABELS,
  type PolicySignals,
  type RecommendationResult,
  type TaskType,
  type Tool,
  type ToolPolicyRule,
} from "@/lib/toolPolicy";
import { ToolPolicyRulesTable } from "./ToolPolicyRulesTable";

type Phase = { id: string; title: string };

const NONE = "__none__";

const TOOL_TONES: Record<Tool, string> = {
  lovable: "bg-violet-500/10 text-violet-500 border-violet-500/30",
  claude: "bg-orange-500/10 text-orange-500 border-orange-500/30",
  cursor: "bg-blue-500/10 text-blue-500 border-blue-500/30",
  codex: "bg-emerald-500/10 text-emerald-500 border-emerald-500/30",
  manual: "bg-muted text-muted-foreground border-border",
};

export function ToolPolicyPanel() {
  const [signals, setSignals] = useState<PolicySignals | null>(null);
  const [rules, setRules] = useState<ToolPolicyRule[]>([]);
  const [phases, setPhases] = useState<Phase[]>([]);
  const [loading, setLoading] = useState(true);
  const [taskType, setTaskType] = useState<TaskType>("new_feature");
  const [phaseId, setPhaseId] = useState<string>(NONE);
  const [result, setResult] = useState<RecommendationResult | null>(null);

  async function load() {
    setLoading(true);
    const [sigRes, rulesRes, phasesRes] = await Promise.all([
      supabase.from("v_tool_policy_signals").select("*").maybeSingle(),
      supabase.from("tool_policy_rules").select("*").order("precedence", { ascending: true }),
      supabase.from("roadmap_phases").select("id,title").order("phase_number", { ascending: true }),
    ]);
    if (sigRes.error) toast.error(sigRes.error.message);
    if (rulesRes.error) toast.error(rulesRes.error.message);
    setSignals((sigRes.data as PolicySignals | null) ?? null);
    setRules((rulesRes.data ?? []) as ToolPolicyRule[]);
    setPhases((phasesRes.data ?? []) as Phase[]);
    setLoading(false);
  }

  useEffect(() => {
    load();
    const ch = supabase
      .channel("admin_tool_policy_rules")
      .on("postgres_changes", { event: "*", schema: "public", table: "tool_policy_rules" }, () => load())
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, []);

  const liveResult = useMemo(() => {
    if (!signals) return null;
    return recommend(rules, {
      task_type: taskType,
      phase_id: phaseId === NONE ? null : phaseId,
      signals,
    });
  }, [rules, signals, taskType, phaseId]);

  async function logRecommendation() {
    if (!liveResult || !signals) return;
    const { data: userRes } = await supabase.auth.getUser();
    const { error } = await supabase.from("tool_policy_recommendations").insert({
      operator_id: userRes.user?.id ?? null,
      task_type: taskType,
      phase_id: phaseId === NONE ? null : phaseId,
      credits_remaining_pct: signals.remaining_pct,
      burn_rate_per_day: signals.burn_7d_per_day,
      chosen_tool: liveResult.tool,
      chosen_rule_id: liveResult.rule?.id ?? null,
      score_breakdown: { considered: liveResult.considered.map((c) => ({ rule: c.rule.name, matched: c.matched, failed_on: c.failed_on })) },
    });
    if (error) toast.error(error.message);
    else {
      setResult(liveResult);
      toast.success(`Logged: use ${TOOL_LABELS[liveResult.tool]}`);
    }
  }

  const shown = result ?? liveResult;

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Signals</CardTitle>
        </CardHeader>
        <CardContent>
          {loading && !signals ? (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">{[...Array(4)].map((_, i) => <Skeleton key={i} className="h-16" />)}</div>
          ) : (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <Signal label="MTD credits" value={signals?.mtd_credits != null ? signals.mtd_credits.toFixed(2) : "—"} />
              <Signal label="Budget" value={signals?.budget != null ? `${signals.budget}` : "Not set"} />
              <Signal
                label="Remaining"
                value={signals?.remaining_pct != null ? `${signals.remaining_pct}%` : "—"}
                tone={signals?.remaining_pct != null && signals.remaining_pct <= 15 ? "warn" : undefined}
              />
              <Signal label="7d burn / day" value={signals?.burn_7d_per_day != null ? signals.burn_7d_per_day.toFixed(2) : "—"} hint={signals?.projected_month_end != null ? `~${signals.projected_month_end} projected` : undefined} />
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3 flex flex-row items-center justify-between">
          <CardTitle className="text-base flex items-center gap-2"><Sparkles className="h-4 w-4" /> Recommend a tool</CardTitle>
          <Button variant="ghost" size="sm" onClick={load}><RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} /></Button>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap gap-3 items-end">
            <div className="space-y-1">
              <div className="text-xs text-muted-foreground">Task type</div>
              <Select value={taskType} onValueChange={(v) => { setResult(null); setTaskType(v as TaskType); }}>
                <SelectTrigger className="w-[200px]"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {TASK_TYPES.map((t) => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <div className="text-xs text-muted-foreground">Phase (optional)</div>
              <Select value={phaseId} onValueChange={(v) => { setResult(null); setPhaseId(v); }}>
                <SelectTrigger className="w-[240px]"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>None</SelectItem>
                  {phases.map((p) => <SelectItem key={p.id} value={p.id}>{p.title}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <Button onClick={logRecommendation} disabled={!liveResult}>Log recommendation</Button>
          </div>

          {shown && (
            <div className={`rounded-md border p-4 space-y-3 ${TOOL_TONES[shown.tool]}`}>
              <div className="flex items-center gap-3">
                <div className="text-xs uppercase tracking-wide opacity-70">Use</div>
                <div className="text-2xl font-semibold">{TOOL_LABELS[shown.tool]}</div>
                {shown.rule && <Badge variant="outline" className="ml-auto">{shown.rule.name}</Badge>}
              </div>
              <p className="text-sm">{shown.reasoning}</p>
              <details className="text-xs opacity-80">
                <summary className="cursor-pointer">Rules considered ({shown.considered.length})</summary>
                <ul className="mt-2 space-y-1">
                  {shown.considered.map((c) => (
                    <li key={c.rule.id} className="font-mono">
                      {c.matched ? "✓" : "✗"} [{c.rule.precedence}] {c.rule.name}
                      {c.failed_on && <span className="opacity-70"> — {c.failed_on}</span>}
                    </li>
                  ))}
                </ul>
              </details>
            </div>
          )}
        </CardContent>
      </Card>

      <ToolPolicyRulesTable rules={rules} phases={phases} onChange={load} />
    </div>
  );
}

function Signal({ label, value, hint, tone }: { label: string; value: string; hint?: string; tone?: "warn" }) {
  return (
    <div>
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className={`mt-1 text-xl font-semibold tabular-nums ${tone === "warn" ? "text-amber-500" : ""}`}>{value}</div>
      {hint && <div className="text-[11px] text-muted-foreground mt-0.5">{hint}</div>}
    </div>
  );
}
