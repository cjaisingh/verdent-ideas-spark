import { useEffect, useState } from "react";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { supabase } from "@/integrations/supabase/client";
import { discussionHandle, jobHandle, subjectHandle } from "@/lib/discussionHandles";
import { ArrowUpRightFromSquare, Copy, ExternalLink, MessagesSquare } from "lucide-react";
import { toast } from "@/hooks/use-toast";
import { Link } from "react-router-dom";
import { JobOwnerDueEditor } from "./JobOwnerDueEditor";

export type JobDetailsRecord = {
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
  extracted_confidence: number | null;
  due_at: string | null;
  created_at: string;
  updated_at: string;
};

type Props = {
  job: JobDetailsRecord | null;
  subjectShortNum?: number | null;
  discussionOrdinal?: number | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onPromote?: (job: JobDetailsRecord) => void;
};

type TimelineItem = {
  at: string;
  label: string;
  detail?: string;
};

type DiscussionMeta = {
  title: string | null;
  created_at: string;
  ended_at: string | null;
  message_count: number;
  first_message_at?: string;
  last_message_at?: string;
};

type PromotedTaskMeta = {
  key: string | null;
  title: string | null;
  status: string | null;
  created_at: string;
};

type AuditEvent = {
  id: string;
  event_type: string;
  payload: any;
  actor_label: string | null;
  created_at: string;
};

const fmtVal = (v: unknown): string => {
  if (v == null || v === "") return "—";
  if (typeof v === "string") {
    // ISO date?
    if (/^\d{4}-\d{2}-\d{2}T/.test(v)) return new Date(v).toLocaleDateString();
    return v;
  }
  return JSON.stringify(v);
};

function formatEvent(e: { event_type: string; payload: any }): { label: string; detail?: string } {
  const p = e.payload ?? {};
  switch (e.event_type) {
    case "created":
      return { label: "Created", detail: p.title };
    case "accepted":
      return {
        label: "Accepted from extraction",
        detail: p.extracted_confidence != null
          ? `${p.title ?? ""} · conf ${(p.extracted_confidence * 100).toFixed(0)}%`
          : p.title,
      };
    case "rejected":
      return { label: "Proposal rejected", detail: p.title };
    case "extracted":
      return { label: "Extracted from transcript", detail: p.title };
    case "status_changed":
      return { label: `Status: ${fmtVal(p.from)} → ${fmtVal(p.to)}` };
    case "owner_changed":
      return { label: `Owner: ${fmtVal(p.from)} → ${fmtVal(p.to)}` };
    case "due_changed":
      return { label: `Due date: ${fmtVal(p.from)} → ${fmtVal(p.to)}` };
    case "priority_changed":
      return { label: `Priority: ${fmtVal(p.from)} → ${fmtVal(p.to)}` };
    case "title_changed":
      return { label: "Title changed", detail: `${fmtVal(p.from)} → ${fmtVal(p.to)}` };
    case "promoted":
      return { label: "Promoted to roadmap task", detail: p.task_id };
    case "deleted":
      return { label: "Deleted", detail: p.title };
    default:
      return { label: e.event_type };
  }
}

function eventColor(type: string): string {
  if (type === "promoted") return "bg-emerald-500";
  if (type === "deleted" || type === "rejected") return "bg-destructive";
  if (type === "accepted" || type === "created" || type === "extracted") return "bg-primary";
  return "bg-muted-foreground";
}

export function JobDetailsDrawer({
  job,
  subjectShortNum,
  discussionOrdinal,
  open,
  onOpenChange,
  onPromote,
}: Props) {
  const [discMeta, setDiscMeta] = useState<DiscussionMeta | null>(null);
  const [taskMeta, setTaskMeta] = useState<PromotedTaskMeta | null>(null);
  const [events, setEvents] = useState<AuditEvent[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open || !job) return;
    let cancelled = false;
    const jobId = job.id;

    const loadEvents = async () => {
      const { data: ev } = await supabase
        .from("discussion_action_events")
        .select("id,event_type,payload,actor_label,created_at")
        .eq("action_id", jobId)
        .order("created_at", { ascending: true });
      if (!cancelled) setEvents((ev ?? []) as AuditEvent[]);
    };

    (async () => {
      setLoading(true);
      setDiscMeta(null);
      setTaskMeta(null);
      setEvents([]);

      const tasks: Promise<unknown>[] = [loadEvents()];

      if (job.discussion_id) {
        tasks.push((async () => {
          const [{ data: d }, { data: msgs }] = await Promise.all([
            supabase
              .from("roadmap_finding_discussions")
              .select("title, created_at, ended_at")
              .eq("id", job.discussion_id!)
              .maybeSingle(),
            supabase
              .from("roadmap_finding_discussion_messages")
              .select("created_at")
              .eq("discussion_id", job.discussion_id!)
              .order("created_at", { ascending: true }),
          ]);
          if (!cancelled && d) {
            const list = (msgs ?? []) as { created_at: string }[];
            setDiscMeta({
              title: (d as any).title ?? null,
              created_at: (d as any).created_at,
              ended_at: (d as any).ended_at,
              message_count: list.length,
              first_message_at: list[0]?.created_at,
              last_message_at: list[list.length - 1]?.created_at,
            });
          }
        })());
      }

      if (job.promoted_task_id) {
        tasks.push((async () => {
          const { data: t } = await supabase
            .from("roadmap_tasks")
            .select("key, title, status, created_at")
            .eq("id", job.promoted_task_id!)
            .maybeSingle();
          if (!cancelled && t) setTaskMeta(t as PromotedTaskMeta);
        })());
      }

      await Promise.all(tasks);
      if (!cancelled) setLoading(false);
    })();

    const ch = supabase
      .channel(`job-events-${jobId}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "discussion_action_events", filter: `action_id=eq.${jobId}` },
        () => loadEvents(),
      )
      .subscribe();

    return () => {
      cancelled = true;
      supabase.removeChannel(ch);
    };
  }, [open, job?.id, job?.discussion_id, job?.promoted_task_id]);

  if (!job) return null;

  const handle = jobHandle(job.short_num);
  const subj = subjectHandle(job.subject_type, subjectShortNum);
  const dHandle =
    job.discussion_id != null
      ? discussionHandle(job.subject_type, subjectShortNum, discussionOrdinal)
      : null;

  const timeline: TimelineItem[] = [];
  timeline.push({ at: job.created_at, label: `${handle} created`, detail: `source: ${job.source}` });
  if (discMeta) {
    timeline.push({
      at: discMeta.created_at,
      label: `Discussion ${dHandle ?? ""} started`.trim(),
      detail: discMeta.title ?? undefined,
    });
    if (discMeta.first_message_at)
      timeline.push({ at: discMeta.first_message_at, label: "First message" });
    if (discMeta.last_message_at && discMeta.last_message_at !== discMeta.first_message_at)
      timeline.push({
        at: discMeta.last_message_at,
        label: "Last message",
        detail: `${discMeta.message_count} total`,
      });
    if (discMeta.ended_at)
      timeline.push({ at: discMeta.ended_at, label: "Discussion ended" });
  }
  if (job.due_at) timeline.push({ at: job.due_at, label: "Due", detail: "scheduled" });
  if (taskMeta)
    timeline.push({
      at: taskMeta.created_at,
      label: "Promoted to roadmap task",
      detail: taskMeta.key ? taskMeta.key : undefined,
    });
  if (job.updated_at && job.updated_at !== job.created_at)
    timeline.push({ at: job.updated_at, label: `Last updated · status ${job.status}` });

  timeline.sort((a, b) => +new Date(a.at) - +new Date(b.at));

  const copy = (text: string) => {
    navigator.clipboard.writeText(text);
    toast({ title: "Copied", description: text });
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full sm:max-w-lg overflow-y-auto">
        <SheetHeader className="space-y-2">
          <div className="flex items-center gap-2 flex-wrap">
            <button
              onClick={() => copy(handle)}
              className="font-mono text-xs text-muted-foreground inline-flex items-center gap-1 hover:text-foreground"
              title="Copy handle"
            >
              {handle} <Copy className="h-3 w-3" />
            </button>
            <Badge variant="outline" className="text-[10px] uppercase">{job.priority}</Badge>
            <Badge variant="outline" className="text-[10px]">{job.status}</Badge>
            <Badge variant="outline" className="text-[10px]">{job.source}</Badge>
            {job.promoted_task_id && (
              <Badge variant="secondary" className="text-[10px]">promoted</Badge>
            )}
          </div>
          <SheetTitle className="leading-snug">{job.title}</SheetTitle>
          <SheetDescription className="flex items-center gap-2 flex-wrap text-xs">
            <span className="font-mono">{subj}</span>
            {dHandle && (
              <>
                <span>·</span>
                <button
                  onClick={() => copy(dHandle)}
                  className="font-mono inline-flex items-center gap-1 hover:text-foreground"
                  title="Copy discussion handle"
                >
                  {dHandle} <Copy className="h-3 w-3" />
                </button>
              </>
            )}
            {job.owner && <Badge variant="outline" className="text-[10px]">@{job.owner}</Badge>}
            {job.extracted_confidence != null && (
              <Badge variant="outline" className="text-[10px]">
                conf {(job.extracted_confidence * 100).toFixed(0)}%
              </Badge>
            )}
          </SheetDescription>
        </SheetHeader>

        <div className="mt-5 space-y-5">
          <section>
            <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground mb-1.5">
              Details
            </h3>
            {job.details ? (
              <p className="text-sm whitespace-pre-wrap leading-relaxed">{job.details}</p>
            ) : (
              <p className="text-sm text-muted-foreground italic">No details.</p>
            )}
          </section>

          <Separator />

          <section>
            <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground mb-2">
              Assignment
            </h3>
            <JobOwnerDueEditor
              jobId={job.id}
              owner={job.owner}
              dueAt={job.due_at}
              size="md"
            />
          </section>

          <Separator />

          <section>
            <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground mb-2">
              Context
            </h3>
            <ol className="space-y-2">
              {timeline.map((t, i) => (
                <li key={i} className="flex gap-3 text-sm">
                  <div className="flex flex-col items-center pt-1">
                    <div className="h-2 w-2 rounded-full bg-primary" />
                    {i < timeline.length - 1 && <div className="flex-1 w-px bg-border mt-1 min-h-[16px]" />}
                  </div>
                  <div className="flex-1 pb-2">
                    <div className="text-xs text-muted-foreground">
                      {new Date(t.at).toLocaleString()}
                    </div>
                    <div className="font-medium">{t.label}</div>
                    {t.detail && <div className="text-xs text-muted-foreground">{t.detail}</div>}
                  </div>
                </li>
              ))}
            </ol>
          </section>

          <Separator />

          <section>
            <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground mb-2">
              Activity log
            </h3>
            {events.length === 0 ? (
              <p className="text-xs text-muted-foreground italic">
                {loading ? "Loading activity…" : "No activity recorded yet."}
              </p>
            ) : (
              <ol className="space-y-2">
                {events.map((e, i) => {
                  const { label, detail } = formatEvent(e);
                  return (
                    <li key={e.id} className="flex gap-3 text-sm">
                      <div className="flex flex-col items-center pt-1">
                        <div className={`h-2 w-2 rounded-full ${eventColor(e.event_type)}`} />
                        {i < events.length - 1 && <div className="flex-1 w-px bg-border mt-1 min-h-[16px]" />}
                      </div>
                      <div className="flex-1 pb-2">
                        <div className="text-xs text-muted-foreground flex items-center gap-2">
                          <span>{new Date(e.created_at).toLocaleString()}</span>
                          {e.actor_label && <span>· {e.actor_label}</span>}
                        </div>
                        <div className="font-medium">{label}</div>
                        {detail && <div className="text-xs text-muted-foreground break-words">{detail}</div>}
                      </div>
                    </li>
                  );
                })}
              </ol>
            )}
          </section>

          <Separator />

          <section className="space-y-2">
            <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Related
            </h3>
            <div className="flex flex-wrap gap-2">
              {job.subject_type === "roadmap_finding" && (
                <Button asChild size="sm" variant="outline">
                  <Link to={`/roadmap/risks#finding-${job.subject_id}`}>
                    <ExternalLink className="h-3.5 w-3.5 mr-1" />
                    Open {subj}
                  </Link>
                </Button>
              )}
              {dHandle && (
                <Badge variant="outline" className="font-mono text-[11px] inline-flex items-center gap-1">
                  <MessagesSquare className="h-3 w-3" /> {dHandle}
                  {discMeta && <span className="text-muted-foreground">· {discMeta.message_count} msgs</span>}
                </Badge>
              )}
              {taskMeta && (
                <Badge variant="secondary" className="text-[11px]">
                  Task: {taskMeta.key ?? "—"} · {taskMeta.status}
                </Badge>
              )}
              {!job.promoted_task_id && onPromote && (
                <Button size="sm" onClick={() => onPromote(job)}>
                  <ArrowUpRightFromSquare className="h-3.5 w-3.5 mr-1" />
                  Promote to roadmap task
                </Button>
              )}
            </div>
          </section>
        </div>
      </SheetContent>
    </Sheet>
  );
}
