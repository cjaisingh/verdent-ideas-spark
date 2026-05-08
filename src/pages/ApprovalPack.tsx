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
type Checklist = { id: string; task_id: string; category: string; label: string; checked: boolean; note: string | null; checked_by: string | null; checked_at: string | null; order: number };
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

  useEffect(() => {
    supabase.from("roadmap_phases").select("*").order("order").then(({ data }) => {
      setPhases((data ?? []) as Phase[]);
      if (data?.length && !phaseId) setPhaseId(data[0].id);
    });
  }, []);

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

  const summary = useMemo(() => {
    const byStatus = tasks.reduce<Record<string, number>>((acc, t) => {
      acc[t.review_status] = (acc[t.review_status] ?? 0) + 1; return acc;
    }, {});
    const checked = checklist.filter((c) => c.checked).length;
    return { tasks: tasks.length, checked, totalChecks: checklist.length, evidence: evidence.length, byStatus };
  }, [tasks, checklist, evidence]);

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

  const printPdf = () => window.print();

  return (
    <div className="container py-6 space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-3 print:hidden">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Approval pack</h1>
          <p className="text-sm text-muted-foreground">Per-phase export of tasks, checklist status, and evidence links.</p>
        </div>
        <div className="flex items-center gap-2">
          <select
            className="h-9 rounded-md border bg-background px-2 text-sm"
            value={phaseId} onChange={(e) => setPhaseId(e.target.value)}
          >
            {phases.map((p) => (
              <option key={p.id} value={p.id}>{p.key} · {p.title}</option>
            ))}
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
        <article id="approval-pack-print" className="space-y-6 print:space-y-4">
          <Card>
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
                <Stat label="Generated" value={new Date().toLocaleString()} />
              </div>
            </CardContent>
          </Card>

          {sprints.map((sp) => {
            const sprintTasks = tasks.filter((t) => t.sprint_id === sp.id);
            return (
              <Card key={sp.id} className="break-inside-avoid">
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
                      <div key={t.id} className="rounded-md border p-3 space-y-2 break-inside-avoid">
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

                        {cls.length > 0 && (
                          <div className="space-y-1">
                            <div className="text-xs font-semibold">Checklist</div>
                            {cls.map((c) => {
                              const itemEv = evidence.filter((e) => e.task_id === t.id && e.checklist_item === (c as any).item_key);
                              return (
                                <div key={c.id} className="text-xs pl-1">
                                  <div className="flex items-start gap-2">
                                    <span className="font-mono">{c.checked ? "[x]" : "[ ]"}</span>
                                    <span className="text-muted-foreground">[{c.category}]</span>
                                    <span>{c.label}</span>
                                    {c.checked_by && <span className="text-muted-foreground">— {c.checked_by}</span>}
                                  </div>
                                  {c.note && <div className="pl-6 text-muted-foreground italic">{c.note}</div>}
                                  {itemEv.map((e) => (
                                    <div key={e.id} className="pl-6 text-muted-foreground">
                                      ↳ {e.url ? <a href={e.url} target="_blank" rel="noreferrer" className="underline">{e.title}</a> : e.title}
                                      {e.storage_path && <span className="ml-1">(file: {e.storage_path})</span>}
                                      {e.source && <span className="ml-1">— {e.source}</span>}
                                    </div>
                                  ))}
                                </div>
                              );
                            })}
                          </div>
                        )}

                        {taskEv.length > 0 && (
                          <div className="space-y-1">
                            <div className="text-xs font-semibold flex items-center gap-1"><FileText className="h-3 w-3" /> Task evidence</div>
                            {taskEv.map((e) => (
                              <div key={e.id} className="text-xs pl-1 text-muted-foreground">
                                • {e.url ? <a href={e.url} target="_blank" rel="noreferrer" className="underline">{e.title}</a> : e.title}
                                {e.storage_path && <span className="ml-1">(file: {e.storage_path})</span>}
                                {e.source && <span className="ml-1">— {e.source}</span>}
                                {e.note && <span className="ml-1">— {e.note}</span>}
                              </div>
                            ))}
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
          @page { margin: 1.5cm; }
          body { background: white !important; }
          aside, nav, header.print\\:hidden { display: none !important; }
          .container { max-width: 100% !important; padding: 0 !important; }
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
