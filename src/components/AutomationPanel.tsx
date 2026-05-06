import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { ShieldCheck, FlaskConical, ClipboardCheck, Loader2, ExternalLink } from "lucide-react";
import { toast } from "@/hooks/use-toast";

type Finding = { id: string; created_at: string; severity: string; category: string | null; title: string; acknowledged: boolean };
type TestRun = { id: string; created_at: string; suite: string; status: string; passed: number | null; failed: number | null; total: number | null; workflow_run_url: string | null };
type QaCheck = { id: string; phase_key: string; criterion: string; status: string; last_checked_at: string | null; note: string | null };
type AutoRun = { id: string; created_at: string; job: string; trigger: string; status: string; status_code: number | null; duration_ms: number | null; message: string | null };

const ago = (iso: string | null) => {
  if (!iso) return "never";
  const d = Date.now() - new Date(iso).getTime();
  const h = Math.floor(d / 3_600_000);
  if (h < 1) return `${Math.max(1, Math.floor(d / 60_000))}m ago`;
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
};

const sevTone = (s: string) =>
  s === "high" ? "bg-destructive/10 text-destructive border-destructive/30"
  : s === "medium" ? "bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-500/30"
  : "bg-muted text-muted-foreground border-border";

const statusTone = (s: string) =>
  s === "pass" || s === "passed" ? "text-emerald-600 dark:text-emerald-400"
  : s === "fail" || s === "failed" || s === "errored" ? "text-destructive"
  : "text-muted-foreground";

// GitHub Actions workflow URL for nightly tests (manual dispatch)
const NIGHTLY_WORKFLOW_URL =
  "https://github.com/search?q=path%3A.github%2Fworkflows%2Fnightly.yml&type=code";

type RunState = "idle" | "running" | "ok" | "error";

const RunButton = ({
  state, onClick, label, runningLabel = "Running…",
}: { state: RunState; onClick: () => void; label: string; runningLabel?: string }) => (
  <button
    onClick={onClick}
    disabled={state === "running"}
    className={`text-[10px] inline-flex items-center gap-1 px-2 py-0.5 rounded border transition
      ${state === "running" ? "border-border text-muted-foreground cursor-wait"
        : state === "ok" ? "border-emerald-500/40 text-emerald-600 dark:text-emerald-400 hover:bg-emerald-500/10"
        : state === "error" ? "border-destructive/40 text-destructive hover:bg-destructive/10"
        : "border-border text-muted-foreground hover:text-foreground hover:bg-muted"}`}
  >
    {state === "running" && <Loader2 className="h-3 w-3 animate-spin" />}
    {state === "running" ? runningLabel : label}
  </button>
);

export const AutomationPanel = () => {
  const [findings, setFindings] = useState<Finding[]>([]);
  const [runs, setRuns] = useState<TestRun[]>([]);
  const [qa, setQa] = useState<QaCheck[]>([]);
  const [autoRuns, setAutoRuns] = useState<AutoRun[]>([]);

  const [reviewState, setReviewState] = useState<RunState>("idle");
  const [qaState, setQaState] = useState<RunState>("idle");
  const [reviewMsg, setReviewMsg] = useState<string | null>(null);
  const [qaMsg, setQaMsg] = useState<string | null>(null);

  const load = async () => {
    const [f, r, q, a] = await Promise.all([
      supabase.from("roadmap_review_findings" as any).select("id, created_at, severity, category, title, acknowledged")
        .order("created_at", { ascending: false }).limit(5),
      supabase.from("test_runs" as any).select("id, created_at, suite, status, passed, failed, total, workflow_run_url")
        .order("created_at", { ascending: false }).limit(4),
      supabase.from("qa_checks" as any).select("id, phase_key, criterion, status, last_checked_at, note")
        .order("phase_key").order("criterion"),
      supabase.from("automation_runs" as any).select("id, created_at, job, trigger, status, status_code, duration_ms, message")
        .order("created_at", { ascending: false }).limit(40),
    ]);
    setFindings(((f.data ?? []) as unknown) as Finding[]);
    setRuns(((r.data ?? []) as unknown) as TestRun[]);
    setQa(((q.data ?? []) as unknown) as QaCheck[]);
    setAutoRuns(((a.data ?? []) as unknown) as AutoRun[]);
  };

  useEffect(() => {
    load();
    const ch = supabase
      .channel("automation_panel")
      .on("postgres_changes", { event: "*", schema: "public", table: "roadmap_review_findings" }, load)
      .on("postgres_changes", { event: "*", schema: "public", table: "test_runs" }, load)
      .on("postgres_changes", { event: "*", schema: "public", table: "qa_checks" }, load)
      .on("postgres_changes", { event: "*", schema: "public", table: "automation_runs" }, load)
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, []);

  const lastRunFor = (job: string) => autoRuns.find((r) => r.job === job) ?? null;

  const runReview = async () => {
    setReviewState("running");
    setReviewMsg(null);
    const started = Date.now();
    const { data, error } = await supabase.functions.invoke("scheduled-code-review", { body: {} });
    await load();
    const elapsed = ((Date.now() - started) / 1000).toFixed(1);
    if (error) {
      setReviewState("error");
      setReviewMsg(error.message);
      toast({ title: "Code review failed", description: error.message, variant: "destructive" });
    } else {
      const count = (data && (data.findings_count ?? data.count)) ?? null;
      setReviewState("ok");
      setReviewMsg(count !== null ? `${count} findings · ${elapsed}s` : `done · ${elapsed}s`);
      toast({ title: "Code review complete", description: count !== null ? `${count} findings recorded` : "Findings updated" });
    }
    setTimeout(() => setReviewState("idle"), 4000);
  };

  const runQa = async () => {
    setQaState("running");
    setQaMsg(null);
    const started = Date.now();
    const { data, error } = await supabase.functions.invoke("qa-validate", { body: {} });
    await load();
    const elapsed = ((Date.now() - started) / 1000).toFixed(1);
    if (error) {
      setQaState("error");
      setQaMsg(error.message);
      toast({ title: "QA probes failed", description: error.message, variant: "destructive" });
    } else {
      const checked = (data && (data.checked ?? data.count)) ?? null;
      setQaState("ok");
      setQaMsg(checked !== null ? `${checked} checks · ${elapsed}s` : `done · ${elapsed}s`);
      toast({ title: "QA probes complete", description: checked !== null ? `${checked} criteria evaluated` : "Statuses refreshed" });
    }
    setTimeout(() => setQaState("idle"), 4000);
  };

  const setQaStatus = async (id: string, status: string) => {
    await supabase.from("qa_checks" as any).update({ status, last_checked_at: new Date().toISOString() }).eq("id", id);
  };

  const phaseGroups = qa.reduce<Record<string, QaCheck[]>>((acc, c) => {
    (acc[c.phase_key] ||= []).push(c); return acc;
  }, {});

  const lastRunAt = runs[0]?.created_at ?? null;

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
      {/* Code review */}
      <section className="rounded-md border border-border bg-card p-3 space-y-2">
        <header className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-sm font-medium"><ShieldCheck className="h-4 w-4" /> Code review</div>
          <RunButton state={reviewState} onClick={runReview} label="Run now" />
        </header>
        <div className="text-[10px] uppercase tracking-wide text-muted-foreground flex items-center justify-between">
          <span>openai/gpt-5 · weekly Mon 06:00 UTC</span>
          {reviewMsg && <span className={statusTone(reviewState === "error" ? "fail" : "pass")}>{reviewMsg}</span>}
        </div>
        {findings.length === 0 ? (
          <div className="text-xs text-muted-foreground py-2">No findings yet.</div>
        ) : (
          <ul className="divide-y divide-border">
            {findings.map((f) => (
              <li key={f.id} className="py-1.5 space-y-0.5">
                <div className="flex items-center gap-2">
                  <span className={`text-[10px] font-mono px-1.5 py-0.5 rounded border ${sevTone(f.severity)}`}>{f.severity}</span>
                  {f.category && <span className="text-[10px] text-muted-foreground font-mono">{f.category}</span>}
                  <span className="text-[10px] text-muted-foreground ml-auto">{ago(f.created_at)}</span>
                </div>
                <div className="text-xs leading-snug">{f.title}</div>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Test runs */}
      <section className="rounded-md border border-border bg-card p-3 space-y-2">
        <header className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-sm font-medium"><FlaskConical className="h-4 w-4" /> Tests</div>
          <a
            href={NIGHTLY_WORKFLOW_URL}
            target="_blank"
            rel="noreferrer"
            className="text-[10px] inline-flex items-center gap-1 px-2 py-0.5 rounded border border-border text-muted-foreground hover:text-foreground hover:bg-muted"
            title="Open the GitHub Actions workflow to dispatch a run manually"
          >
            Trigger on GitHub <ExternalLink className="h-3 w-3" />
          </a>
        </header>
        <div className="text-[10px] uppercase tracking-wide text-muted-foreground flex items-center justify-between">
          <span>nightly 02:00 UTC via GitHub Actions</span>
          {lastRunAt && <span>last: {ago(lastRunAt)}</span>}
        </div>
        {runs.length === 0 ? (
          <div className="text-xs text-muted-foreground py-2">No runs recorded yet — first nightly will appear here.</div>
        ) : (
          <ul className="divide-y divide-border">
            {runs.map((r) => (
              <li key={r.id} className="py-1.5 flex items-center gap-2 text-xs">
                <span className="font-mono uppercase text-[10px] text-muted-foreground w-12">{r.suite}</span>
                <span className={`font-mono ${statusTone(r.status)}`}>{r.status}</span>
                <span className="text-muted-foreground">{r.passed ?? 0}/{r.total ?? 0}</span>
                <span className="text-[10px] text-muted-foreground ml-auto">{ago(r.created_at)}</span>
                {r.workflow_run_url && <a href={r.workflow_run_url} target="_blank" rel="noreferrer" className="text-[10px] underline">log</a>}
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* QA */}
      <section className="rounded-md border border-border bg-card p-3 space-y-2">
        <header className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-sm font-medium"><ClipboardCheck className="h-4 w-4" /> Phase QA</div>
          <RunButton state={qaState} onClick={runQa} label="Run probes" />
        </header>
        <div className="text-[10px] uppercase tracking-wide text-muted-foreground flex items-center justify-between">
          <span>weekly Fri 16:00 UTC</span>
          {qaMsg && <span className={statusTone(qaState === "error" ? "fail" : "pass")}>{qaMsg}</span>}
        </div>
        <div className="space-y-2 max-h-56 overflow-y-auto pr-1">
          {Object.entries(phaseGroups).map(([phase, items]) => (
            <div key={phase}>
              <div className="text-[10px] font-mono uppercase text-muted-foreground">{phase}</div>
              <ul>
                {items.map((c) => (
                  <li key={c.id} className="flex items-center gap-2 text-xs py-0.5">
                    <span className={`font-mono w-12 ${statusTone(c.status)}`}>{c.status}</span>
                    <span className="flex-1 truncate" title={c.note ?? c.criterion}>{c.criterion}</span>
                    <select
                      value={c.status}
                      onChange={(e) => setQaStatus(c.id, e.target.value)}
                      className="text-[10px] bg-transparent border border-border rounded px-1"
                    >
                      <option value="unknown">?</option>
                      <option value="pass">pass</option>
                      <option value="fail">fail</option>
                    </select>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
};
