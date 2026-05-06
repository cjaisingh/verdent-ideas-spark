import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { ShieldCheck, FlaskConical, ClipboardCheck, Loader2, ExternalLink, AlertTriangle, CheckCircle2, ChevronDown, ChevronRight, Check } from "lucide-react";
import { toast } from "@/hooks/use-toast";

type Finding = {
  id: string; created_at: string; severity: string; category: string | null;
  title: string; acknowledged: boolean; body: string | null; area: string | null;
  reviewer_model: string | null; diff_window_start: string | null; diff_window_end: string | null;
};
type TestRun = { id: string; created_at: string; suite: string; status: string; passed: number | null; failed: number | null; total: number | null; workflow_run_url: string | null };
type QaCheck = { id: string; phase_key: string; criterion: string; status: string; last_checked_at: string | null; note: string | null; kind?: string | null; probe?: string | null };
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
  const [expandedFindings, setExpandedFindings] = useState<Set<string>>(new Set());

  const toggleFinding = (id: string) => {
    setExpandedFindings((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const ackFinding = async (id: string, value: boolean) => {
    const { error } = await supabase.from("roadmap_review_findings" as any)
      .update({ acknowledged: value }).eq("id", id);
    if (error) toast({ title: "Update failed", description: error.message, variant: "destructive" });
  };

  // Render a body with simple file:line refs detected — turn `path/to/file.ts:42`
  // into a subtle highlight so the eye finds it. We don't link out (no editor URL).
  const renderBody = (body: string) => {
    const re = /([\w./@\-]+\.(?:tsx?|jsx?|css|sql|json|md|ya?ml))(?::(\d+))?/g;
    const parts: Array<string | { file: string; line?: string }> = [];
    let last = 0;
    for (const m of body.matchAll(re)) {
      const idx = m.index ?? 0;
      if (idx > last) parts.push(body.slice(last, idx));
      parts.push({ file: m[1], line: m[2] });
      last = idx + m[0].length;
    }
    if (last < body.length) parts.push(body.slice(last));
    return parts.map((p, i) =>
      typeof p === "string"
        ? <span key={i}>{p}</span>
        : <code key={i} className="px-1 py-0.5 mx-0.5 rounded bg-muted text-foreground font-mono text-[11px]">{p.file}{p.line ? `:${p.line}` : ""}</code>
    );
  };

  const load = async () => {
    const [f, r, q, a] = await Promise.all([
      supabase.from("roadmap_review_findings" as any).select("id, created_at, severity, category, title, acknowledged, body, area, reviewer_model, diff_window_start, diff_window_end")
        .order("created_at", { ascending: false }).limit(8),
      supabase.from("test_runs" as any).select("id, created_at, suite, status, passed, failed, total, workflow_run_url")
        .order("created_at", { ascending: false }).limit(4),
      supabase.from("qa_checks" as any).select("id, phase_key, criterion, status, last_checked_at, note, kind, probe")
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
  const lastReview = lastRunFor("scheduled-code-review");
  const lastQa = lastRunFor("qa-validate");
  const lastTestPost = lastRunFor("record-test-run");

  const LastRun = ({ run, emptyHint }: { run: AutoRun | null; emptyHint: string }) => {
    if (!run) return <div className="text-[10px] text-muted-foreground italic">{emptyHint}</div>;
    const isErr = run.status === "error";
    const isPartial = run.status === "partial";
    const Icon = isErr ? AlertTriangle : CheckCircle2;
    const tone = isErr
      ? "border-destructive/40 bg-destructive/5 text-destructive"
      : isPartial
      ? "border-amber-500/40 bg-amber-500/5 text-amber-700 dark:text-amber-400"
      : "border-emerald-500/30 bg-emerald-500/5 text-emerald-700 dark:text-emerald-400";
    return (
      <div className={`text-[11px] rounded border px-2 py-1.5 ${tone} space-y-0.5`}>
        <div className="flex items-center gap-1.5 font-mono text-[10px]">
          <Icon className="h-3 w-3 shrink-0" />
          <span className="uppercase">{run.status}</span>
          {run.status_code != null && <span>· {run.status_code}</span>}
          <span>· {run.trigger}</span>
          <span className="ml-auto opacity-70">{ago(run.created_at)}</span>
        </div>
        {run.message && <div className="leading-snug break-words" title={run.message}>{run.message}</div>}
      </div>
    );
  };

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
        <LastRun run={lastReview} emptyHint="No runs recorded yet — click Run now to test." />
        {findings.length === 0 ? (
          <div className="text-xs text-muted-foreground py-2">No findings yet.</div>
        ) : (
          <ul className="divide-y divide-border max-h-80 overflow-y-auto">
            {findings.map((f) => {
              const open = expandedFindings.has(f.id);
              return (
                <li key={f.id} className={`py-1.5 ${f.acknowledged ? "opacity-60" : ""}`}>
                  <button
                    type="button"
                    onClick={() => toggleFinding(f.id)}
                    className="w-full text-left space-y-0.5 group"
                    aria-expanded={open}
                  >
                    <div className="flex items-center gap-2">
                      {open ? <ChevronDown className="h-3 w-3 text-muted-foreground" /> : <ChevronRight className="h-3 w-3 text-muted-foreground" />}
                      <span className={`text-[10px] font-mono px-1.5 py-0.5 rounded border ${sevTone(f.severity)}`}>{f.severity}</span>
                      {f.category && <span className="text-[10px] text-muted-foreground font-mono">{f.category}</span>}
                      {f.area && <span className="text-[10px] text-muted-foreground font-mono truncate max-w-[40%]" title={f.area}>· {f.area}</span>}
                      {f.acknowledged && <Check className="h-3 w-3 text-emerald-600 dark:text-emerald-400" aria-label="acknowledged" />}
                      <span className="text-[10px] text-muted-foreground ml-auto">{ago(f.created_at)}</span>
                    </div>
                    <div className="text-xs leading-snug pl-5 group-hover:text-foreground">{f.title}</div>
                  </button>
                  {open && (
                    <div className="mt-2 ml-5 rounded border border-border bg-muted/30 p-2 space-y-2">
                      {f.body ? (
                        <div className="text-[12px] leading-relaxed whitespace-pre-wrap break-words text-foreground/90">
                          {renderBody(f.body)}
                        </div>
                      ) : (
                        <div className="text-[11px] text-muted-foreground italic">No additional context provided by reviewer.</div>
                      )}
                      <div className="flex items-center gap-3 text-[10px] text-muted-foreground font-mono pt-1 border-t border-border/60">
                        <span>{f.reviewer_model ?? "unknown model"}</span>
                        {f.diff_window_start && f.diff_window_end && (
                          <span title={`window: ${f.diff_window_start} → ${f.diff_window_end}`}>
                            window {ago(f.diff_window_start)} → {ago(f.diff_window_end)}
                          </span>
                        )}
                        <button
                          onClick={(e) => { e.stopPropagation(); ackFinding(f.id, !f.acknowledged); }}
                          className="ml-auto px-2 py-0.5 rounded border border-border hover:bg-muted hover:text-foreground"
                        >
                          {f.acknowledged ? "Unacknowledge" : "Acknowledge"}
                        </button>
                      </div>
                    </div>
                  )}
                </li>
              );
            })}
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
        <LastRun run={lastTestPost} emptyHint="No nightly POSTs received — once GitHub Actions runs, the latest call (incl. 401s) appears here." />
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
        <LastRun run={lastQa} emptyHint="No probe runs recorded yet — click Run probes to test." />
        <div className="space-y-3 max-h-72 overflow-y-auto pr-1">
          {Object.entries(phaseGroups).map(([phase, items]) => {
            const pass = items.filter((c) => c.status === "pass").length;
            const fail = items.filter((c) => c.status === "fail").length;
            return (
              <div key={phase} className="space-y-1">
                <div className="flex items-center gap-2 text-[10px] font-mono uppercase text-muted-foreground">
                  <span>{phase}</span>
                  <span className="ml-auto normal-case tracking-normal">
                    <span className="text-emerald-600 dark:text-emerald-400">{pass} pass</span>
                    {" · "}
                    <span className={fail ? "text-destructive" : ""}>{fail} fail</span>
                    {" · "}
                    <span>{items.length - pass - fail} unknown</span>
                  </span>
                </div>
                <ul className="space-y-1">
                  {items.map((c) => {
                    const isProbe = c.kind === "probe";
                    return (
                      <li key={c.id} className="rounded border border-border bg-background/40 px-2 py-1 space-y-0.5">
                        <div className="flex items-center gap-2 text-xs">
                          <span className={`font-mono uppercase text-[10px] w-10 ${statusTone(c.status)}`}>{c.status}</span>
                          <span
                            className={`text-[9px] font-mono px-1 rounded border ${
                              isProbe ? "border-blue-500/30 text-blue-600 dark:text-blue-400" : "border-border text-muted-foreground"
                            }`}
                            title={isProbe ? `automated probe: ${c.probe}` : "manual judgement"}
                          >
                            {isProbe ? "probe" : "manual"}
                          </span>
                          <span className="flex-1 truncate" title={c.criterion}>{c.criterion}</span>
                          <span className="text-[10px] text-muted-foreground shrink-0" title={c.last_checked_at ?? "never checked"}>
                            {c.last_checked_at ? ago(c.last_checked_at) : "never"}
                          </span>
                          <select
                            value={c.status}
                            onChange={(e) => setQaStatus(c.id, e.target.value)}
                            className="text-[10px] bg-transparent border border-border rounded px-1"
                            disabled={isProbe}
                            title={isProbe ? "Automated probe — runs via Run probes" : "Set status manually"}
                          >
                            <option value="unknown">?</option>
                            <option value="pass">pass</option>
                            <option value="fail">fail</option>
                          </select>
                        </div>
                        {c.note && (
                          <div className="text-[11px] text-muted-foreground leading-snug pl-12 break-words">
                            {c.note}
                          </div>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
};
