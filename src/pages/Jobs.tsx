import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ListChecks, RefreshCw, ExternalLink, ArrowUpRightFromSquare } from "lucide-react";
import { toast } from "@/hooks/use-toast";
import { jobHandle, subjectHandle, discussionHandle } from "@/lib/discussionHandles";
import { Link } from "react-router-dom";

type Job = {
  id: string;
  short_num: number;
  subject_type: string;
  subject_id: string;
  discussion_id: string | null;
  title: string;
  details: string | null;
  status: string;
  priority: string;
  owner: string | null;
  source: string;
  promoted_task_id: string | null;
  created_at: string;
};

type DiscMeta = { id: string; subject_ordinal: number | null };
type SubjMeta = { id: string; short_num: number | null };

const COLUMNS: { key: string; label: string }[] = [
  { key: "open", label: "Open" },
  { key: "in_progress", label: "In progress" },
  { key: "done", label: "Done" },
];

const PRIORITY_RANK: Record<string, number> = { high: 3, med: 2, low: 1 };

export default function Jobs() {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [discs, setDiscs] = useState<Record<string, DiscMeta>>({});
  const [findings, setFindings] = useState<Record<string, SubjMeta>>({});
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [subjectFilter, setSubjectFilter] = useState<string>("all");
  const [showDone, setShowDone] = useState(false);

  const load = async () => {
    setLoading(true);
    const { data } = await supabase
      .from("discussion_actions")
      .select("*")
      .order("created_at", { ascending: false });
    const list = (data ?? []) as Job[];
    setJobs(list);

    const discIds = Array.from(new Set(list.map((j) => j.discussion_id).filter(Boolean))) as string[];
    const findingIds = Array.from(new Set(
      list.filter((j) => j.subject_type === "roadmap_finding").map((j) => j.subject_id),
    ));
    const [{ data: dd }, { data: ff }] = await Promise.all([
      discIds.length
        ? supabase.from("roadmap_finding_discussions").select("id,subject_ordinal").in("id", discIds)
        : Promise.resolve({ data: [] as any[] }),
      findingIds.length
        ? supabase.from("roadmap_review_findings").select("id,short_num").in("id", findingIds)
        : Promise.resolve({ data: [] as any[] }),
    ]);
    setDiscs(Object.fromEntries((dd ?? []).map((d: any) => [d.id, d])));
    setFindings(Object.fromEntries((ff ?? []).map((f: any) => [f.id, f])));
    setLoading(false);
  };

  useEffect(() => {
    load();
    const ch = supabase
      .channel("jobs-board")
      .on("postgres_changes", { event: "*", schema: "public", table: "discussion_actions" }, () => load())
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, []);

  const cycleStatus = async (j: Job, target: string) => {
    const { error } = await supabase.from("discussion_actions").update({ status: target }).eq("id", j.id);
    if (error) toast({ title: "Update failed", description: error.message, variant: "destructive" });
  };

  const promote = async (j: Job) => {
    if (j.promoted_task_id) return;
    if (!confirm(`Promote ${jobHandle(j.short_num)} to a roadmap task?`)) return;

    // Find or create a "Discussion follow-ups" sprint
    let { data: sprint } = await supabase
      .from("roadmap_sprints").select("id").eq("key", "discussion-followups").maybeSingle();
    if (!sprint) {
      const { data: anyPhase } = await supabase
        .from("roadmap_phases").select("id").order("order").limit(1).maybeSingle();
      if (!anyPhase) { toast({ title: "No phases exist", variant: "destructive" }); return; }
      const { data: created, error } = await supabase
        .from("roadmap_sprints")
        .insert({ key: "discussion-followups", title: "Discussion follow-ups", phase_id: anyPhase.id, order: 999 })
        .select("id").single();
      if (error || !created) { toast({ title: "Could not create sprint", description: error?.message, variant: "destructive" }); return; }
      sprint = created;
    }

    const { data: task, error: taskErr } = await supabase
      .from("roadmap_tasks")
      .insert({
        sprint_id: sprint.id,
        key: jobHandle(j.short_num).toLowerCase(),
        title: j.title,
        description: j.details ?? `Promoted from ${jobHandle(j.short_num)}.`,
        status: "todo",
      })
      .select("id").single();
    if (taskErr || !task) { toast({ title: "Could not create task", description: taskErr?.message, variant: "destructive" }); return; }

    await supabase.from("discussion_actions")
      .update({ promoted_task_id: task.id, status: "done" }).eq("id", j.id);
    toast({ title: "Promoted to roadmap task" });
  };

  const subjectTypes = useMemo(
    () => Array.from(new Set(jobs.map((j) => j.subject_type))).sort(),
    [jobs],
  );

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return jobs.filter((j) => {
      if (subjectFilter !== "all" && j.subject_type !== subjectFilter) return false;
      if (!showDone && (j.status === "done" || j.status === "cancelled")) return false;
      if (q && !`${j.title} ${jobHandle(j.short_num)} ${j.owner ?? ""}`.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [jobs, search, subjectFilter, showDone]);

  const grouped = useMemo(() => {
    const out: Record<string, Job[]> = { open: [], in_progress: [], done: [] };
    for (const j of filtered) {
      const k = out[j.status] ? j.status : "done";
      out[k].push(j);
    }
    for (const k of Object.keys(out)) {
      out[k].sort((a, b) => (PRIORITY_RANK[b.priority] ?? 0) - (PRIORITY_RANK[a.priority] ?? 0));
    }
    return out;
  }, [filtered]);

  const renderCard = (j: Job) => {
    const handle = jobHandle(j.short_num);
    const finding = findings[j.subject_id];
    const subj = subjectHandle(j.subject_type, finding?.short_num);
    const disc = j.discussion_id ? discs[j.discussion_id] : null;
    const dHandle = disc ? discussionHandle(j.subject_type, finding?.short_num, disc.subject_ordinal) : null;
    return (
      <Card key={j.id} className="hover:shadow-sm transition">
        <CardContent className="pt-3 pb-3 space-y-1.5">
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="font-mono text-[10px] text-muted-foreground">{handle}</span>
            <Badge variant="outline" className="text-[9px] uppercase">{j.priority}</Badge>
            <Badge variant="outline" className="text-[9px]">{j.source}</Badge>
            {j.promoted_task_id && <Badge variant="secondary" className="text-[9px]">promoted</Badge>}
            {j.owner && <Badge variant="outline" className="text-[9px]">@{j.owner}</Badge>}
          </div>
          <div className="text-sm font-medium leading-snug">{j.title}</div>
          {j.details && <div className="text-xs text-muted-foreground line-clamp-3">{j.details}</div>}
          <div className="flex items-center justify-between gap-2 pt-1 text-[10px] text-muted-foreground">
            <span>
              {dHandle ? <span className="font-mono">{dHandle}</span> : <span className="font-mono">{subj}</span>}
            </span>
            <div className="flex items-center gap-1">
              {j.subject_type === "roadmap_finding" && (
                <Link
                  to={`/roadmap/risks#finding-${j.subject_id}`}
                  className="inline-flex items-center gap-0.5 hover:underline"
                  title="Open subject"
                >
                  <ExternalLink className="h-3 w-3" />
                </Link>
              )}
              {!j.promoted_task_id && (
                <button
                  onClick={() => promote(j)}
                  className="inline-flex items-center gap-0.5 hover:underline"
                  title="Promote to roadmap task"
                >
                  <ArrowUpRightFromSquare className="h-3 w-3" />
                </button>
              )}
            </div>
          </div>
          <div className="flex gap-1 pt-1">
            {COLUMNS.map((c) => (
              <button
                key={c.key}
                onClick={() => cycleStatus(j, c.key)}
                disabled={j.status === c.key}
                className={`text-[10px] px-1.5 py-0.5 rounded border ${
                  j.status === c.key ? "bg-primary text-primary-foreground border-primary" : "hover:bg-muted"
                }`}
              >
                {c.label}
              </button>
            ))}
          </div>
        </CardContent>
      </Card>
    );
  };

  return (
    <div className="container py-6 space-y-4">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <ListChecks className="h-6 w-6" /> Jobs board
          </h1>
          <p className="text-sm text-muted-foreground">
            Action items captured from Copilot discussions. Promote a job to a roadmap task when it grows up.
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search jobs…"
            className="h-8 w-48"
          />
          <select
            value={subjectFilter}
            onChange={(e) => setSubjectFilter(e.target.value)}
            className="h-8 rounded-md border bg-background px-2 text-sm"
          >
            <option value="all">All subjects</option>
            {subjectTypes.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
          <Button size="sm" variant="outline" onClick={() => setShowDone((v) => !v)}>
            {showDone ? "Hide done" : "Show done"}
          </Button>
          <Button size="sm" variant="ghost" onClick={load}><RefreshCw className="h-4 w-4" /></Button>
        </div>
      </header>

      {loading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : filtered.length === 0 ? (
        <Card><CardContent className="py-10 text-center text-sm text-muted-foreground">
          No jobs yet. Create one from a Copilot discussion.
        </CardContent></Card>
      ) : (
        <div className="grid gap-3 md:grid-cols-3">
          {COLUMNS.map((c) => (
            <div key={c.key} className="space-y-2">
              <div className="flex items-center justify-between text-xs font-medium text-muted-foreground px-1">
                <span>{c.label}</span>
                <Badge variant="outline" className="text-[10px]">{grouped[c.key]?.length ?? 0}</Badge>
              </div>
              <div className="space-y-2 min-h-[60px]">
                {(grouped[c.key] ?? []).map(renderCard)}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
