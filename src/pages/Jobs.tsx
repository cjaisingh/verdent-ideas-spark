import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { ListChecks, RefreshCw, ExternalLink, ArrowUpRightFromSquare, Trash2, X, Moon } from "lucide-react";
import { toast } from "@/hooks/use-toast";
import { jobHandle, subjectHandle, discussionHandle } from "@/lib/discussionHandles";
import { Link } from "react-router-dom";
import { JobDetailsDrawer, type JobDetailsRecord } from "@/components/discussions/JobDetailsDrawer";

type Job = JobDetailsRecord;

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
  const [nightOnly, setNightOnly] = useState(false);
  const [activeJobId, setActiveJobId] = useState<string | null>(null);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dragOverCol, setDragOverCol] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkOwner, setBulkOwner] = useState("");

  const toggleNightEligible = async (j: Job, on: boolean) => {
    setJobs((prev) => prev.map((x) => (x.id === j.id ? { ...x, night_eligible: on } as any : x)));
    const { error } = await supabase
      .from("discussion_actions")
      .update({ night_eligible: on } as never)
      .eq("id", j.id);
    if (error) {
      setJobs((prev) => prev.map((x) => (x.id === j.id ? { ...x, night_eligible: !on } as any : x)));
      toast({ title: "Update failed", description: error.message, variant: "destructive" });
    }
  };

  const toggleSelect = (id: string, on: boolean) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (on) next.add(id); else next.delete(id);
      return next;
    });
  };
  const clearSelection = () => setSelected(new Set());

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
    if (j.status === target) return;
    // Optimistic update
    setJobs((prev) => prev.map((x) => (x.id === j.id ? { ...x, status: target } : x)));
    const { error } = await supabase.from("discussion_actions").update({ status: target }).eq("id", j.id);
    if (error) {
      setJobs((prev) => prev.map((x) => (x.id === j.id ? { ...x, status: j.status } : x)));
      toast({ title: "Update failed", description: error.message, variant: "destructive" });
    }
  };

  const bulkUpdate = async (patch: Record<string, any>, label: string) => {
    const ids = Array.from(selected);
    if (!ids.length) return;
    const { error } = await supabase.from("discussion_actions").update(patch as never).in("id", ids);
    if (error) { toast({ title: `${label} failed`, description: error.message, variant: "destructive" }); return; }
    toast({ title: `${label}: ${ids.length} job${ids.length === 1 ? "" : "s"}` });
    clearSelection();
  };

  const bulkSetStatus = (status: string) => bulkUpdate({ status }, `Set ${status}`);

  const bulkAssignOwner = async () => {
    const owner = bulkOwner.trim() || null;
    await bulkUpdate({ owner }, owner ? `Assigned @${owner}` : "Cleared owner");
    setBulkOwner("");
  };

  const bulkDelete = async () => {
    const ids = Array.from(selected);
    if (!ids.length) return;
    if (!confirm(`Delete ${ids.length} job${ids.length === 1 ? "" : "s"}? This cannot be undone.`)) return;
    const { error } = await supabase.from("discussion_actions").delete().in("id", ids);
    if (error) { toast({ title: "Delete failed", description: error.message, variant: "destructive" }); return; }
    toast({ title: `Deleted ${ids.length} job${ids.length === 1 ? "" : "s"}` });
    clearSelection();
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
      if (nightOnly && !(j as any).night_eligible) return false;
      if (q && !`${j.title} ${jobHandle(j.short_num)} ${j.owner ?? ""}`.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [jobs, search, subjectFilter, showDone, nightOnly]);

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
      <Card
        key={j.id}
        draggable
        onDragStart={(e) => {
          setDraggingId(j.id);
          e.dataTransfer.effectAllowed = "move";
          e.dataTransfer.setData("text/plain", j.id);
        }}
        onDragEnd={() => { setDraggingId(null); setDragOverCol(null); }}
        className={`hover:shadow-sm transition cursor-pointer ${draggingId === j.id ? "opacity-50" : ""} ${selected.has(j.id) ? "ring-2 ring-primary" : ""}`}
        onClick={() => setActiveJobId(j.id)}
      >
        <CardContent className="pt-3 pb-3 space-y-1.5">
          <div className="flex items-center gap-1.5 flex-wrap">
            <span onClick={(e) => e.stopPropagation()} className="inline-flex items-center">
              <Checkbox
                checked={selected.has(j.id)}
                onCheckedChange={(v) => toggleSelect(j.id, !!v)}
                aria-label={`Select ${handle}`}
              />
            </span>
            <span className="font-mono text-[10px] text-muted-foreground">{handle}</span>
            <Badge variant="outline" className="text-[9px] uppercase">{j.priority}</Badge>
            <Badge variant="outline" className="text-[9px]">{j.source}</Badge>
            {j.promoted_task_id && <Badge variant="secondary" className="text-[9px]">promoted</Badge>}
            {j.owner && <Badge variant="outline" className="text-[9px]">@{j.owner}</Badge>}
            {j.due_at && (
              <Badge
                variant="outline"
                className={`text-[9px] ${new Date(j.due_at) < new Date() && j.status !== "done" ? "border-destructive text-destructive" : ""}`}
              >
                due {new Date(j.due_at).toLocaleDateString(undefined, { month: "short", day: "numeric" })}
              </Badge>
            )}
            {(j as any).night_eligible && (
              <Badge
                variant="outline"
                className={`text-[9px] gap-0.5 ${
                  j.status !== "open"
                    ? "opacity-50 line-through decoration-1"
                    : ""
                }`}
                title={
                  j.status !== "open"
                    ? "Audit complete · already promoted — night agent will not re-audit."
                    : "Will be picked up by the night agent (audit only) on the next shift."
                }
              >
                <Moon className="h-2.5 w-2.5" /> night
              </Badge>
            )}
          </div>
          <div className="text-sm font-medium leading-snug">{j.title}</div>
          {j.details && <div className="text-xs text-muted-foreground line-clamp-3">{j.details}</div>}
          <div className="flex items-center justify-between gap-2 pt-1 text-[10px] text-muted-foreground">
            <span>
              {dHandle ? <span className="font-mono">{dHandle}</span> : <span className="font-mono">{subj}</span>}
            </span>
            <div className="flex items-center gap-1">
              <button
                onClick={(e) => { e.stopPropagation(); toggleNightEligible(j, !(j as any).night_eligible); }}
                className={`inline-flex items-center gap-0.5 hover:underline ${(j as any).night_eligible ? "text-foreground" : ""}`}
                title={(j as any).night_eligible ? "Unmark night-eligible" : "Mark night-eligible"}
              >
                <Moon className="h-3 w-3" />
              </button>
              {j.subject_type === "roadmap_finding" && (
                <Link
                  to={`/roadmap/risks#finding-${j.subject_id}`}
                  onClick={(e) => e.stopPropagation()}
                  className="inline-flex items-center gap-0.5 hover:underline"
                  title="Open subject"
                >
                  <ExternalLink className="h-3 w-3" />
                </Link>
              )}
              {!j.promoted_task_id && (
                <button
                  onClick={(e) => { e.stopPropagation(); promote(j); }}
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
                onClick={(e) => { e.stopPropagation(); cycleStatus(j, c.key); }}
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
          <Button size="sm" variant={nightOnly ? "default" : "outline"} onClick={() => setNightOnly((v) => !v)}>
            <Moon className="h-3.5 w-3.5 mr-1" /> Night-eligible only
          </Button>
          <Button size="sm" variant="outline" onClick={() => setShowDone((v) => !v)}>
            {showDone ? "Hide done" : "Show done"}
          </Button>
          <Button size="sm" variant="ghost" onClick={load}><RefreshCw className="h-4 w-4" /></Button>
        </div>
      </header>

      {selected.size > 0 && (
        <div className="sticky top-2 z-10 flex flex-wrap items-center gap-2 rounded-md border bg-card/95 backdrop-blur px-3 py-2 shadow-sm">
          <span className="text-sm font-medium">
            {selected.size} selected
          </span>
          <Button
            size="sm"
            variant="outline"
            onClick={() => setSelected(new Set(filtered.map((j) => j.id)))}
          >
            Select all visible ({filtered.length})
          </Button>
          <span className="mx-1 h-5 w-px bg-border" />
          <span className="text-xs text-muted-foreground">Status:</span>
          {COLUMNS.map((c) => (
            <Button key={c.key} size="sm" variant="outline" onClick={() => bulkSetStatus(c.key)}>
              {c.label}
            </Button>
          ))}
          <span className="mx-1 h-5 w-px bg-border" />
          <Input
            value={bulkOwner}
            onChange={(e) => setBulkOwner(e.target.value)}
            placeholder="owner (blank = clear)"
            className="h-8 w-44"
            onKeyDown={(e) => { if (e.key === "Enter") bulkAssignOwner(); }}
          />
          <Button size="sm" variant="outline" onClick={bulkAssignOwner}>
            Assign owner
          </Button>
          <span className="mx-1 h-5 w-px bg-border" />
          <Button size="sm" variant="destructive" onClick={bulkDelete}>
            <Trash2 className="h-3.5 w-3.5 mr-1" /> Delete
          </Button>
          <Button size="sm" variant="ghost" onClick={clearSelection}>
            <X className="h-3.5 w-3.5 mr-1" /> Clear
          </Button>
        </div>
      )}

      {loading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : filtered.length === 0 ? (
        <Card><CardContent className="py-10 text-center text-sm text-muted-foreground">
          No jobs yet. Create one from a Copilot discussion.
        </CardContent></Card>
      ) : (
        <div className="grid gap-3 md:grid-cols-3">
          {COLUMNS.map((c) => (
            <div
              key={c.key}
              className={`space-y-2 rounded-md transition-colors ${
                dragOverCol === c.key ? "bg-primary/5 ring-2 ring-primary/40" : ""
              }`}
              onDragOver={(e) => {
                if (!draggingId) return;
                e.preventDefault();
                e.dataTransfer.dropEffect = "move";
                if (dragOverCol !== c.key) setDragOverCol(c.key);
              }}
              onDragLeave={(e) => {
                if (e.currentTarget.contains(e.relatedTarget as Node)) return;
                if (dragOverCol === c.key) setDragOverCol(null);
              }}
              onDrop={(e) => {
                e.preventDefault();
                const id = e.dataTransfer.getData("text/plain") || draggingId;
                setDragOverCol(null);
                setDraggingId(null);
                if (!id) return;
                const job = jobs.find((x) => x.id === id);
                if (job && job.status !== c.key) cycleStatus(job, c.key);
              }}
            >
              <div className="flex items-center justify-between text-xs font-medium text-muted-foreground px-1">
                <span>{c.label}</span>
                <Badge variant="outline" className="text-[10px]">{grouped[c.key]?.length ?? 0}</Badge>
              </div>
              <div className="space-y-2 min-h-[120px] p-1">
                {(grouped[c.key] ?? []).map(renderCard)}
              </div>
            </div>
          ))}
        </div>
      )}

      <JobDetailsDrawer
        job={jobs.find((j) => j.id === activeJobId) ?? null}
        subjectShortNum={
          activeJobId
            ? findings[jobs.find((j) => j.id === activeJobId)?.subject_id ?? ""]?.short_num ?? null
            : null
        }
        discussionOrdinal={
          activeJobId
            ? (() => {
                const j = jobs.find((x) => x.id === activeJobId);
                return j?.discussion_id ? discs[j.discussion_id]?.subject_ordinal ?? null : null;
              })()
            : null
        }
        open={!!activeJobId}
        onOpenChange={(o) => { if (!o) setActiveJobId(null); }}
        onPromote={(j) => promote(j as Job)}
      />
    </div>
  );
}
