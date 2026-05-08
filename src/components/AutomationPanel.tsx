import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { ShieldCheck, FlaskConical, ClipboardCheck, Loader2, ExternalLink, AlertTriangle, CheckCircle2, ChevronDown, ChevronRight, Check, Moon, Calendar as CalendarIcon } from "lucide-react";
import { toast } from "@/hooks/use-toast";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { format } from "date-fns";
import { NightAgentCard } from "@/components/NightAgentCard";
import { NightAgentScheduleCard } from "@/components/NightAgentScheduleCard";
import { NightAgentTestModeCard } from "@/components/NightAgentTestModeCard";

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

  // Filters / sorting
  const [findingSev, setFindingSev] = useState<"all" | "high" | "medium" | "low" | "info">("all");
  const [findingAck, setFindingAck] = useState<"all" | "open" | "ack">("open");
  const [findingSort, setFindingSort] = useState<"newest" | "oldest" | "severity">("newest");
  const [runStatus, setRunStatus] = useState<"all" | "passed" | "failed" | "errored">("all");
  const [runSort, setRunSort] = useState<"newest" | "oldest">("newest");

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
        .order("created_at", { ascending: false }).limit(100),
      supabase.from("test_runs" as any).select("id, created_at, suite, status, passed, failed, total, workflow_run_url")
        .order("created_at", { ascending: false }).limit(50),
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

  const sevRank: Record<string, number> = { high: 0, medium: 1, low: 2, info: 3 };
  const filteredFindings = findings
    .filter((f) => findingSev === "all" || f.severity === findingSev)
    .filter((f) => findingAck === "all" || (findingAck === "ack" ? f.acknowledged : !f.acknowledged))
    .sort((a, b) => {
      if (findingSort === "severity") return (sevRank[a.severity] ?? 9) - (sevRank[b.severity] ?? 9);
      const da = new Date(a.created_at).getTime(), db = new Date(b.created_at).getTime();
      return findingSort === "oldest" ? da - db : db - da;
    });

  const filteredRuns = runs
    .filter((r) => {
      if (runStatus === "all") return true;
      if (runStatus === "passed") return r.status === "pass" || r.status === "passed";
      if (runStatus === "failed") return r.status === "fail" || r.status === "failed";
      if (runStatus === "errored") return r.status === "errored" || r.status === "error";
      return true;
    })
    .sort((a, b) => {
      const da = new Date(a.created_at).getTime(), db = new Date(b.created_at).getTime();
      return runSort === "oldest" ? da - db : db - da;
    });

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
    <div className="space-y-3">
    <AlertsCard />
    <PerJobCostThresholdsCard />
    <DailyAiSpendCard />
    <OvernightQueueCard />
    <CostAlertsCard />
    <NightAgentScheduleCard />
    <NightAgentCard />
    <NightAgentTestModeCard />
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
        <div className="flex flex-wrap items-center gap-1 text-[10px]">
          <select value={findingSev} onChange={(e) => setFindingSev(e.target.value as any)} className="bg-transparent border border-border rounded px-1 py-0.5">
            <option value="all">all severity</option>
            <option value="high">high</option>
            <option value="medium">medium</option>
            <option value="low">low</option>
            <option value="info">info</option>
          </select>
          <select value={findingAck} onChange={(e) => setFindingAck(e.target.value as any)} className="bg-transparent border border-border rounded px-1 py-0.5">
            <option value="open">open</option>
            <option value="ack">acknowledged</option>
            <option value="all">all</option>
          </select>
          <select value={findingSort} onChange={(e) => setFindingSort(e.target.value as any)} className="bg-transparent border border-border rounded px-1 py-0.5">
            <option value="newest">newest</option>
            <option value="oldest">oldest</option>
            <option value="severity">by severity</option>
          </select>
          <span className="ml-auto text-muted-foreground font-mono">{filteredFindings.length}/{findings.length}</span>
        </div>
        {filteredFindings.length === 0 ? (
          <div className="text-xs text-muted-foreground py-2">No findings match.</div>
        ) : (
          <ul className="divide-y divide-border max-h-80 overflow-y-auto">
            {filteredFindings.map((f) => {
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
        <div className="flex flex-wrap items-center gap-1 text-[10px]">
          <select value={runStatus} onChange={(e) => setRunStatus(e.target.value as any)} className="bg-transparent border border-border rounded px-1 py-0.5">
            <option value="all">all status</option>
            <option value="passed">passed</option>
            <option value="failed">failed</option>
            <option value="errored">errored</option>
          </select>
          <select value={runSort} onChange={(e) => setRunSort(e.target.value as any)} className="bg-transparent border border-border rounded px-1 py-0.5">
            <option value="newest">newest</option>
            <option value="oldest">oldest</option>
          </select>
          <span className="ml-auto text-muted-foreground font-mono">{filteredRuns.length}/{runs.length}</span>
        </div>
        {filteredRuns.length === 0 ? (
          <div className="text-xs text-muted-foreground py-2">No runs match.</div>
        ) : (
          <ul className="divide-y divide-border max-h-80 overflow-y-auto">
            {filteredRuns.map((r) => (
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
        {(() => {
          const probes = qa.filter((c) => c.kind === "probe");
          const total = probes.length;
          const pass = probes.filter((c) => c.status === "pass").length;
          const fail = probes.filter((c) => c.status === "fail").length;
          const unknown = total - pass - fail;
          const pct = total ? Math.round((pass / total) * 100) : 0;
          const running = qaState === "running";
          return (
            <div className="space-y-1">
              <div className="flex items-center justify-between text-[10px] font-mono text-muted-foreground">
                <span>probes {pass}/{total} passing{running ? " · running…" : ""}</span>
                <span>
                  <span className="text-emerald-600 dark:text-emerald-400">{pass}✓</span>
                  {" · "}
                  <span className={fail ? "text-destructive" : ""}>{fail}✗</span>
                  {" · "}
                  <span>{unknown}?</span>
                </span>
              </div>
              <div className="h-1.5 w-full rounded bg-muted overflow-hidden flex" aria-label={`probes progress ${pct}%`}>
                {total === 0 ? (
                  <div className={`h-full w-full ${running ? "animate-pulse bg-muted-foreground/30" : ""}`} />
                ) : (
                  <>
                    <div className="h-full bg-emerald-500/70" style={{ width: `${(pass / total) * 100}%` }} />
                    <div className="h-full bg-destructive/70" style={{ width: `${(fail / total) * 100}%` }} />
                    <div className={`h-full bg-muted-foreground/20 ${running ? "animate-pulse" : ""}`} style={{ width: `${(unknown / total) * 100}%` }} />
                  </>
                )}
              </div>
            </div>
          );
        })()}
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
    </div>
  );
};

type AlertSettings = {
  webhook_url: string | null; enabled: boolean;
  alert_on_review_error: boolean; alert_on_high_finding: boolean;
  alert_on_test_fail: boolean; alert_on_qa_fail: boolean;
  alert_on_cost: boolean;
  cost_per_run_usd: number | null;
  cost_per_day_usd: number | null;
  dedupe_minutes: number;
};
type AlertLog = {
  id: string; created_at: string; job: string; reason: string;
  message: string | null; delivered: boolean; status_code: number | null; error: string | null;
};

const AlertsCard = () => {
  const [s, setS] = useState<AlertSettings | null>(null);
  const [logs, setLogs] = useState<AlertLog[]>([]);
  const [draftUrl, setDraftUrl] = useState("");
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [costTesting, setCostTesting] = useState(false);

  const load = async () => {
    const [{ data: settings }, { data: log }] = await Promise.all([
      supabase.from("alert_settings" as any).select("*").eq("id", true).maybeSingle(),
      supabase.from("alert_log" as any).select("id, created_at, job, reason, message, delivered, status_code, error")
        .order("created_at", { ascending: false }).limit(8),
    ]);
    if (settings) {
      const cast = settings as unknown as AlertSettings;
      setS(cast);
      setDraftUrl(cast.webhook_url ?? "");
    }
    setLogs(((log ?? []) as unknown) as AlertLog[]);
  };

  useEffect(() => {
    load();
    const ch = supabase.channel("alerts_panel")
      .on("postgres_changes", { event: "*", schema: "public", table: "alert_settings" }, load)
      .on("postgres_changes", { event: "*", schema: "public", table: "alert_log" }, load)
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, []);

  const patch = async (changes: Partial<AlertSettings>) => {
    if (!s) return;
    const next = { ...s, ...changes };
    setS(next);
    const { error } = await supabase.from("alert_settings" as any)
      .update({ ...changes, updated_at: new Date().toISOString() }).eq("id", true);
    if (error) toast({ title: "Save failed", description: error.message, variant: "destructive" });
  };

  const saveUrl = async () => {
    setSaving(true);
    await patch({ webhook_url: draftUrl.trim() || null });
    setSaving(false);
    toast({ title: "Webhook saved" });
  };

  const sendTest = async () => {
    const url = draftUrl.trim();
    if (!url) { toast({ title: "Enter a webhook URL first", variant: "destructive" }); return; }
    setTesting(true);
    try {
      const r = await fetch(url, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: "🔔 Test alert from Roadmap Automation panel", job: "manual-test", reason: "test", ts: new Date().toISOString() }),
      });
      toast({ title: r.ok ? "Test sent" : `Test failed (${r.status})`, variant: r.ok ? "default" : "destructive" });
    } catch (e) {
      toast({ title: "Test failed", description: e instanceof Error ? e.message : String(e), variant: "destructive" });
    } finally { setTesting(false); }
  };

  const sendCostTest = async () => {
    if (!s) return;
    const url = (s.webhook_url ?? draftUrl).trim();
    if (!url) { toast({ title: "Save a webhook URL first", variant: "destructive" }); return; }
    const perRun = s.cost_per_run_usd;
    const perDay = s.cost_per_day_usd;
    const simulatedRun = perRun != null ? Number(perRun) + 0.01 : 0.5;
    const simulatedDay = perDay != null ? Number(perDay) + 0.01 : 1.0;
    const message = `TEST cost_threshold · simulated run $${simulatedRun.toFixed(4)} (per-run threshold ${perRun ?? "off"}) · simulated day total $${simulatedDay.toFixed(4)} (per-day threshold ${perDay ?? "off"})`;
    const payload = {
      test: true,
      scope: "manual_test",
      job: "manual-test",
      run_cost_usd: simulatedRun,
      day_cost_usd: simulatedDay,
      threshold_per_run_usd: perRun,
      threshold_per_day_usd: perDay,
    };
    setCostTesting(true);
    let delivered = false; let status_code: number | null = null; let error: string | null = null;
    try {
      const r = await fetch(url, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text: `🔔 manual-test · cost_threshold\n${message}`,
          job: "manual-test", reason: "cost_threshold", message, payload, ts: new Date().toISOString(),
        }),
      });
      status_code = r.status; delivered = r.ok;
      if (!r.ok) error = (await r.text()).slice(0, 300);
      toast({ title: r.ok ? "Cost alert sent" : `Cost alert failed (${r.status})`, variant: r.ok ? "default" : "destructive" });
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
      toast({ title: "Cost alert failed", description: error, variant: "destructive" });
    } finally {
      try {
        await supabase.from("alert_log" as any).insert({
          job: "manual-test", reason: "cost_threshold", message, delivered, status_code, error, payload,
        });
      } catch { /* ignore log insert errors */ }
      setCostTesting(false);
    }
  };

  if (!s) return null;

  const Toggle = ({ k, label }: { k: keyof AlertSettings; label: string }) => (
    <label className="inline-flex items-center gap-1 text-[11px] cursor-pointer">
      <input type="checkbox" className="accent-foreground" checked={Boolean(s[k])} onChange={(e) => patch({ [k]: e.target.checked } as any)} />
      {label}
    </label>
  );

  return (
    <section className="rounded-md border border-border bg-card p-3 space-y-2">
      <header className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-sm font-medium">
          <AlertTriangle className="h-4 w-4" /> Failure alerts
          <label className="ml-2 inline-flex items-center gap-1 text-[11px] cursor-pointer">
            <input type="checkbox" className="accent-foreground" checked={s.enabled} onChange={(e) => patch({ enabled: e.target.checked })} />
            enabled
          </label>
        </div>
        <span className="text-[10px] text-muted-foreground">POST JSON · works with Slack/Discord webhooks or any URL</span>
      </header>

      <div className="flex items-center gap-2">
        <input
          type="url" placeholder="https://hooks.slack.com/services/…  or  https://discord.com/api/webhooks/…"
          value={draftUrl} onChange={(e) => setDraftUrl(e.target.value)}
          className="flex-1 text-xs bg-background border border-border rounded px-2 py-1 font-mono"
        />
        <button onClick={saveUrl} disabled={saving}
          className="text-[11px] px-2 py-1 rounded border border-border hover:bg-muted disabled:opacity-50">
          {saving ? "Saving…" : "Save"}
        </button>
        <button onClick={sendTest} disabled={testing}
          className="text-[11px] px-2 py-1 rounded border border-border hover:bg-muted disabled:opacity-50">
          {testing ? "Sending…" : "Send test"}
        </button>
      </div>

      <div className="flex flex-wrap items-center gap-3 text-muted-foreground">
        <Toggle k="alert_on_review_error" label="code review errors" />
        <Toggle k="alert_on_high_finding" label="new high-severity findings" />
        <Toggle k="alert_on_test_fail" label="test failures" />
        <Toggle k="alert_on_qa_fail" label="QA probe failures" />
        <Toggle k="alert_on_cost" label="cost overruns" />
        <label className="inline-flex items-center gap-1 text-[11px] ml-auto">
          dedupe
          <input type="number" min={0} max={1440} value={s.dedupe_minutes}
            onChange={(e) => patch({ dedupe_minutes: Math.max(0, parseInt(e.target.value || "0", 10)) })}
            className="w-14 bg-background border border-border rounded px-1 py-0.5 text-right" />
          min
        </label>
      </div>

      <div className="flex flex-wrap items-center gap-3 text-[11px] text-muted-foreground">
        <span className="font-medium text-foreground">Cost thresholds (USD)</span>
        <label className="inline-flex items-center gap-1">
          per run &gt;
          <input type="number" min={0} step={0.01} value={s.cost_per_run_usd ?? ""}
            placeholder="off"
            onChange={(e) => {
              const v = e.target.value === "" ? null : Math.max(0, parseFloat(e.target.value));
              patch({ cost_per_run_usd: v });
            }}
            className="w-20 bg-background border border-border rounded px-1 py-0.5 text-right" />
        </label>
        <label className="inline-flex items-center gap-1">
          per day &gt;
          <input type="number" min={0} step={0.01} value={s.cost_per_day_usd ?? ""}
            placeholder="off"
            onChange={(e) => {
              const v = e.target.value === "" ? null : Math.max(0, parseFloat(e.target.value));
              patch({ cost_per_day_usd: v });
            }}
            className="w-20 bg-background border border-border rounded px-1 py-0.5 text-right" />
        </label>
        <span className="text-[10px] opacity-70">leave blank to disable</span>
        <button onClick={sendCostTest} disabled={costTesting}
          className="ml-auto text-[11px] px-2 py-1 rounded border border-border hover:bg-muted disabled:opacity-50">
          {costTesting ? "Sending…" : "Test cost alert"}
        </button>
      </div>

      {logs.length > 0 && (
        <ul className="divide-y divide-border max-h-32 overflow-y-auto text-[11px]">
          {logs.map((l) => (
            <li key={l.id} className="py-1 flex items-center gap-2">
              {l.delivered
                ? <CheckCircle2 className="h-3 w-3 text-emerald-600 dark:text-emerald-400 shrink-0" />
                : <AlertTriangle className="h-3 w-3 text-destructive shrink-0" />}
              <span className="font-mono text-muted-foreground">{l.job}</span>
              <span className="text-muted-foreground">·</span>
              <span className="font-mono">{l.reason}</span>
              {l.status_code != null && <span className="text-muted-foreground">· {l.status_code}</span>}
              <span className="truncate flex-1" title={l.error ?? l.message ?? ""}>{l.error ?? l.message}</span>
              <span className="text-muted-foreground shrink-0">{ago(l.created_at)}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
};

type CostAlertRow = {
  id: string; created_at: string; job: string; message: string | null;
  delivered: boolean; status_code: number | null;
  payload: {
    scope?: string; job?: string;
    run_cost_usd?: number | null; day_cost_usd?: number | null;
    threshold_usd?: number | null;
    threshold_per_run_usd?: number | null; threshold_per_day_usd?: number | null;
    test?: boolean;
  } | null;
};

const fmtUsd = (n: number | null | undefined) =>
  n == null || Number.isNaN(Number(n)) ? "—" : `$${Number(n).toFixed(4)}`;

const CostAlertsCard = () => {
  const [rows, setRows] = useState<CostAlertRow[]>([]);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    const { data } = await supabase
      .from("alert_log" as any)
      .select("id, created_at, job, message, delivered, status_code, payload")
      .eq("reason", "cost_threshold")
      .order("created_at", { ascending: false })
      .limit(25);
    setRows(((data ?? []) as unknown) as CostAlertRow[]);
    setLoading(false);
  };

  useEffect(() => {
    load();
    const ch = supabase.channel("cost_alerts_panel")
      .on("postgres_changes",
        { event: "INSERT", schema: "public", table: "alert_log", filter: "reason=eq.cost_threshold" },
        load)
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, []);

  return (
    <section className="rounded-md border border-border bg-card p-3 space-y-2">
      <header className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-sm font-medium">
          <AlertTriangle className="h-4 w-4" /> Cost alert history
        </div>
        <span className="text-[10px] text-muted-foreground">
          last {rows.length} cost_threshold alert{rows.length === 1 ? "" : "s"}
        </span>
      </header>

      {loading ? (
        <div className="text-[11px] text-muted-foreground">Loading…</div>
      ) : rows.length === 0 ? (
        <div className="text-[11px] text-muted-foreground">
          No cost alerts yet. Configure thresholds above and they'll appear here when crossed.
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-[11px]">
            <thead className="text-[10px] uppercase tracking-wide text-muted-foreground">
              <tr className="text-left">
                <th className="py-1 pr-2 font-medium">When</th>
                <th className="py-1 pr-2 font-medium">Job</th>
                <th className="py-1 pr-2 font-medium">Scope</th>
                <th className="py-1 pr-2 font-medium text-right">Run cost</th>
                <th className="py-1 pr-2 font-medium text-right">Day total</th>
                <th className="py-1 pr-2 font-medium text-right">Threshold</th>
                <th className="py-1 pr-2 font-medium">Delivered</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {rows.map((r) => {
                const p = r.payload ?? {};
                const scope = p.scope ?? "—";
                const isPerRun = scope === "per_run";
                const isPerDay = scope === "per_day";
                const threshold =
                  p.threshold_usd ??
                  (isPerRun ? p.threshold_per_run_usd : isPerDay ? p.threshold_per_day_usd : null);
                return (
                  <tr key={r.id} className="align-top">
                    <td className="py-1 pr-2 text-muted-foreground whitespace-nowrap">{ago(r.created_at)}</td>
                    <td className="py-1 pr-2 font-mono">{p.job ?? r.job}{p.test ? " (test)" : ""}</td>
                    <td className="py-1 pr-2">
                      <span className="px-1.5 py-0.5 rounded border border-border text-[10px]">{scope}</span>
                    </td>
                    <td className="py-1 pr-2 font-mono text-right">{fmtUsd(p.run_cost_usd)}</td>
                    <td className="py-1 pr-2 font-mono text-right">{fmtUsd(p.day_cost_usd)}</td>
                    <td className="py-1 pr-2 font-mono text-right">{fmtUsd(threshold)}</td>
                    <td className="py-1 pr-2">
                      {r.delivered
                        ? <span className="inline-flex items-center gap-1 text-emerald-600 dark:text-emerald-400">
                            <CheckCircle2 className="h-3 w-3" />{r.status_code ?? "ok"}
                          </span>
                        : <span className="inline-flex items-center gap-1 text-destructive">
                            <AlertTriangle className="h-3 w-3" />{r.status_code ?? "fail"}
                          </span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
};

type JobThreshold = {
  job: string;
  cost_per_run_usd: number | null;
  cost_per_day_usd: number | null;
  alert_on_cost: boolean;
  updated_at?: string;
};

const KNOWN_JOBS = ["daily-plan", "scheduled-code-review"];

const PerJobCostThresholdsCard = () => {
  const [rows, setRows] = useState<JobThreshold[]>([]);
  const [draftJob, setDraftJob] = useState("");
  const [busy, setBusy] = useState(false);

  const load = async () => {
    const { data } = await supabase
      .from("alert_cost_thresholds" as any)
      .select("job, cost_per_run_usd, cost_per_day_usd, alert_on_cost, updated_at")
      .order("job", { ascending: true });
    setRows(((data ?? []) as unknown) as JobThreshold[]);
  };

  useEffect(() => {
    load();
    const ch = supabase.channel("per_job_thresholds")
      .on("postgres_changes", { event: "*", schema: "public", table: "alert_cost_thresholds" }, load)
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, []);

  const upsert = async (job: string, changes: Partial<JobThreshold>) => {
    const existing = rows.find(r => r.job === job);
    const next: JobThreshold = {
      job,
      cost_per_run_usd: existing?.cost_per_run_usd ?? null,
      cost_per_day_usd: existing?.cost_per_day_usd ?? null,
      alert_on_cost: existing?.alert_on_cost ?? true,
      ...changes,
    };
    setRows(prev => {
      const others = prev.filter(r => r.job !== job);
      return [...others, next].sort((a, b) => a.job.localeCompare(b.job));
    });
    const { error } = await supabase.from("alert_cost_thresholds" as any)
      .upsert({ ...next, updated_at: new Date().toISOString() }, { onConflict: "job" });
    if (error) toast({ title: "Save failed", description: error.message, variant: "destructive" });
  };

  const remove = async (job: string) => {
    setRows(prev => prev.filter(r => r.job !== job));
    const { error } = await supabase.from("alert_cost_thresholds" as any).delete().eq("job", job);
    if (error) toast({ title: "Delete failed", description: error.message, variant: "destructive" });
  };

  const addJob = async () => {
    const j = draftJob.trim();
    if (!j) return;
    if (rows.some(r => r.job === j)) { toast({ title: "Job already configured" }); return; }
    setBusy(true);
    await upsert(j, {});
    setDraftJob("");
    setBusy(false);
  };

  const presetSuggestions = KNOWN_JOBS.filter(j => !rows.some(r => r.job === j));

  return (
    <section className="rounded-md border border-border bg-card p-3 space-y-2">
      <header className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-sm font-medium">
          <AlertTriangle className="h-4 w-4" /> Per-job cost thresholds
        </div>
        <span className="text-[10px] text-muted-foreground">overrides global thresholds when set</span>
      </header>

      <div className="flex flex-wrap items-center gap-2">
        <input
          type="text" placeholder="job name (e.g. daily-plan)"
          value={draftJob} onChange={(e) => setDraftJob(e.target.value)}
          className="text-xs bg-background border border-border rounded px-2 py-1 font-mono w-56"
        />
        <button onClick={addJob} disabled={busy || !draftJob.trim()}
          className="text-[11px] px-2 py-1 rounded border border-border hover:bg-muted disabled:opacity-50">
          Add override
        </button>
        {presetSuggestions.map(j => (
          <button key={j} onClick={() => setDraftJob(j)}
            className="text-[10px] px-1.5 py-0.5 rounded border border-dashed border-border text-muted-foreground hover:bg-muted">
            + {j}
          </button>
        ))}
      </div>

      {rows.length === 0 ? (
        <div className="text-[11px] text-muted-foreground">
          No per-job overrides — every job uses the global thresholds set above.
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-[11px]">
            <thead className="text-[10px] uppercase tracking-wide text-muted-foreground">
              <tr className="text-left">
                <th className="py-1 pr-2 font-medium">Job</th>
                <th className="py-1 pr-2 font-medium text-right">Per-run $ &gt;</th>
                <th className="py-1 pr-2 font-medium text-right">Per-day $ &gt;</th>
                <th className="py-1 pr-2 font-medium">Alert</th>
                <th className="py-1 pr-2 font-medium text-right"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {rows.map(r => (
                <tr key={r.job}>
                  <td className="py-1 pr-2 font-mono">{r.job}</td>
                  <td className="py-1 pr-2 text-right">
                    <input type="number" min={0} step={0.01}
                      value={r.cost_per_run_usd ?? ""} placeholder="off"
                      onChange={(e) => {
                        const v = e.target.value === "" ? null : Math.max(0, parseFloat(e.target.value));
                        upsert(r.job, { cost_per_run_usd: v });
                      }}
                      className="w-20 bg-background border border-border rounded px-1 py-0.5 text-right" />
                  </td>
                  <td className="py-1 pr-2 text-right">
                    <input type="number" min={0} step={0.01}
                      value={r.cost_per_day_usd ?? ""} placeholder="off"
                      onChange={(e) => {
                        const v = e.target.value === "" ? null : Math.max(0, parseFloat(e.target.value));
                        upsert(r.job, { cost_per_day_usd: v });
                      }}
                      className="w-20 bg-background border border-border rounded px-1 py-0.5 text-right" />
                  </td>
                  <td className="py-1 pr-2">
                    <label className="inline-flex items-center gap-1 cursor-pointer">
                      <input type="checkbox" className="accent-foreground"
                        checked={r.alert_on_cost}
                        onChange={(e) => upsert(r.job, { alert_on_cost: e.target.checked })} />
                      enabled
                    </label>
                  </td>
                  <td className="py-1 pr-2 text-right">
                    <button onClick={() => remove(r.job)}
                      className="text-[10px] px-1.5 py-0.5 rounded border border-border hover:bg-destructive hover:text-destructive-foreground">
                      remove
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="text-[10px] text-muted-foreground mt-1">
            Leave a field blank to fall back to the global threshold for that scope. Disable "alert" to silence cost alerts for a single job.
          </div>
        </div>
      )}
    </section>
  );
};

// ─────────────────────────────────────────────────────────────────────────
// Daily AI spend — chart + breakdowns from ai_usage_log
// ─────────────────────────────────────────────────────────────────────────
type SpendRow = {
  id?: string;
  created_at: string;
  job: string | null;
  model: string | null;
  cost_usd: number | null;
  prompt_tokens: number | null;
  completion_tokens: number | null;
  price_in_per_mtok: number | null;
  price_out_per_mtok: number | null;
  latency_ms: number | null;
  status: string | null;
  error: string | null;
  request_ref: any;
};

const fmtUsd6 = (n: number) =>
  n >= 1 ? `$${n.toFixed(2)}` : `$${n.toFixed(4)}`;
const fmtUsdFull = (n: number) => `$${n.toFixed(6)}`;

// Date helpers (UTC-based to match the rest of the panel)
const startOfUtcDay = (d: Date) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
const endExclusiveUtcDay = (d: Date) => new Date(startOfUtcDay(d).getTime() + 86_400_000);
const utcDayKey = (d: Date) => startOfUtcDay(d).toISOString().slice(0, 10);
const enumerateUtcDays = (from: Date, to: Date) => {
  const out: string[] = [];
  let cur = startOfUtcDay(from).getTime();
  const end = startOfUtcDay(to).getTime();
  while (cur <= end) { out.push(new Date(cur).toISOString().slice(0, 10)); cur += 86_400_000; }
  return out;
};
const RANGE_STORAGE_KEY = "awip.spend.range";
const defaultRange = () => {
  const to = startOfUtcDay(new Date());
  const from = new Date(to.getTime() - 13 * 86_400_000);
  return { from, to };
};
const loadStoredRange = (): { from: Date; to: Date } => {
  try {
    const raw = localStorage.getItem(RANGE_STORAGE_KEY);
    if (!raw) return defaultRange();
    const p = JSON.parse(raw);
    const from = new Date(p.from); const to = new Date(p.to);
    if (isNaN(from.getTime()) || isNaN(to.getTime())) return defaultRange();
    return { from: startOfUtcDay(from), to: startOfUtcDay(to) };
  } catch { return defaultRange(); }
};

const DailyAiSpendCard = () => {
  const [rows, setRows] = useState<SpendRow[]>([]);
  const [range, setRange] = useState<{ from: Date; to: Date }>(loadStoredRange);
  const [pendingRange, setPendingRange] = useState<{ from?: Date; to?: Date }>(range);
  const [popoverOpen, setPopoverOpen] = useState(false);
  const [groupBy, setGroupBy] = useState<"job" | "model">("job");
  const [metric, setMetric] = useState<"spend" | "prompt" | "completion">("spend");
  const [loading, setLoading] = useState(true);
  const [capped, setCapped] = useState(false);
  const [drill, setDrill] = useState<{ day: string; groupKey: string | null; breachOnly?: boolean } | null>(null);
  const [globalLimits, setGlobalLimits] = useState<{ day: number | null; run: number | null }>({ day: null, run: null });
  const [jobLimits, setJobLimits] = useState<Record<string, { day: number | null; run: number | null }>>({});

  useEffect(() => {
    try { localStorage.setItem(RANGE_STORAGE_KEY, JSON.stringify({ from: range.from.toISOString(), to: range.to.toISOString() })); } catch { /* ignore */ }
  }, [range]);

  useEffect(() => {
    let active = true;
    const loadLimits = async () => {
      const [s, t] = await Promise.all([
        supabase.from("alert_settings").select("cost_per_day_usd, cost_per_run_usd, alert_on_cost").eq("id", true).maybeSingle(),
        supabase.from("alert_cost_thresholds").select("job, cost_per_day_usd, cost_per_run_usd, alert_on_cost"),
      ]);
      if (!active) return;
      const enabled = s.data?.alert_on_cost !== false;
      setGlobalLimits({
        day: enabled && s.data?.cost_per_day_usd != null ? Number(s.data.cost_per_day_usd) : null,
        run: enabled && s.data?.cost_per_run_usd != null ? Number(s.data.cost_per_run_usd) : null,
      });
      const map: Record<string, { day: number | null; run: number | null }> = {};
      for (const r of (t.data || [])) {
        if (r.alert_on_cost === false) continue;
        map[r.job] = {
          day: r.cost_per_day_usd != null ? Number(r.cost_per_day_usd) : null,
          run: r.cost_per_run_usd != null ? Number(r.cost_per_run_usd) : null,
        };
      }
      setJobLimits(map);
    };
    loadLimits();
    const ch = supabase.channel("ai_spend_limits")
      .on("postgres_changes", { event: "*", schema: "public", table: "alert_settings" }, loadLimits)
      .on("postgres_changes", { event: "*", schema: "public", table: "alert_cost_thresholds" }, loadLimits)
      .subscribe();
    return () => { active = false; supabase.removeChannel(ch); };
  }, []);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      const { data, error } = await supabase
        .from("ai_usage_log")
        .select("id, created_at, job, model, cost_usd, prompt_tokens, completion_tokens, price_in_per_mtok, price_out_per_mtok, latency_ms, status, error, request_ref")
        .gte("created_at", startOfUtcDay(range.from).toISOString())
        .lt("created_at", endExclusiveUtcDay(range.to).toISOString())
        .order("created_at", { ascending: false })
        .limit(5000);
      if (!cancelled) {
        if (error) toast({ title: "Failed to load AI spend", description: error.message, variant: "destructive" });
        const list = (data as SpendRow[]) || [];
        setRows(list);
        setCapped(list.length === 5000);
        setLoading(false);
      }
    };
    load();
    const ch = supabase.channel("ai_spend_panel")
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "ai_usage_log" }, load)
      .subscribe();
    return () => { cancelled = true; supabase.removeChannel(ch); };
  }, [range.from.getTime(), range.to.getTime()]);

  const dayKeys = enumerateUtcDays(range.from, range.to);
  const daysSpan = Math.max(1, dayKeys.length);
  const sparseLabels = daysSpan > 31;
  const groupKeyOf = (r: SpendRow) =>
    (groupBy === "job" ? r.job : r.model) || "unknown";

  const valueOf = (r: SpendRow) =>
    metric === "spend" ? Number(r.cost_usd || 0)
    : metric === "prompt" ? Number(r.prompt_tokens || 0)
    : Number(r.completion_tokens || 0);
  const fmtMetric = (n: number) =>
    metric === "spend" ? fmtUsd6(n) : `${Math.round(n).toLocaleString()} tok`;
  const metricLabel =
    metric === "spend" ? "spend" : metric === "prompt" ? "prompt tokens" : "completion tokens";

  const groups = Array.from(new Set(rows.map(groupKeyOf))).sort();
  const matrix: Record<string, Record<string, number>> = {};
  const costMatrix: Record<string, Record<string, number>> = {};
  for (const d of dayKeys) { matrix[d] = {}; costMatrix[d] = {}; }
  let total = 0;
  let totalCostAll = 0;
  let totalTokens = 0;
  for (const r of rows) {
    const day = (r.created_at || "").slice(0, 10);
    if (!matrix[day]) continue;
    const key = groupKeyOf(r);
    const v = valueOf(r);
    const cost = Number(r.cost_usd || 0);
    matrix[day][key] = (matrix[day][key] || 0) + v;
    costMatrix[day][key] = (costMatrix[day][key] || 0) + cost;
    total += v;
    totalCostAll += cost;
    totalTokens += Number(r.prompt_tokens || 0) + Number(r.completion_tokens || 0);
  }
  const dailyTotals = dayKeys.map((d) =>
    Object.values(matrix[d]).reduce((a, b) => a + b, 0));
  const dailyCostTotals = dayKeys.map((d) =>
    Object.values(costMatrix[d]).reduce((a, b) => a + b, 0));
  const maxDay = Math.max(0.0001, ...dailyTotals);

  // top breakdown for whichever grouping is active (in selected metric)
  const breakdown: Array<{ key: string; cost: number }> = groups
    .map((g) => ({
      key: g,
      cost: dayKeys.reduce((sum, d) => sum + (matrix[d][g] || 0), 0),
    }))
    .sort((a, b) => b.cost - a.cost);

  const palette = [
    "hsl(var(--primary))",
    "hsl(var(--destructive))",
    "hsl(38 92% 50%)",
    "hsl(160 70% 40%)",
    "hsl(220 70% 55%)",
    "hsl(280 60% 55%)",
    "hsl(20 80% 55%)",
    "hsl(190 70% 45%)",
  ];
  const colorFor = (key: string) =>
    palette[groups.indexOf(key) % palette.length];

  // Threshold breach derivations (always computed against cost, regardless of metric)
  const effectiveRunLimit = (job: string | null | undefined) =>
    (job && jobLimits[job]?.run != null) ? jobLimits[job]!.run! : globalLimits.run;
  const dayBreaches = new Set<string>();
  if (globalLimits.day != null) {
    dayKeys.forEach((d, i) => { if (dailyCostTotals[i] > globalLimits.day!) dayBreaches.add(d); });
  }
  const cellBreaches = new Set<string>(); // "day|job"
  if (groupBy === "job") {
    for (const d of dayKeys) {
      for (const job of Object.keys(costMatrix[d])) {
        const lim = jobLimits[job]?.day;
        if (lim != null && costMatrix[d][job] > lim) cellBreaches.add(`${d}|${job}`);
      }
    }
  }
  const runBreachCount = rows.filter(r => {
    const lim = effectiveRunLimit(r.job);
    return lim != null && Number(r.cost_usd || 0) > lim;
  }).length;
  const hasAnyJobLimit = Object.keys(jobLimits).length > 0;
  const hasAnyLimit = globalLimits.day != null || globalLimits.run != null || hasAnyJobLimit;
  const showThresholds = metric === "spend";
  const dailyLimitPct = (showThresholds && globalLimits.day != null)
    ? Math.min(100, (globalLimits.day / maxDay) * 100) : null;

  return (
    <section className="rounded-md border border-border bg-card p-3 space-y-3">
      <header className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-2 text-sm font-medium">
          <ClipboardCheck className="h-4 w-4" /> Daily AI spend
          <span className="text-[10px] text-muted-foreground font-normal">
            from ai_usage_log
          </span>
        </div>
        <div className="flex items-center gap-2 text-[10px] flex-wrap">
          <Popover open={popoverOpen} onOpenChange={(o) => { setPopoverOpen(o); if (o) setPendingRange(range); }}>
            <PopoverTrigger asChild>
              <Button variant="outline" size="sm" className="h-7 px-2 text-[11px] font-mono gap-1.5">
                <CalendarIcon className="h-3 w-3" />
                {format(range.from, "MMM dd")} → {format(range.to, "MMM dd")}
                <span className="text-muted-foreground">({daysSpan}d)</span>
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-auto p-0" align="end">
              <div className="p-2 border-b border-border flex flex-wrap gap-1">
                {([
                  { label: "7d", from: new Date(Date.now() - 6 * 86_400_000), to: new Date() },
                  { label: "14d", from: new Date(Date.now() - 13 * 86_400_000), to: new Date() },
                  { label: "30d", from: new Date(Date.now() - 29 * 86_400_000), to: new Date() },
                  { label: "90d", from: new Date(Date.now() - 89 * 86_400_000), to: new Date() },
                  (() => { const n = new Date(); return { label: "This month", from: new Date(Date.UTC(n.getUTCFullYear(), n.getUTCMonth(), 1)), to: n }; })(),
                  (() => { const n = new Date(); const from = new Date(Date.UTC(n.getUTCFullYear(), n.getUTCMonth() - 1, 1)); const to = new Date(Date.UTC(n.getUTCFullYear(), n.getUTCMonth(), 0)); return { label: "Last month", from, to }; })(),
                ]).map((p) => (
                  <Button key={p.label} variant="ghost" size="sm" className="h-6 px-2 text-[10px]"
                    onClick={() => {
                      const from = startOfUtcDay(p.from); const to = startOfUtcDay(p.to);
                      setRange({ from, to }); setPendingRange({ from, to }); setPopoverOpen(false);
                    }}
                  >{p.label}</Button>
                ))}
              </div>
              <Calendar
                mode="range"
                selected={{ from: pendingRange.from, to: pendingRange.to }}
                onSelect={(r: any) => setPendingRange({ from: r?.from, to: r?.to })}
                numberOfMonths={2}
                disabled={(d) => d > new Date() || d < new Date(Date.now() - 366 * 86_400_000)}
                className="p-3 pointer-events-auto"
              />
              <div className="p-2 border-t border-border flex justify-end gap-2">
                <Button variant="ghost" size="sm" className="h-7 text-[11px]" onClick={() => setPopoverOpen(false)}>Cancel</Button>
                <Button size="sm" className="h-7 text-[11px]"
                  disabled={!pendingRange.from || !pendingRange.to}
                  onClick={() => {
                    if (pendingRange.from && pendingRange.to) {
                      setRange({ from: startOfUtcDay(pendingRange.from), to: startOfUtcDay(pendingRange.to) });
                      setPopoverOpen(false);
                    }
                  }}
                >Apply</Button>
              </div>
            </PopoverContent>
          </Popover>
          <div className="inline-flex rounded border border-border overflow-hidden">
            {([
              { k: "spend", label: "$ Spend" },
              { k: "prompt", label: "Prompt tok" },
              { k: "completion", label: "Completion tok" },
            ] as const).map((m) => (
              <button
                key={m.k}
                onClick={() => setMetric(m.k)}
                className={`px-2 py-0.5 ${metric === m.k ? "bg-muted text-foreground" : "text-muted-foreground hover:text-foreground"}`}
              >{m.label}</button>
            ))}
          </div>
          <div className="inline-flex rounded border border-border overflow-hidden">
            {(["job", "model"] as const).map((g) => (
              <button
                key={g}
                onClick={() => setGroupBy(g)}
                className={`px-2 py-0.5 ${groupBy === g ? "bg-muted text-foreground" : "text-muted-foreground hover:text-foreground"}`}
              >by {g}</button>
            ))}
          </div>
        </div>
      </header>

      <div className={`grid grid-cols-2 ${hasAnyLimit ? "sm:grid-cols-5" : "sm:grid-cols-4"} gap-2 text-xs`}>
        <div className="rounded border border-border p-2">
          <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Total ({metricLabel})</div>
          <div className="font-mono">{fmtMetric(total)}</div>
        </div>
        <div className="rounded border border-border p-2">
          <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Avg / day</div>
          <div className="font-mono">{fmtMetric(total / daysSpan)}</div>
        </div>
        <div className="rounded border border-border p-2">
          <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Calls</div>
          <div className="font-mono">{rows.length}</div>
        </div>
        <div className="rounded border border-border p-2">
          <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Tokens</div>
          <div className="font-mono">{totalTokens.toLocaleString()}</div>
        </div>
        {hasAnyLimit && (
          <button
            type="button"
            onClick={() => (dayBreaches.size + cellBreaches.size + runBreachCount > 0) && setDrill({ day: "*", groupKey: null, breachOnly: true })}
            className={`rounded border p-2 text-left transition ${(dayBreaches.size + cellBreaches.size + runBreachCount) > 0 ? "border-destructive/40 bg-destructive/10 hover:bg-destructive/15" : "border-border opacity-70"}`}
            title={(dayBreaches.size + cellBreaches.size + runBreachCount) > 0 ? "Show breaching runs" : "No breaches in range"}
          >
            <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Breaches</div>
            <div className="font-mono text-[11px]">
              {dayBreaches.size}<span className="text-muted-foreground">d</span>·{cellBreaches.size}<span className="text-muted-foreground">j</span>·{runBreachCount}<span className="text-muted-foreground">r</span>
            </div>
          </button>
        )}
      </div>

      {loading ? (
        <div className="text-xs text-muted-foreground">Loading…</div>
      ) : rows.length === 0 ? (
        <div className="text-xs text-muted-foreground">
          No ai_usage_log entries between {format(range.from, "MMM dd")} and {format(range.to, "MMM dd")}.
        </div>
      ) : (
        <>
          {capped && (
            <div className="text-[10px] rounded border border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-400 px-2 py-1">
              Showing first 5,000 rows for this range — narrow the dates for full totals.
            </div>
          )}
          {/* Stacked bar chart */}
          <div className="relative">
            {dailyLimitPct != null && (
              <>
                <div
                  className="absolute left-0 right-0 border-t border-dashed border-destructive/70 pointer-events-none z-10"
                  style={{ bottom: `calc(12px + (100% - 12px) * ${dailyLimitPct / 100})` }}
                />
                <div
                  className="absolute right-0 text-[9px] font-mono text-destructive bg-card px-1 pointer-events-none z-10"
                  style={{ bottom: `calc(12px + (100% - 12px) * ${dailyLimitPct / 100} - 6px)` }}
                >daily limit {fmtUsd6(globalLimits.day!)}</div>
              </>
            )}
            <div className={`flex items-end ${daysSpan > 31 ? "gap-0.5" : "gap-1"} h-32 border-b border-border pb-1`}>
              {dayKeys.map((d, idx) => {
                const dayTotal = dailyTotals[idx];
                const heightPct = (dayTotal / maxDay) * 100;
                const segments = groups
                  .map((g) => ({ g, c: matrix[d][g] || 0 }))
                  .filter((s) => s.c > 0);
                const showLabel = !sparseLabels || idx === 0 || idx === dayKeys.length - 1 || idx % 7 === 0;
                const dayBreached = showThresholds && dayBreaches.has(d);
                return (
                  <div key={d} className="flex-1 flex flex-col items-center gap-1 group min-w-0">
                    <div
                      className={`w-full flex flex-col-reverse rounded-sm overflow-hidden cursor-pointer ${dayBreached ? "bg-destructive/10 ring-1 ring-destructive/40" : "bg-muted/40 hover:ring-1 hover:ring-border"}`}
                      style={{ height: `${Math.max(heightPct, dayTotal > 0 ? 2 : 0)}%`, minHeight: dayTotal > 0 ? 2 : 0 }}
                      title={`${d} · ${fmtMetric(dayTotal)}\n${segments.map(s => `${(showThresholds && cellBreaches.has(`${d}|${s.g}`)) ? "⚠ " : ""}${s.g}: ${fmtMetric(s.c)}`).join("\n")}${dayBreached ? `\n⚠ over daily limit by ${fmtUsd6(dailyCostTotals[idx] - globalLimits.day!)}` : ""}\n(click for runs)`}
                      onClick={() => dayTotal > 0 && setDrill({ day: d, groupKey: null })}
                    >
                      {segments.map((s) => {
                        const segBreached = showThresholds && cellBreaches.has(`${d}|${s.g}`);
                        return (
                          <div
                            key={s.g}
                            className={`cursor-pointer hover:opacity-80 ${segBreached ? "outline outline-1 outline-destructive" : ""}`}
                            style={{
                              height: `${(s.c / dayTotal) * 100}%`,
                              background: colorFor(s.g),
                            }}
                            onClick={(e) => { e.stopPropagation(); setDrill({ day: d, groupKey: s.g }); }}
                            title={`${segBreached ? "⚠ " : ""}${s.g} · ${fmtMetric(s.c)} (click for runs)`}
                          />
                        );
                      })}
                    </div>
                    <div className="text-[9px] text-muted-foreground font-mono h-3">
                      {showLabel ? d.slice(5) : ""}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
          {hasAnyLimit && showThresholds && (
            <div className="flex items-center gap-3 text-[10px] text-muted-foreground flex-wrap">
              {globalLimits.day != null && (
                <span className="flex items-center gap-1"><span className="inline-block w-3 border-t border-dashed border-destructive/70" /> daily limit {fmtUsd6(globalLimits.day)}</span>
              )}
              {hasAnyJobLimit && groupBy === "job" && <span>⚠ = job-day breach</span>}
              {hasAnyJobLimit && groupBy === "model" && (
                <span>Switch to "by job" to see per-job threshold breaches.</span>
              )}
              {(globalLimits.run != null || Object.values(jobLimits).some(l => l.run != null)) && (
                <span>per-run breaches shown in drill-down</span>
              )}
            </div>
          )}
          {hasAnyLimit && !showThresholds && (
            <div className="text-[10px] text-muted-foreground">
              Cost thresholds hidden while viewing {metricLabel}.
            </div>
          )}

          {/* Legend / breakdown table */}
          <div className="space-y-1">
            <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
              Breakdown by {groupBy} · {metricLabel}
            </div>
            <table className="w-full text-xs">
              <tbody>
                {breakdown.map(({ key, cost }) => (
                  <tr key={key} className="border-t border-border/50">
                    <td className="py-1 pr-2 w-3">
                      <span className="inline-block w-2 h-2 rounded-sm" style={{ background: colorFor(key) }} />
                    </td>
                    <td className="py-1 pr-2 font-mono truncate max-w-[280px]">{key}</td>
                    <td className="py-1 pr-2 font-mono text-right">{fmtMetric(cost)}</td>
                    <td className="py-1 pr-2 text-right text-muted-foreground">
                      {total > 0 ? `${((cost / total) * 100).toFixed(1)}%` : "–"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
      <SpendDrillDialog
        rows={rows}
        groupBy={groupBy}
        metric={metric}
        drill={drill}
        onClose={() => setDrill(null)}
        globalLimits={globalLimits}
        jobLimits={jobLimits}
      />
    </section>
  );
};

// ─────────────────────── Spend drill-down dialog ───────────────────────
const groupKeyForRow = (r: SpendRow, groupBy: "job" | "model") =>
  (groupBy === "job" ? r.job : r.model) || "unknown";

const formulaFor = (r: SpendRow): string => {
  const p = Number(r.prompt_tokens || 0);
  const c = Number(r.completion_tokens || 0);
  const pi = r.price_in_per_mtok == null ? null : Number(r.price_in_per_mtok);
  const po = r.price_out_per_mtok == null ? null : Number(r.price_out_per_mtok);
  const cost = Number(r.cost_usd || 0);
  if (pi == null || po == null) return "—";
  return `(${p.toLocaleString()}/1M × $${pi.toFixed(2)}) + (${c.toLocaleString()}/1M × $${po.toFixed(2)}) = $${cost.toFixed(6)}`;
};

const SpendDrillDialog = ({
  rows, groupBy, metric, drill, onClose, globalLimits, jobLimits,
}: {
  rows: SpendRow[];
  groupBy: "job" | "model";
  metric: "spend" | "prompt" | "completion";
  drill: { day: string; groupKey: string | null; breachOnly?: boolean } | null;
  onClose: () => void;
  globalLimits: { day: number | null; run: number | null };
  jobLimits: Record<string, { day: number | null; run: number | null }>;
}) => {
  const open = !!drill;
  const effectiveRunLimit = (job: string | null | undefined) =>
    (job && jobLimits[job]?.run != null) ? jobLimits[job]!.run! : globalLimits.run;
  const isRunBreach = (r: SpendRow) => {
    const lim = effectiveRunLimit(r.job);
    return lim != null && Number(r.cost_usd || 0) > lim;
  };
  const filtered = drill
    ? rows
        .filter(r => (drill.day === "*" || (r.created_at || "").slice(0, 10) === drill.day) &&
          (drill.groupKey === null || groupKeyForRow(r, groupBy) === drill.groupKey) &&
          (!drill.breachOnly || isRunBreach(r)))
        .sort((a, b) => (b.created_at || "").localeCompare(a.created_at || ""))
    : [];
  const cap = 200;
  const shown = filtered.slice(0, cap);
  const totalCost = filtered.reduce((s, r) => s + Number(r.cost_usd || 0), 0);
  const totalTok = filtered.reduce((s, r) => s + Number(r.prompt_tokens || 0) + Number(r.completion_tokens || 0), 0);
  const nightCount = filtered.filter(r => r?.request_ref?.night_mode === true).length;

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="max-w-5xl">
        <DialogHeader>
          <DialogTitle className="text-sm font-mono">
            {drill?.day === "*" ? "All days" : drill?.day} · by {groupBy} · {drill?.groupKey ?? "All groups"}
            {drill?.breachOnly && <span className="ml-2 text-destructive">· breaches only</span>}
          </DialogTitle>
          <DialogDescription className="text-xs">
            Individual ai_usage_log runs in this slice.
          </DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
          <div className="rounded border border-border p-2">
            <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Cost</div>
            <div className="font-mono">{fmtUsdFull(totalCost)}</div>
          </div>
          <div className="rounded border border-border p-2">
            <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Calls</div>
            <div className="font-mono">{filtered.length}</div>
          </div>
          <div className="rounded border border-border p-2">
            <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Tokens</div>
            <div className="font-mono">{totalTok.toLocaleString()}</div>
          </div>
          <div className="rounded border border-border p-2">
            <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Night-mode</div>
            <div className="font-mono">{nightCount}</div>
          </div>
        </div>
        <div className="max-h-[60vh] overflow-auto rounded border border-border">
          {shown.length === 0 ? (
            <div className="p-4 text-xs text-muted-foreground">No runs in this slice.</div>
          ) : (
            <table className="w-full text-[11px]">
              <thead className="bg-muted/50 sticky top-0">
                <tr className="text-left">
                  <th className="px-2 py-1 font-medium">Time UTC</th>
                  <th className="px-2 py-1 font-medium">Job</th>
                  <th className="px-2 py-1 font-medium">Model</th>
                  <th className="px-2 py-1 font-medium">Status</th>
                  <th className="px-2 py-1 font-medium text-right">Prompt</th>
                  <th className="px-2 py-1 font-medium text-right">Compl.</th>
                  <th className="px-2 py-1 font-medium text-right">Latency</th>
                  <th className="px-2 py-1 font-medium text-right">Cost</th>
                  <th className="px-2 py-1 font-medium">Formula</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((r, i) => {
                  const isNight = r?.request_ref?.night_mode === true;
                  const isErr = (r.status || "ok") !== "ok";
                  const runLim = effectiveRunLimit(r.job);
                  const runBreach = runLim != null && Number(r.cost_usd || 0) > runLim;
                  return (
                    <tr key={r.id ?? i} className={`border-t border-border/50 align-top ${runBreach ? "bg-destructive/5" : ""}`}>
                      <td className="px-2 py-1 font-mono text-muted-foreground whitespace-nowrap">
                        {(r.created_at || "").slice(11, 19)}
                      </td>
                      <td className="px-2 py-1 font-mono">{r.job ?? "—"}</td>
                      <td className="px-2 py-1 font-mono">
                        {(r.model ?? "—").replace("google/", "")}
                        {isNight && <Badge variant="outline" className="ml-1 text-[9px]">night</Badge>}
                      </td>
                      <td className="px-2 py-1">
                        <span
                          className={`inline-block rounded px-1.5 py-0.5 text-[10px] border ${isErr ? "bg-destructive/10 text-destructive border-destructive/30" : "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-500/30"}`}
                          title={r.error ?? undefined}
                        >{r.status ?? "ok"}</span>
                      </td>
                      <td className="px-2 py-1 font-mono text-right">{(r.prompt_tokens ?? 0).toLocaleString()}</td>
                      <td className="px-2 py-1 font-mono text-right">{(r.completion_tokens ?? 0).toLocaleString()}</td>
                      <td className="px-2 py-1 font-mono text-right text-muted-foreground">{r.latency_ms != null ? `${r.latency_ms}ms` : "—"}</td>
                      <td className="px-2 py-1 font-mono text-right">
                        {fmtUsdFull(Number(r.cost_usd || 0))}
                        {runBreach && (
                          <span className="ml-1 inline-block rounded px-1 text-[9px] bg-destructive/10 text-destructive border border-destructive/30" title={`Over per-run limit (${fmtUsd6(runLim!)})`}>⚠</span>
                        )}
                      </td>
                      <td className="px-2 py-1 font-mono text-muted-foreground">{formulaFor(r)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
        {filtered.length > cap && (
          <div className="text-[10px] text-muted-foreground">
            Showing first {cap} of {filtered.length} rows.
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
};

// ─────────────────────────── Overnight Queue ───────────────────────────
interface OvernightRunRow {
  id: string;
  phase_id: string;
  phase_key: string;
  status: string;
  requested_at: string;
  started_at: string | null;
  finished_at: string | null;
  scheduled_for: string;
  model: string | null;
  result: any;
  error: string | null;
}

const OvernightQueueCard = () => {
  const [rows, setRows] = useState<OvernightRunRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    const load = async () => {
      const { data } = await supabase
        .from("roadmap_phase_overnight_runs")
        .select("id, phase_id, phase_key, status, requested_at, started_at, finished_at, scheduled_for, model, result, error")
        .order("requested_at", { ascending: false })
        .limit(20);
      if (!active) return;
      setRows((data ?? []) as OvernightRunRow[]);
      setLoading(false);
    };
    load();
    const ch = supabase
      .channel("overnight_queue_panel")
      .on("postgres_changes", { event: "*", schema: "public", table: "roadmap_phase_overnight_runs" }, load)
      .subscribe();
    return () => { active = false; supabase.removeChannel(ch); };
  }, []);

  const queued = rows.filter(r => r.status === "queued" || r.status === "running");
  const recent = rows.filter(r => r.status !== "queued" && r.status !== "running").slice(0, 5);

  return (
    <section className="rounded-md border border-border bg-card p-3 space-y-3">
      <header className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-sm font-medium">
          <Moon className="h-4 w-4" /> Overnight phase queue
        </div>
        <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
          22:00–06:00 UTC · gemini-2.5-flash-lite
        </span>
      </header>

      <div>
        <p className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1">Queued / running ({queued.length})</p>
        {loading ? (
          <p className="text-xs text-muted-foreground">Loading…</p>
        ) : queued.length === 0 ? (
          <p className="text-xs text-muted-foreground">Nothing scheduled. Use “Run overnight” on an approved phase.</p>
        ) : (
          <ul className="space-y-1">
            {queued.map(r => (
              <li key={r.id} className="flex items-center gap-2 text-xs">
                <Badge variant={r.status === "running" ? "secondary" : "outline"} className="text-[10px]">{r.status}</Badge>
                <span className="font-mono">{r.phase_key}</span>
                <span className="ml-auto text-muted-foreground">scheduled {r.scheduled_for}</span>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div>
        <p className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1">Recent ({recent.length})</p>
        {recent.length === 0 ? (
          <p className="text-xs text-muted-foreground">No runs yet.</p>
        ) : (
          <ul className="space-y-1">
            {recent.map(r => (
              <li key={r.id} className="flex items-center gap-2 text-xs">
                <Badge
                  variant={r.status === "done" ? "default" : r.status === "failed" ? "destructive" : "outline"}
                  className="text-[10px]"
                >{r.status}</Badge>
                <span className="font-mono">{r.phase_key}</span>
                {r.model && <span className="font-mono text-[10px] text-muted-foreground">{r.model.replace("google/", "")}</span>}
                {typeof r.result?.cost_usd === "number" && (
                  <span className="font-mono text-[10px] text-muted-foreground">${r.result.cost_usd.toFixed(4)}</span>
                )}
                <span className="ml-auto text-muted-foreground">
                  {r.finished_at ? new Date(r.finished_at).toLocaleString() : "—"}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
};
