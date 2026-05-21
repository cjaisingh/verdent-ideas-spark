import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { ListChecks, Plus, Sparkles, Trash2 } from "lucide-react";
import { toast } from "@/hooks/use-toast";
import { jobHandle } from "@/lib/discussionHandles";
import { JobOwnerDueEditor } from "./JobOwnerDueEditor";
import { ProposalReviewSheet, type Proposal as ReviewProposal } from "./ProposalReviewSheet";

type Action = {
  id: string;
  short_num: number;
  title: string;
  details: string | null;
  status: string;
  priority: string;
  owner: string | null;
  source: string;
  source_ref: string | null;
  promoted_task_id: string | null;
  due_at: string | null;
  created_at: string;
};

function SourceBadge({ source, sourceRef }: { source: string; sourceRef: string | null }) {
  if (source === "plan_footer") {
    return (
      <Badge variant="outline" className="text-[9px] border-amber-500/40 text-amber-600" title={sourceRef ?? undefined}>
        from plan
      </Badge>
    );
  }
  if (source === "session_summary") {
    return (
      <Badge variant="outline" className="text-[9px] border-indigo-500/40 text-indigo-600" title={sourceRef ?? undefined}>
        from session
      </Badge>
    );
  }
  if (!source || source === "manual") return null;
  return <Badge variant="outline" className="text-[9px]">{source}</Badge>;
}

type Proposal = {
  title: string;
  details: string | null;
  priority: string;
  owner_hint: string | null;
  confidence: number | null;
};

type Props = {
  discussionId: string;
  subjectType: string;
  subjectId: string;
};

const STATUS_NEXT: Record<string, string> = {
  open: "in_progress",
  in_progress: "done",
  done: "open",
  cancelled: "open",
};

export function DiscussionActionsPanel({ discussionId, subjectType, subjectId }: Props) {
  const [items, setItems] = useState<Action[]>([]);
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState("");
  const [proposals, setProposals] = useState<Proposal[]>([]);
  const [extracting, setExtracting] = useState(false);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [autoOnly, setAutoOnly] = useState(false);

  const load = async () => {
    const { data } = await supabase
      .from("discussion_actions")
      .select("id,short_num,title,details,status,priority,owner,source,source_ref,promoted_task_id,due_at,created_at")
      .eq("discussion_id", discussionId)
      .order("created_at", { ascending: true });
    setItems((data ?? []) as Action[]);
  };

  useEffect(() => {
    load();
    const ch = supabase
      .channel(`actions-${discussionId}`)
      .on("postgres_changes",
        { event: "*", schema: "public", table: "discussion_actions", filter: `discussion_id=eq.${discussionId}` },
        () => load())
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [discussionId]);

  const addManual = async () => {
    const title = draft.trim();
    if (!title) return;
    const { data: u } = await supabase.auth.getUser();
    const { error } = await supabase.from("discussion_actions").insert({
      discussion_id: discussionId,
      subject_type: subjectType,
      subject_id: subjectId,
      title,
      source: "manual",
      created_by: u.user?.id ?? null,
    });
    if (error) { toast({ title: "Could not add", description: error.message, variant: "destructive" }); return; }
    setDraft("");
    setAdding(false);
  };

  const extract = async () => {
    setExtracting(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/discussion-extract-actions`;
      const resp = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${session?.access_token}` },
        body: JSON.stringify({ discussion_id: discussionId }),
      });
      const j = await resp.json();
      if (!resp.ok) {
        toast({ title: "Extract failed", description: j?.error ?? `HTTP ${resp.status}`, variant: "destructive" });
        return;
      }
      const fetched = (j?.proposals ?? []) as Proposal[];
      setProposals(fetched);
      if (fetched.length === 0) {
        toast({ title: "No actions found", description: "Transcript didn't surface anything actionable." });
      } else {
        setReviewOpen(true);
      }
    } finally {
      setExtracting(false);
    }
  };

  const cycleStatus = async (a: Action) => {
    const next = STATUS_NEXT[a.status] ?? "open";
    await supabase.from("discussion_actions").update({ status: next }).eq("id", a.id);
  };

  const remove = async (a: Action) => {
    if (!confirm(`Delete ${jobHandle(a.short_num)}?`)) return;
    await supabase.from("discussion_actions").delete().eq("id", a.id);
  };

  return (
    <div className="rounded-md border p-3 space-y-2">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-sm font-medium">
          <ListChecks className="h-4 w-4" /> Action items
          {items.length > 0 && <Badge variant="secondary" className="text-[10px]">{items.length}</Badge>}
        </div>
        <div className="flex items-center gap-1">
          {proposals.length > 0 && (
            <Button size="sm" variant="secondary" onClick={() => setReviewOpen(true)}>
              Review {proposals.length}
            </Button>
          )}
          <Button size="sm" variant="outline" onClick={extract} disabled={extracting}>
            <Sparkles className="h-3.5 w-3.5 mr-1" /> {extracting ? "Extracting…" : "Extract"}
          </Button>
          <Button size="sm" variant="outline" onClick={() => setAdding((v) => !v)}>
            <Plus className="h-3.5 w-3.5 mr-1" /> Add
          </Button>
        </div>
      </div>

      {adding && (
        <div className="flex gap-2">
          <Input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="Action item title…"
            autoFocus
            onKeyDown={(e) => { if (e.key === "Enter") addManual(); }}
          />
          <Button size="sm" onClick={addManual}>Save</Button>
        </div>
      )}

      {items.length === 0 && proposals.length === 0 ? (
        <p className="text-xs text-muted-foreground">No action items yet. Add one or extract from the transcript.</p>
      ) : (
        <div className="space-y-1">
          {items.map((a) => (
            <div key={a.id} className="rounded border p-2 text-xs space-y-1.5">
              <div className="flex items-center gap-2">
                <button
                  onClick={() => cycleStatus(a)}
                  className="shrink-0"
                  title={`Status: ${a.status} (click to advance)`}
                >
                  <Badge
                    variant={a.status === "done" ? "secondary" : a.status === "in_progress" ? "default" : "outline"}
                    className="text-[9px] uppercase"
                  >
                    {a.status}
                  </Badge>
                </button>
                <span className="font-mono text-[10px] text-muted-foreground shrink-0">{jobHandle(a.short_num)}</span>
                <Badge variant="outline" className="text-[9px]">{a.priority}</Badge>
                <SourceBadge source={a.source} sourceRef={a.source_ref} />
                {a.promoted_task_id && <Badge variant="secondary" className="text-[9px]">promoted</Badge>}
                <span className="flex-1 min-w-0 truncate">{a.title}</span>
                <Button size="icon" variant="ghost" className="h-6 w-6" onClick={() => remove(a)} title="Delete">
                  <Trash2 className="h-3 w-3" />
                </Button>
              </div>
              <div className="flex items-center justify-end">
                <JobOwnerDueEditor
                  jobId={a.id}
                  owner={a.owner}
                  dueAt={a.due_at}
                  size="sm"
                />
              </div>
            </div>
          ))}
        </div>
      )}

      <ProposalReviewSheet
        open={reviewOpen}
        onOpenChange={setReviewOpen}
        discussionId={discussionId}
        subjectType={subjectType}
        subjectId={subjectId}
        proposals={proposals as ReviewProposal[]}
        onDone={() => setProposals([])}
      />
    </div>
  );
}
