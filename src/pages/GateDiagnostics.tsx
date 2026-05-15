import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useRoadmapGates, type PhaseGate } from "@/hooks/useRoadmapGates";
import { toast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  AlertTriangle,
  CheckCircle2,
  ChevronRight,
  ShieldAlert,
  ArrowLeft,
} from "lucide-react";

type QaCheck = {
  id: string;
  phase_key: string;
  criterion: string;
  kind: string;
  status: string;
  last_checked_at: string | null;
  note: string | null;
  probe: string | null;
};

type OpenTask = {
  id: string;
  title: string;
  status: string;
  phase_key: string;
};

type PendingSignoff = {
  id: string;
  activity: string;
  status: string;
  created_at: string;
  intent_payload: Record<string, unknown> | null;
};

type NightAudit = {
  discussion_action_id: string;
  worst_severity: string;
  phase_key: string;
  title: string | null;
};

type GateState = "pass" | "fail" | "untested";

function gateState(ok: boolean, mild: boolean): GateState {
  if (ok) return "pass";
  return mild ? "untested" : "fail";
}

function StateBadge({ state }: { state: GateState }) {
  if (state === "pass")
    return (
      <Badge variant="outline" className="border-emerald-500 text-emerald-600 dark:text-emerald-400 gap-1">
        <CheckCircle2 className="h-3 w-3" /> pass
      </Badge>
    );
  if (state === "untested")
    return (
      <Badge variant="outline" className="border-muted-foreground/40 text-muted-foreground gap-1">
        <ShieldAlert className="h-3 w-3" /> untested
      </Badge>
    );
  return (
    <Badge variant="outline" className="border-amber-500 text-amber-600 dark:text-amber-400 gap-1">
      <AlertTriangle className="h-3 w-3" /> fail
    </Badge>
  );
}

function Section({
  name,
  state,
  expected,
  source,
  children,
}: {
  name: string;
  state: GateState;
  expected: string;
  source: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="rounded border border-border/60 p-3 space-y-2">
      <div className="flex items-center justify-between gap-2">
        <div className="font-medium text-sm">{name}</div>
        <StateBadge state={state} />
      </div>
      <div className="text-xs text-muted-foreground">
        <span className="text-foreground/70 font-medium">Expected:</span> {expected}
      </div>
      {children && <div className="text-xs space-y-1">{children}</div>}
      <Collapsible>
        <CollapsibleTrigger asChild>
          <button className="text-[11px] text-muted-foreground hover:text-foreground inline-flex items-center gap-1">
            <ChevronRight className="h-3 w-3 transition-transform data-[state=open]:rotate-90" />
            source
          </button>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <pre className="mt-1 rounded bg-muted/40 p-2 text-[10px] leading-tight overflow-x-auto whitespace-pre-wrap">
            {source}
          </pre>
        </CollapsibleContent>
      </Collapsible>
    </div>
  );
}

const SOURCES = {
  structural: `-- view: roadmap_phase_gate_status (structural CTE)
COUNT(t.id) FILTER (
  WHERE t.status NOT IN ('done','wont_do')
) AS open_tasks
FROM roadmap_phases p
LEFT JOIN roadmap_sprints s ON s.phase_id = p.id
LEFT JOIN roadmap_tasks   t ON t.sprint_id = s.id
-- gate passes when open_tasks = 0`,
  qa: `-- view: roadmap_phase_gate_status (qa CTE)
SELECT
  count(*) FILTER (WHERE status = 'pass')   AS qa_pass,
  count(*) FILTER (WHERE status = 'fail')   AS qa_failed,
  count(*) FILTER (WHERE status = 'unknown'
                   OR status IS NULL)       AS qa_unknown,
  count(*)                                  AS qa_total
FROM qa_checks WHERE phase_key = p.key
-- gate passes when qa_total > 0 AND qa_pass = qa_total
-- RLS: SELECT requires has_role(auth.uid(),'operator')`,
  night: `-- view: roadmap_phase_gate_status (night CTE)
SELECT count(*) AS night_high_open
FROM discussion_actions   da
JOIN night_task_audit     nta
  ON nta.discussion_action_id = da.id
 AND nta.worst_severity = 'high'
JOIN roadmap_tasks   t  ON t.id  = da.promoted_task_id
JOIN roadmap_sprints s  ON s.id  = t.sprint_id
WHERE s.phase_id = p.id
  AND coalesce(da.status,'open') NOT IN ('done','closed','wont_do')
-- gate passes when night_high_open = 0`,
  approvals: `-- view: roadmap_phase_gate_status (approvals CTE)
SELECT count(*) AS pending_signoffs
FROM approval_queue aq
WHERE aq.activity = 'roadmap.phase_signoff'
  AND aq.status   = 'pending'
  AND (aq.intent_payload->>'phase_id')::uuid = p.id
-- gate passes when pending_signoffs = 0`,
};

function StatusBadge({ ok }: { ok: boolean }) {
  return ok ? (
    <Badge variant="outline" className="border-emerald-500 text-emerald-600 dark:text-emerald-400 gap-1">
      <CheckCircle2 className="h-3 w-3" /> all gates pass
    </Badge>
  ) : (
    <Badge variant="outline" className="border-amber-500 text-amber-600 dark:text-amber-400 gap-1">
      <AlertTriangle className="h-3 w-3" /> gates fail
    </Badge>
  );
}

export default function GateDiagnostics() {
  const { gates, refreshedAt } = useRoadmapGates();
  const [qa, setQa] = useState<QaCheck[]>([]);
  const [openTasks, setOpenTasks] = useState<OpenTask[]>([]);
  const [signoffs, setSignoffs] = useState<PendingSignoff[]>([]);
  const [nightAudits, setNightAudits] = useState<NightAudit[]>([]);
  const [showPassing, setShowPassing] = useState(false);

  useEffect(() => {
    let active = true;
    (async () => {
      const [qaRes, taskRes, sigRes, nightRes] = await Promise.all([
        supabase.from("qa_checks").select("*"),
        supabase
          .from("roadmap_tasks")
          .select("id,title,status,sprint:roadmap_sprints!inner(phase:roadmap_phases!inner(key))")
          .not("status", "in", "(done,wont_do)"),
        supabase
          .from("approval_queue")
          .select("id,activity,status,created_at,intent_payload")
          .eq("activity", "roadmap.phase_signoff")
          .eq("status", "pending"),
        supabase
          .from("night_task_audit" as never)
          .select("discussion_action_id,worst_severity,phase_key,title")
          .eq("worst_severity", "high"),
      ]);
      if (!active) return;
      setQa((qaRes.data ?? []) as QaCheck[]);
      setOpenTasks(
        (taskRes.data ?? []).map((r: {
          id: string; title: string; status: string;
          sprint?: { phase?: { key?: string } };
        }) => ({
          id: r.id,
          title: r.title,
          status: r.status,
          phase_key: r.sprint?.phase?.key ?? "",
        })),
      );
      setSignoffs((sigRes.data ?? []) as PendingSignoff[]);
      setNightAudits(((nightRes.data ?? []) as unknown) as NightAudit[]);
    })();
    return () => {
      active = false;
    };
  }, [refreshedAt]);

  const phases = useMemo(() => {
    const arr = Array.from(gates.values());
    arr.sort((a, b) => a.phase_key.localeCompare(b.phase_key, undefined, { numeric: true }));
    return showPassing ? arr : arr.filter((g) => !g.all_ok);
  }, [gates, showPassing]);

  return (
    <div className="container mx-auto p-6 max-w-5xl space-y-6">
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 text-sm text-muted-foreground mb-1">
            <Link to="/roadmap" className="inline-flex items-center gap-1 hover:text-foreground">
              <ArrowLeft className="h-3 w-3" /> Roadmap
            </Link>
          </div>
          <h1 className="text-2xl font-semibold">Phase gate diagnostics</h1>
          <p className="text-sm text-muted-foreground">
            For each phase: which of the four promotion gates fail, the expected condition, and
            the underlying evidence.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => setShowPassing((v) => !v)}>
          {showPassing ? "Hide passing" : "Show passing too"}
        </Button>
      </div>

      {phases.length === 0 && (
        <Card>
          <CardContent className="p-6 text-sm text-muted-foreground">
            No phases match — every gate passes.
          </CardContent>
        </Card>
      )}

      {phases.map((g) => (
        <PhaseDiagnostic
          key={g.phase_id}
          gate={g}
          qa={qa.filter((q) => q.phase_key === g.phase_key)}
          openTasks={openTasks.filter((t) => t.phase_key === g.phase_key)}
          signoffs={signoffs.filter(
            (s) => (s.intent_payload as { phase_id?: string } | null)?.phase_id === g.phase_id,
          )}
          night={nightAudits.filter((n) => n.phase_key === g.phase_key)}
        />
      ))}
    </div>
  );
}

async function flipQaCheck(id: string, status: "pass" | "fail", criterion: string) {
  const note = window.prompt(
    `Operator note for "${criterion}" → ${status.toUpperCase()} (required, will be saved):`,
    `Operator override ${new Date().toISOString().slice(0, 10)}: `,
  );
  if (!note || note.trim().length < 5) {
    toast({ title: "Cancelled", description: "Note required (5+ chars)." });
    return;
  }
  const { error } = await supabase
    .from("qa_checks")
    .update({ status, note: note.trim(), last_checked_at: new Date().toISOString() })
    .eq("id", id);
  if (error) {
    toast({ title: "Update failed", description: error.message, variant: "destructive" });
    return;
  }
  toast({ title: `Marked ${status}`, description: criterion });
}

function JudgementButtons({ q }: { q: QaCheck }) {
  return (
    <span className="ml-2 inline-flex gap-1">
      <button
        onClick={() => flipQaCheck(q.id, "pass", q.criterion)}
        className="px-1.5 py-0.5 text-[10px] rounded border border-emerald-500/60 text-emerald-600 dark:text-emerald-400 hover:bg-emerald-500/10"
      >
        pass
      </button>
      <button
        onClick={() => flipQaCheck(q.id, "fail", q.criterion)}
        className="px-1.5 py-0.5 text-[10px] rounded border border-amber-500/60 text-amber-600 dark:text-amber-400 hover:bg-amber-500/10"
      >
        fail
      </button>
    </span>
  );
}

function PhaseDiagnostic({
  gate,
  qa,
  openTasks,
  signoffs,
  night,
}: {
  gate: PhaseGate;
  qa: QaCheck[];
  openTasks: OpenTask[];
  signoffs: PendingSignoff[];
  night: NightAudit[];
}) {
  const qaFailed = qa.filter((q) => q.status === "fail");
  const qaUnknown = qa.filter((q) => q.status === "unknown" || !q.status);

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-3 space-y-0">
        <div>
          <CardTitle className="text-lg flex items-center gap-2">
            {gate.phase_key}
            <Badge variant="secondary" className="text-[10px] uppercase">
              {gate.phase_status}
            </Badge>
          </CardTitle>
          <p className="text-xs text-muted-foreground mt-0.5">
            promotion gates require all four below to pass
          </p>
        </div>
        <StatusBadge ok={gate.all_ok} />
      </CardHeader>
      <CardContent className="grid md:grid-cols-2 gap-3">
        <Section
          name="Structural"
          state={gateState(gate.structural_ok, false)}
          expected={`open_tasks = 0  (currently ${gate.open_tasks} of ${gate.total_tasks})`}
          source={SOURCES.structural}
        >
          {!gate.structural_ok && openTasks.length > 0 && (
            <ul className="list-disc pl-4 space-y-0.5 max-h-40 overflow-auto">
              {openTasks.slice(0, 20).map((t) => (
                <li key={t.id}>
                  <span className="text-muted-foreground">[{t.status}]</span> {t.title}
                </li>
              ))}
              {openTasks.length > 20 && (
                <li className="text-muted-foreground">… {openTasks.length - 20} more</li>
              )}
            </ul>
          )}
        </Section>

        <Section
          name="QA checks"
          state={gateState(gate.qa_ok, gate.qa_failed === 0)}
          expected={
            gate.qa_total === 0
              ? "≥ 1 qa_check defined for phase, all pass"
              : `qa_pass (${gate.qa_pass}) = qa_total (${gate.qa_total})`
          }
          source={SOURCES.qa}
        >
          {gate.qa_total === 0 && (
            <div className="text-muted-foreground italic">No qa_checks rows for this phase.</div>
          )}
          {qaFailed.length > 0 && (
            <div>
              <div className="font-medium text-amber-600 dark:text-amber-400">Failing</div>
              <ul className="list-disc pl-4 space-y-0.5">
                {qaFailed.map((q) => (
                  <li key={q.id}>
                    {q.criterion}
                    {q.note && <span className="text-muted-foreground"> — {q.note}</span>}
                    <JudgementButtons q={q} />
                  </li>
                ))}
              </ul>
            </div>
          )}
          {qaUnknown.length > 0 && (
            <div>
              <div className="font-medium text-muted-foreground">Untested</div>
              <ul className="list-disc pl-4 space-y-0.5">
                {qaUnknown.slice(0, 10).map((q) => (
                  <li key={q.id} className="text-muted-foreground">
                    [{q.kind}] {q.criterion}
                    <JudgementButtons q={q} />
                  </li>
                ))}
                {qaUnknown.length > 10 && (
                  <li className="text-muted-foreground">… {qaUnknown.length - 10} more</li>
                )}
              </ul>
            </div>
          )}
        </Section>

        <Section
          name="Night audits"
          state={gateState(gate.night_ok, false)}
          expected={`night_high_open = 0  (currently ${gate.night_high_open})`}
          source={SOURCES.night}
        >
          {!gate.night_ok && night.length > 0 && (
            <ul className="list-disc pl-4 space-y-0.5">
              {night.map((n) => (
                <li key={n.discussion_action_id}>
                  {n.title ?? n.discussion_action_id}
                  <span className="text-muted-foreground"> — {n.worst_severity}</span>
                </li>
              ))}
            </ul>
          )}
        </Section>

        <Section
          name="Approvals"
          state={gateState(gate.approvals_ok, false)}
          expected={`pending sign-offs for this phase = 0  (currently ${gate.pending_signoffs})`}
          source={SOURCES.approvals}
        >
          {!gate.approvals_ok && signoffs.length > 0 && (
            <ul className="list-disc pl-4 space-y-0.5">
              {signoffs.map((s) => (
                <li key={s.id}>
                  <Link to={`/approvals/${s.id}`} className="underline hover:text-foreground">
                    {s.id.slice(0, 8)}
                  </Link>
                  <span className="text-muted-foreground">
                    {" "}— pending since {new Date(s.created_at).toLocaleString()}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Section>
      </CardContent>
    </Card>
  );
}
