import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Download, Printer, FileText } from "lucide-react";
import { toast } from "@/hooks/use-toast";

type Phase = { id: string; key: string; title: string; summary: string | null; order: number; status: string };
type Sprint = { id: string; phase_id: string; key: string; title: string; goal: string | null; order: number; status: string };
type Task = {
  id: string; sprint_id: string; key: string; title: string; description: string | null;
  acceptance: string | null; status: string; module: string | null; capability_id: string | null;
  review_status: string; reviewed_by: string | null; reviewed_at: string | null; review_notes: string | null;
};
type Checklist = { id: string; task_id: string; item_key: string; category: string; label: string; checked: boolean; note: string | null; checked_by: string | null; checked_at: string | null; order: number };
type Evidence = { id: string; task_id: string; checklist_item: string | null; kind: string; title: string; url: string | null; storage_path: string | null; note: string | null; source: string | null };

const reviewBadgeVariant = (s: string) =>
  s === "approved" ? "default" : s === "rejected" ? "destructive" : s === "changes_requested" ? "secondary" : "outline";

export default function ApprovalPack() {
  const [phases, setPhases] = useState<Phase[]>([]);
  const [phaseId, setPhaseId] = useState<string>("");
  const [sprints, setSprints] = useState<Sprint[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [checklist, setChecklist] = useState<Checklist[]>([]);
  const [evidence, setEvidence] = useState<Evidence[]>([]);
  const [loading, setLoading] = useState(false);
  const [orgName, setOrgName] = useState<string>(() => localStorage.getItem("awip.approvalPack.orgName") ?? "AWIP");
  const [density, setDensity] = useState<"compact" | "standard" | "relaxed">(
    () => (localStorage.getItem("awip.approvalPack.density") as any) ?? "standard",
  );
  const [paperSize, setPaperSize] = useState<"A4" | "Letter">(
    () => (localStorage.getItem("awip.approvalPack.paper") as any) ?? "A4",
  );
  const [rangeFromId, setRangeFromId] = useState<string>("");
  const [rangeToId, setRangeToId] = useState<string>("");

  useEffect(() => { localStorage.setItem("awip.approvalPack.orgName", orgName); }, [orgName]);
  useEffect(() => { localStorage.setItem("awip.approvalPack.density", density); }, [density]);
  useEffect(() => { localStorage.setItem("awip.approvalPack.paper", paperSize); }, [paperSize]);

  useEffect(() => {
    supabase.from("roadmap_phases").select("*").order("order").then(({ data }) => {
      const list = (data ?? []) as Phase[];
      setPhases(list);
      if (list.length && !phaseId) setPhaseId(list[0].id);
      if (list.length && !rangeFromId) setRangeFromId(list[0].id);
      if (list.length && !rangeToId) setRangeToId(list[list.length - 1].id);
    });
  }, []);

  const [allPhaseStats, setAllPhaseStats] = useState<
    Array<{ phase_id: string; phase_key: string; phase_title: string; phase_order: number; counts: Record<string, number>; total: number }>
  >([]);

  useEffect(() => {
    if (!phases.length) return;
    (async () => {
      const { data: allSprints } = await supabase.from("roadmap_sprints").select("id, phase_id");
      const sprintToPhase = new Map<string, string>((allSprints ?? []).map((s: any) => [s.id, s.phase_id]));
      const { data: allTasks } = await supabase.from("roadmap_tasks").select("sprint_id, review_status");
      const acc: Record<string, Record<string, number>> = {};
      for (const t of (allTasks ?? []) as Array<{ sprint_id: string; review_status: string }>) {
        const pid = sprintToPhase.get(t.sprint_id);
        if (!pid) continue;
        acc[pid] ??= {};
        acc[pid][t.review_status] = (acc[pid][t.review_status] ?? 0) + 1;
      }
      setAllPhaseStats(
        phases.map((p) => {
          const counts = acc[p.id] ?? {};
          const total = Object.values(counts).reduce((a, b) => a + b, 0);
          return { phase_id: p.id, phase_key: p.key, phase_title: p.title, phase_order: p.order, counts, total };
        }),
      );
    })();
  }, [phases]);

  useEffect(() => {
    if (!phaseId) return;
    setLoading(true);
    (async () => {
      const { data: sp } = await supabase.from("roadmap_sprints").select("*").eq("phase_id", phaseId).order("order");
      const sprintIds = (sp ?? []).map((s) => s.id);
      const { data: tk } = sprintIds.length
        ? await supabase.from("roadmap_tasks").select("*").in("sprint_id", sprintIds).order("order")
        : { data: [] as Task[] };
      const taskIds = (tk ?? []).map((t) => t.id);
      const [{ data: cl }, { data: ev }] = await Promise.all([
        taskIds.length ? supabase.from("roadmap_task_checklist").select("*").in("task_id", taskIds).order("order") : Promise.resolve({ data: [] as Checklist[] }),
        taskIds.length ? supabase.from("roadmap_task_evidence").select("*").in("task_id", taskIds).order("created_at") : Promise.resolve({ data: [] as Evidence[] }),
      ]);
      setSprints((sp ?? []) as Sprint[]);
      setTasks((tk ?? []) as Task[]);
      setChecklist((cl ?? []) as Checklist[]);
      setEvidence((ev ?? []) as Evidence[]);
      setLoading(false);
    })();
  }, [phaseId]);

  const phase = phases.find((p) => p.id === phaseId);

  const phaseRange = useMemo(() => {
    const from = phases.find((p) => p.id === rangeFromId);
    const to = phases.find((p) => p.id === rangeToId);
    if (!from || !to) return { lo: 0, hi: Number.MAX_SAFE_INTEGER, fromKey: "", toKey: "" };
    const lo = Math.min(from.order, to.order);
    const hi = Math.max(from.order, to.order);
    const fromKey = from.order <= to.order ? from.key : to.key;
    const toKey = from.order <= to.order ? to.key : from.key;
    return { lo, hi, fromKey, toKey };
  }, [phases, rangeFromId, rangeToId]);

  const phasesInRange = useMemo(
    () => phases.filter((p) => p.order >= phaseRange.lo && p.order <= phaseRange.hi),
    [phases, phaseRange],
  );

  const summary = useMemo(() => {
    const byStatus = tasks.reduce<Record<string, number>>((acc, t) => {
      acc[t.review_status] = (acc[t.review_status] ?? 0) + 1; return acc;
    }, {});
    const checked = checklist.filter((c) => c.checked).length;
    return { tasks: tasks.length, checked, totalChecks: checklist.length, evidence: evidence.length, byStatus };
  }, [tasks, checklist, evidence]);

  const generatedAt = useMemo(() => new Date().toLocaleString(), [phaseId, tasks.length]);

  const buildMarkdown = (): string => {
    if (!phase) return "";
    const lines: string[] = [];
    lines.push(`# Approval Pack — ${phase.key} · ${phase.title}`);
    lines.push("");
    lines.push(`_Generated ${new Date().toISOString()}_`);
    if (phase.summary) lines.push(`\n${phase.summary}`);
    lines.push("\n## Summary");
    lines.push(`- Tasks: **${summary.tasks}**`);
    lines.push(`- Checklist items: **${summary.checked} / ${summary.totalChecks}** complete`);
    lines.push(`- Evidence attachments: **${summary.evidence}**`);
    lines.push(`- Review status: ${Object.entries(summary.byStatus).map(([k, v]) => `${k}=${v}`).join(", ") || "—"}`);

    for (const sp of sprints) {
      const sprintTasks = tasks.filter((t) => t.sprint_id === sp.id);
      lines.push(`\n## Sprint ${sp.key} — ${sp.title}`);
      if (sp.goal) lines.push(`> ${sp.goal}`);
      if (!sprintTasks.length) { lines.push(`_No tasks._`); continue; }

      for (const t of sprintTasks) {
        lines.push(`\n### ${t.key} — ${t.title}`);
        const meta = [
          `status: \`${t.status}\``,
          `review: \`${t.review_status}\``,
          t.module ? `module: \`${t.module}\`` : null,
          t.capability_id ? `capability: \`${t.capability_id}\`` : null,
          t.reviewed_by ? `reviewed by: ${t.reviewed_by}` : null,
        ].filter(Boolean).join(" · ");
        lines.push(meta);
        if (t.acceptance) lines.push(`\n**Acceptance:** ${t.acceptance}`);
        if (t.review_notes) lines.push(`\n**Review notes:** ${t.review_notes}`);

        const cls = checklist.filter((c) => c.task_id === t.id);
        if (cls.length) {
          lines.push(`\n**Checklist**`);
          for (const c of cls) {
            const box = c.checked ? "[x]" : "[ ]";
            const who = c.checked && c.checked_by ? ` _(✓ ${c.checked_by})_` : "";
            lines.push(`- ${box} \`${c.category}\` ${c.label}${who}`);
            if (c.note) lines.push(`  - note: ${c.note}`);
            const itemEv = evidence.filter((e) => e.task_id === t.id && e.checklist_item === c.item_key);
            for (const e of itemEv) {
              const ref = e.url ? `[${e.title}](${e.url})` : e.storage_path ? `${e.title} (file: \`${e.storage_path}\`)` : e.title;
              lines.push(`  - evidence: ${ref}${e.source ? ` — ${e.source}` : ""}`);
            }
          }
        }

        const taskEv = evidence.filter((e) => e.task_id === t.id && !e.checklist_item);
        if (taskEv.length) {
          lines.push(`\n**Task evidence**`);
          for (const e of taskEv) {
            const ref = e.url ? `[${e.title}](${e.url})` : e.storage_path ? `${e.title} (file: \`${e.storage_path}\`)` : e.title;
            lines.push(`- ${ref}${e.source ? ` — ${e.source}` : ""}${e.note ? ` — ${e.note}` : ""}`);
          }
        }
      }
    }
    return lines.join("\n");
  };

  const downloadMarkdown = () => {
    if (!phase) return;
    const md = buildMarkdown();
    const blob = new Blob([md], { type: "text/markdown" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `approval-pack-${phase.key}.md`; a.click();
    URL.revokeObjectURL(url);
    toast({ title: "Markdown exported" });
  };

  const printPdf = () => {
    if (!phase) return;
    const root = document.documentElement;
    root.style.setProperty("--pp-phase", `"${phase.key} — ${phase.title.replace(/"/g, "'")}"`);
    root.style.setProperty("--pp-generated", `"Generated ${generatedAt.replace(/"/g, "'")}"`);
    const cleanup = () => {
      root.style.removeProperty("--pp-phase");
      root.style.removeProperty("--pp-generated");
      window.removeEventListener("afterprint", cleanup);
    };
    window.addEventListener("afterprint", cleanup);
    window.print();
  };

  const evByItem = (taskId: string, itemKey: string) =>
    evidence.filter((e) => e.task_id === taskId && e.checklist_item === itemKey);

  return (
    <div className="container py-6 space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-3 print:hidden">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Approval pack</h1>
          <p className="text-sm text-muted-foreground">Per-phase export of tasks, checklist status, and evidence links.</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <input
            className="h-9 rounded-md border bg-background px-2 text-sm w-44"
            value={orgName}
            onChange={(e) => setOrgName(e.target.value)}
            placeholder="Client / org name"
            aria-label="Client or org name"
          />
          <select
            className="h-9 rounded-md border bg-background px-2 text-sm"
            value={phaseId} onChange={(e) => setPhaseId(e.target.value)}
          >
            {phases.map((p) => (
              <option key={p.id} value={p.id}>{p.key} · {p.title}</option>
            ))}
          </select>
          <div className="flex items-center gap-1 text-sm" title="Phase range for the summary page">
            <span className="text-xs text-muted-foreground">Range</span>
            <select
              className="h-9 rounded-md border bg-background px-2 text-sm"
              value={rangeFromId} onChange={(e) => setRangeFromId(e.target.value)}
              aria-label="Phase range from"
            >
              {phases.map((p) => (<option key={p.id} value={p.id}>{p.key}</option>))}
            </select>
            <span className="text-muted-foreground">→</span>
            <select
              className="h-9 rounded-md border bg-background px-2 text-sm"
              value={rangeToId} onChange={(e) => setRangeToId(e.target.value)}
              aria-label="Phase range to"
            >
              {phases.map((p) => (<option key={p.id} value={p.id}>{p.key}</option>))}
            </select>
          </div>
          <select
            className="h-9 rounded-md border bg-background px-2 text-sm"
            value={density} onChange={(e) => setDensity(e.target.value as any)}
            title="Print density"
            aria-label="Print density"
          >
            <option value="compact">Compact</option>
            <option value="standard">Standard</option>
            <option value="relaxed">Relaxed</option>
          </select>
          <select
            className="h-9 rounded-md border bg-background px-2 text-sm"
            value={paperSize} onChange={(e) => setPaperSize(e.target.value as any)}
            title="Paper size"
            aria-label="Paper size"
          >
            <option value="A4">A4</option>
            <option value="Letter">Letter</option>
          </select>
          <Button size="sm" variant="outline" onClick={downloadMarkdown} disabled={!phase}>
            <Download className="h-4 w-4 mr-1" /> Markdown
          </Button>
          <Button size="sm" onClick={printPdf} disabled={!phase}>
            <Printer className="h-4 w-4 mr-1" /> PDF (print)
          </Button>
        </div>
      </header>

      {loading || !phase ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : (
        <article id="approval-pack-print" className={`space-y-6 print:space-y-4 pp-doc pp-density-${density} pp-paper-${paperSize.toLowerCase()}`}>
          {(() => {
            const idx = phases.findIndex((p) => p.id === phase.id);
            const position = idx >= 0 ? `${idx + 1} of ${phases.length}` : "—";
            const rangeLabel = phasesInRange.length > 1
              ? `${phaseRange.fromKey} → ${phaseRange.toKey} (${phasesInRange.length} phases)`
              : (phasesInRange[0]?.key ?? phase.key);
            return (
              <section className="pp-cover-page rounded-lg border p-10 print:border-0 print:p-0">
                <div className="flex flex-col items-start justify-between min-h-[60vh] print:min-h-[24cm] gap-10">
                  <div className="space-y-2">
                    <div className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Prepared for</div>
                    <div className="text-4xl font-bold tracking-tight">{orgName || "—"}</div>
                  </div>
                  <div className="space-y-3">
                    <div className="text-sm uppercase tracking-[0.2em] text-muted-foreground">Approval Pack</div>
                    <h2 className="text-3xl font-semibold leading-tight">{phase.key} — {phase.title}</h2>
                    {phase.summary && <p className="text-sm text-muted-foreground max-w-2xl">{phase.summary}</p>}
                  </div>
                  <dl className="grid grid-cols-2 sm:grid-cols-3 gap-x-10 gap-y-3 text-sm w-full max-w-2xl">
                    <div>
                      <dt className="text-[10px] uppercase tracking-wide text-muted-foreground">Generated</dt>
                      <dd className="font-medium">{generatedAt}</dd>
                    </div>
                    <div>
                      <dt className="text-[10px] uppercase tracking-wide text-muted-foreground">Selected phase</dt>
                      <dd className="font-medium">{phase.key} ({position})</dd>
                    </div>
                    <div>
                      <dt className="text-[10px] uppercase tracking-wide text-muted-foreground">Phase range</dt>
                      <dd className="font-medium">{rangeLabel}</dd>
                    </div>
                    <div>
                      <dt className="text-[10px] uppercase tracking-wide text-muted-foreground">Tasks</dt>
                      <dd className="font-medium">{summary.tasks}</dd>
                    </div>
                    <div>
                      <dt className="text-[10px] uppercase tracking-wide text-muted-foreground">Checks</dt>
                      <dd className="font-medium">{summary.checked}/{summary.totalChecks}</dd>
                    </div>
                    <div>
                      <dt className="text-[10px] uppercase tracking-wide text-muted-foreground">Evidence</dt>
                      <dd className="font-medium">{summary.evidence}</dd>
                    </div>
                  </dl>
                </div>
              </section>
            );
          })()}

          <section className="pp-legend rounded-lg border p-4 print:p-3 print:border print:border-border space-y-2 break-inside-avoid text-xs">
            <h3 className="text-sm font-semibold">Legend</h3>
            <ul className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-1 text-muted-foreground">
              <li><span className="font-mono text-foreground">[x]</span> — checklist item marked complete</li>
              <li><span className="font-mono text-foreground">[ ]</span> — checklist item not yet complete</li>
              <li><span className="font-mono text-foreground">✓</span> — row-level done indicator (per-row %)</li>
              <li><span className="text-foreground">Done %</span> — completed checklist items ÷ total checklist items, per category and overall</li>
            </ul>
            <p className="text-[11px] text-muted-foreground">
              Subtotal rows show <span className="font-mono">{`{done}/{total}`}</span> and the Done % for that category. The Task total row aggregates all categories within the phase.
            </p>
          </section>

          {(() => {
            const inRangeIds = new Set(phasesInRange.map((p) => p.id));
            const filteredStats = allPhaseStats.filter((r) => inRangeIds.has(r.phase_id));
            const statuses = ["approved", "changes_requested", "rejected", "pending"] as const;
            const totals = statuses.reduce<Record<string, number>>((a, s) => { a[s] = 0; return a; }, {});
            for (const r of filteredStats) for (const s of statuses) totals[s] += r.counts[s] ?? 0;
            const grandTotal = Object.values(totals).reduce((a, b) => a + b, 0);
            const pct = (n: number) => grandTotal ? Math.round((n / grandTotal) * 100) : 0;
            return (
              <section className="pp-rollup pp-page-break rounded-lg border p-6 print:p-0 print:border-0 space-y-4 break-inside-avoid">
                <header className="flex items-baseline justify-between gap-3 flex-wrap">
                  <h2 className="text-xl font-semibold">Approval status by phase</h2>
                  <div className="text-xs text-muted-foreground">
                    {grandTotal} task{grandTotal === 1 ? "" : "s"} across {filteredStats.length} phase{filteredStats.length === 1 ? "" : "s"}
                    {phasesInRange.length > 1 && ` · range ${phaseRange.fromKey} → ${phaseRange.toKey}`}
                  </div>
                </header>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                  <Stat label="Approved" value={`${totals.approved} · ${pct(totals.approved)}%`} />
                  <Stat label="Changes requested" value={`${totals.changes_requested} · ${pct(totals.changes_requested)}%`} />
                  <Stat label="Rejected" value={`${totals.rejected} · ${pct(totals.rejected)}%`} />
                  <Stat label="Pending" value={`${totals.pending} · ${pct(totals.pending)}%`} />
                </div>
                <table className="pp-checklist w-full text-xs border-collapse table-fixed">
                  <colgroup>
                    <col style={{ width: "72px" }} />
                    <col />
                    <col style={{ width: "64px" }} />
                    <col style={{ width: "84px" }} />
                    <col style={{ width: "120px" }} />
                    <col style={{ width: "84px" }} />
                    <col style={{ width: "72px" }} />
                  </colgroup>
                  <thead>
                    <tr className="text-left text-muted-foreground">
                      <th className="py-1 pr-2 font-medium">Phase</th>
                      <th className="py-1 pr-2 font-medium">Title</th>
                      <th className="py-1 pr-2 font-medium text-right">Tasks</th>
                      <th className="py-1 pr-2 font-medium text-right">Approved</th>
                      <th className="py-1 pr-2 font-medium text-right">Changes req.</th>
                      <th className="py-1 pr-2 font-medium text-right">Rejected</th>
                      <th className="py-1 font-medium text-right">Pending</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredStats
                      .slice()
                      .sort((a, b) => a.phase_order - b.phase_order)
                      .map((r) => {
                        const isCurrent = r.phase_id === phaseId;
                        const rowPct = (n: number) => r.total ? Math.round(((n ?? 0) / r.total) * 100) : 0;
                        const cell = (n: number) => (
                          <>
                            <span className="tabular-nums">{n ?? 0}</span>
                            <span className="ml-1 text-[10px] text-muted-foreground tabular-nums">{rowPct(n)}%</span>
                          </>
                        );
                        return (
                          <tr key={r.phase_id} className={`border-t align-top ${isCurrent ? "font-medium" : ""}`}>
                            <td className="py-1 pr-2 font-mono">{r.phase_key}{isCurrent ? " ←" : ""}</td>
                            <td className="py-1 pr-2 truncate">{r.phase_title}</td>
                            <td className="py-1 pr-2 text-right tabular-nums">{r.total}</td>
                            <td className="py-1 pr-2 text-right">{cell(r.counts.approved ?? 0)}</td>
                            <td className="py-1 pr-2 text-right">{cell(r.counts.changes_requested ?? 0)}</td>
                            <td className="py-1 pr-2 text-right">{cell(r.counts.rejected ?? 0)}</td>
                            <td className="py-1 text-right">{cell(r.counts.pending ?? 0)}</td>
                          </tr>
                        );
                      })}
                  </tbody>
                  <tfoot>
                    <tr className="border-t font-medium">
                      <td className="py-1 pr-2" colSpan={2}>Total</td>
                      <td className="py-1 pr-2 text-right tabular-nums">{grandTotal}</td>
                      <td className="py-1 pr-2 text-right tabular-nums">{totals.approved}</td>
                      <td className="py-1 pr-2 text-right tabular-nums">{totals.changes_requested}</td>
                      <td className="py-1 pr-2 text-right tabular-nums">{totals.rejected}</td>
                      <td className="py-1 text-right tabular-nums">{totals.pending}</td>
                    </tr>
                  </tfoot>
                </table>
              </section>
            );
          })()}

          <Card className="pp-summary pp-page-break">
            <CardHeader>
              <div className="flex items-center justify-between gap-3">
                <CardTitle className="text-xl">{phase.key} — {phase.title}</CardTitle>
                <Badge variant="outline">{phase.status}</Badge>
              </div>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              {phase.summary && <p className="text-muted-foreground">{phase.summary}</p>}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 pt-2">
                <Stat label="Tasks" value={summary.tasks} />
                <Stat label="Checks complete" value={`${summary.checked}/${summary.totalChecks}`} />
                <Stat label="Evidence" value={summary.evidence} />
                <Stat label="Generated" value={generatedAt} />
              </div>
              {Object.keys(summary.byStatus).length > 0 && (
                <div className="text-xs text-muted-foreground pt-1">
                  Review status: {Object.entries(summary.byStatus).map(([k, v]) => `${k}=${v}`).join(" · ")}
                </div>
              )}
            </CardContent>
          </Card>

          {sprints.map((sp, sprintIdx) => {
            const sprintTasks = tasks.filter((t) => t.sprint_id === sp.id);
            return (
              <Card key={sp.id} className={`pp-sprint break-inside-avoid ${sprintIdx > 0 ? "pp-page-break" : ""}`}>
                <CardHeader className="pb-2">
                  <CardTitle className="text-base">Sprint {sp.key} — {sp.title}</CardTitle>
                  {sp.goal && <p className="text-xs text-muted-foreground">{sp.goal}</p>}
                </CardHeader>
                <CardContent className="space-y-4">
                  {sprintTasks.length === 0 ? (
                    <p className="text-xs text-muted-foreground">No tasks.</p>
                  ) : sprintTasks.map((t) => {
                    const cls = checklist.filter((c) => c.task_id === t.id);
                    const taskEv = evidence.filter((e) => e.task_id === t.id && !e.checklist_item);
                    return (
                      <div key={t.id} className="pp-task rounded-md border p-3 space-y-2">
                        <div className="flex items-start justify-between gap-2 flex-wrap">
                          <div className="font-medium">
                            <span className="font-mono text-xs text-muted-foreground mr-2">{t.key}</span>
                            {t.title}
                          </div>
                          <div className="flex items-center gap-1 flex-wrap text-[10px]">
                            <Badge variant="outline">{t.status}</Badge>
                            <Badge variant={reviewBadgeVariant(t.review_status) as any}>review: {t.review_status}</Badge>
                            {t.module && <Badge variant="outline">{t.module}</Badge>}
                          </div>
                        </div>
                        {t.acceptance && <p className="text-xs"><span className="font-semibold">Acceptance:</span> {t.acceptance}</p>}
                        {t.review_notes && <p className="text-xs"><span className="font-semibold">Review notes:</span> {t.review_notes}</p>}

                        {cls.length > 0 && (() => {
                          const catTotals = cls.reduce<Record<string, { done: number; total: number }>>((acc, c) => {
                            const k = c.category || "—";
                            acc[k] ??= { done: 0, total: 0 };
                            acc[k].total += 1;
                            if (c.checked) acc[k].done += 1;
                            return acc;
                          }, {});
                          const taskDone = cls.filter((c) => c.checked).length;
                          const taskPct = Math.round((taskDone / cls.length) * 100);
                          return (
                            <table className="pp-checklist w-full text-xs border-collapse table-fixed">
                              <colgroup>
                                <col style={{ width: "32px" }} />
                                <col style={{ width: "96px" }} />
                                <col />
                                <col style={{ width: "64px" }} />
                                <col style={{ width: "38%" }} />
                                <col style={{ width: "112px" }} />
                              </colgroup>
                              <thead>
                                <tr className="text-left text-muted-foreground">
                                  <th className="py-1 pr-2 font-medium text-center">✓</th>
                                  <th className="py-1 pr-2 font-medium">Category</th>
                                  <th className="py-1 pr-2 font-medium">Item</th>
                                  <th className="py-1 pr-2 font-medium text-right">Done %</th>
                                  <th className="py-1 pr-2 font-medium">Evidence</th>
                                  <th className="py-1 font-medium">Reviewer</th>
                                </tr>
                              </thead>
                              <tbody>
                                {(() => {
                                  const seenOrder: string[] = [];
                                  const grouped = new Map<string, typeof cls>();
                                  for (const c of cls) {
                                    const k = c.category || "—";
                                    if (!grouped.has(k)) { grouped.set(k, []); seenOrder.push(k); }
                                    grouped.get(k)!.push(c);
                                  }
                                  const nodes: React.ReactNode[] = [];
                                  for (const k of seenOrder) {
                                    const items = grouped.get(k)!;
                                    const cat = catTotals[k];
                                    const catPct = cat.total ? Math.round((cat.done / cat.total) * 100) : 0;
                                    for (const c of items) {
                                      const itemEv = evByItem(t.id, c.item_key);
                                      nodes.push(
                                        <tr key={c.id} className="align-top border-t">
                                          <td className="py-1 pr-2 font-mono text-center">{c.checked ? "[x]" : "[ ]"}</td>
                                          <td className="py-1 pr-2 uppercase tracking-wide text-[10px] text-muted-foreground truncate">{c.category}</td>
                                          <td className="py-1 pr-2">
                                            <div className="break-words">{c.label}</div>
                                            {c.note && <div className="text-muted-foreground italic break-words">{c.note}</div>}
                                          </td>
                                          <td className="py-1 pr-2 text-right tabular-nums text-muted-foreground">
                                            {c.checked ? "✓" : ""}
                                          </td>
                                          <td className="py-1 pr-2 align-top">
                                            {itemEv.length === 0 ? (
                                              <span className="text-muted-foreground">—</span>
                                            ) : (
                                              <ul className="pp-evidence-list space-y-1">
                                                {itemEv.map((e) => (
                                                  <li key={e.id} className="pp-evidence-item">
                                                    <div className="pp-evidence-title">
                                                      {e.url ? (
                                                        <a href={e.url} target="_blank" rel="noreferrer" className="pp-link underline" title={e.title}>{e.title}</a>
                                                      ) : <span title={e.title}>{e.title}</span>}
                                                    </div>
                                                    {(e.storage_path || e.source) && (
                                                      <div className="pp-evidence-meta text-[10px] text-muted-foreground">
                                                        {e.storage_path && <span className="pp-evidence-path">file: {e.storage_path}</span>}
                                                        {e.storage_path && e.source && <span> · </span>}
                                                        {e.source && <span>{e.source}</span>}
                                                      </div>
                                                    )}
                                                  </li>
                                                ))}
                                              </ul>
                                            )}
                                          </td>
                                          <td className="py-1 text-muted-foreground truncate">{c.checked_by ?? "—"}</td>
                                        </tr>,
                                      );
                                    }
                                    nodes.push(
                                      <tr key={`sub-${k}`} className="pp-subtotal border-t bg-muted/40 text-[11px]">
                                        <td className="py-1 pr-2" />
                                        <td className="py-1 pr-2 uppercase tracking-wide text-[10px] font-semibold">{k} subtotal</td>
                                        <td className="py-1 pr-2 text-muted-foreground">{cat.done} of {cat.total} complete</td>
                                        <td className="py-1 pr-2 text-right tabular-nums font-semibold">
                                          <span className="text-muted-foreground">{cat.done}/{cat.total}</span>
                                          <span className="ml-1">{catPct}%</span>
                                        </td>
                                        <td className="py-1 pr-2" colSpan={2} />
                                      </tr>,
                                    );
                                  }
                                  return nodes;
                                })()}
                              </tbody>
                              <tfoot>
                                <tr className="border-t font-medium">
                                  <td className="py-1 pr-2" colSpan={3}>Task total</td>
                                  <td className="py-1 pr-2 text-right tabular-nums">
                                    <span className="text-muted-foreground">{taskDone}/{cls.length}</span>
                                    <span className="ml-1">{taskPct}%</span>
                                  </td>
                                  <td colSpan={2} />
                                </tr>
                              </tfoot>
                            </table>
                          );
                        })()}

                        {taskEv.length > 0 && (
                          <div className="space-y-1">
                            <div className="text-xs font-semibold flex items-center gap-1"><FileText className="h-3 w-3" /> Task evidence</div>
                            <table className="pp-checklist w-full text-xs border-collapse">
                              <thead>
                                <tr className="text-left text-muted-foreground">
                                  <th className="py-1 pr-2 font-medium">Title</th>
                                  <th className="w-32 py-1 pr-2 font-medium">Source</th>
                                  <th className="py-1 font-medium">Note</th>
                                </tr>
                              </thead>
                              <tbody>
                                {taskEv.map((e) => (
                                  <tr key={e.id} className="align-top border-t">
                                    <td className="py-1 pr-2">
                                      {e.url ? <a href={e.url} target="_blank" rel="noreferrer" className="pp-link underline">{e.title}</a> : e.title}
                                      {e.storage_path && <span className="ml-1 text-muted-foreground">(file: {e.storage_path})</span>}
                                    </td>
                                    <td className="py-1 pr-2 text-muted-foreground">{e.source ?? "—"}</td>
                                    <td className="py-1 text-muted-foreground">{e.note ?? "—"}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </CardContent>
              </Card>
            );
          })}
        </article>
      )}

      <style>{`
        @media print {
          @page {
            size: ${paperSize};
            margin: ${density === "compact" ? "1.2cm 1cm" : density === "relaxed" ? "2.4cm 2cm" : "2cm 1.5cm"};
            @top-left { content: "AWIP — Approval Pack"; font: 9pt -apple-system, system-ui, sans-serif; color: #555; }
            @top-right { content: var(--pp-phase, ""); font: 9pt -apple-system, system-ui, sans-serif; color: #555; }
            @bottom-left { content: var(--pp-generated, ""); font: 8.5pt -apple-system, system-ui, sans-serif; color: #777; }
            @bottom-right { content: "Page " counter(page) " / " counter(pages); font: 8.5pt -apple-system, system-ui, sans-serif; color: #777; }
          }
          @page :first {
            @top-left { content: ""; }
            @top-right { content: ""; }
            @bottom-left { content: ""; }
            @bottom-right { content: ""; }
          }
          .pp-cover-page { break-after: page; page-break-after: always; min-height: ${paperSize === "Letter" ? "22cm" : "24cm"}; padding: 0 !important; border: 0 !important; }
          html, body { background: white !important; color: #111 !important; }
          body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
          .pp-density-compact  { font-size: 8.5pt; }
          .pp-density-standard { font-size: 10pt; }
          .pp-density-relaxed  { font-size: 11pt; }
          .pp-density-compact  .pp-checklist { font-size: 7.5pt; }
          .pp-density-standard .pp-checklist { font-size: 9pt; }
          .pp-density-relaxed  .pp-checklist { font-size: 10pt; }
          .pp-density-compact  .pp-checklist th, .pp-density-compact  .pp-checklist td { padding: 2px 4px; }
          .pp-density-standard .pp-checklist th, .pp-density-standard .pp-checklist td { padding: 4px 6px; }
          .pp-density-relaxed  .pp-checklist th, .pp-density-relaxed  .pp-checklist td { padding: 6px 8px; }
          .pp-density-compact  .pp-task { padding: 6px 8px; }
          .pp-density-relaxed  .pp-task { padding: 14px 16px; }
          aside, nav, [data-sidebar], .print\\:hidden, [data-sonner-toaster] { display: none !important; }
          .container { max-width: 100% !important; padding: 0 !important; }
          .pp-doc { display: block; }
          .pp-page-break { break-before: page; page-break-before: always; }
          .pp-sprint { break-inside: avoid; page-break-inside: avoid; }
          .pp-task { break-inside: auto; page-break-inside: auto; orphans: 4; widows: 4; }
          .pp-task > .flex:first-child { break-after: avoid; page-break-after: avoid; }
          .pp-checklist { break-inside: auto; page-break-inside: auto; }
          .pp-checklist thead { display: table-header-group; }
          .pp-checklist tfoot { display: table-row-group; }
          .pp-checklist tr { page-break-inside: avoid; break-inside: avoid; }
          .pp-checklist tbody tr.pp-subtotal { break-before: avoid; page-break-before: avoid; }
          .pp-checklist tbody tr:nth-child(even):not(.pp-subtotal) td { background: #f5f5f7; }
          .pp-checklist tr.pp-subtotal td { background: #e4e4e7 !important; border-top: 1px solid #a1a1aa; border-bottom: 1px solid #a1a1aa; font-weight: 600; }
          .pp-checklist th, .pp-checklist td { border-color: #d4d4d8 !important; }
          .pp-checklist thead th { border-bottom: 1px solid #a1a1aa; }
          .pp-checklist td { vertical-align: top; }
          .pp-evidence-list { margin: 0; padding: 0; list-style: none; }
          .pp-evidence-item { break-inside: avoid; page-break-inside: avoid; padding-bottom: 2px; }
          .pp-evidence-item + .pp-evidence-item { border-top: 1px dotted #d4d4d8; padding-top: 2px; }
          .pp-evidence-title {
            overflow-wrap: anywhere;
            word-break: break-word;
            hyphens: auto;
            display: -webkit-box;
            -webkit-line-clamp: 3;
            -webkit-box-orient: vertical;
            overflow: hidden;
            line-height: 1.25;
          }
          .pp-evidence-meta, .pp-evidence-path { overflow-wrap: anywhere; word-break: break-all; }
          a.pp-link[href]::after {
            content: " " attr(href);
            display: block;
            font-size: 7.5pt;
            color: #555;
            font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
            overflow-wrap: anywhere;
            word-break: break-all;
            margin-top: 1px;
          }
        }
      `}</style>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="rounded-md border p-2">
      <div className="text-[10px] uppercase text-muted-foreground">{label}</div>
      <div className="text-sm font-semibold">{value}</div>
    </div>
  );
}
