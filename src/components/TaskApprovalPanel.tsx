import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { toast } from "@/hooks/use-toast";
import { CheckCircle2, XCircle, AlertCircle, RotateCcw, History } from "lucide-react";

type ReviewStatus = "pending" | "approved" | "rejected" | "changes_requested";
type Decision = "approved" | "rejected" | "changes_requested" | "reopened";

type ChecklistRow = {
  id: string;
  item_key: string;
  category: string;
  label: string;
  checked: boolean;
  note: string | null;
};

type Review = {
  id: string;
  task_id: string;
  decision: Decision;
  notes: string | null;
  checklist_total: number;
  checklist_done: number;
  checklist_snapshot: unknown;
  reviewer: string | null;
  created_at: string;
};

type Props = {
  taskId: string;
  reviewStatus: ReviewStatus;
  reviewedBy: string | null;
  reviewedAt: string | null;
  reviewNotes: string | null;
};

const STATUS_META: Record<ReviewStatus, { label: string; cls: string; icon: typeof CheckCircle2 }> = {
  pending: { label: "Pending review", cls: "bg-muted text-muted-foreground", icon: AlertCircle },
  approved: { label: "Approved", cls: "bg-emerald-500/15 text-emerald-700 border-emerald-500/40", icon: CheckCircle2 },
  rejected: { label: "Rejected", cls: "bg-destructive/15 text-destructive border-destructive/40", icon: XCircle },
  changes_requested: { label: "Changes requested", cls: "bg-amber-500/15 text-amber-700 border-amber-500/40", icon: AlertCircle },
};

export const TaskApprovalPanel = ({ taskId, reviewStatus, reviewedBy, reviewedAt, reviewNotes }: Props) => {
  const [history, setHistory] = useState<Review[]>([]);
  const [showHistory, setShowHistory] = useState(false);
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [checklist, setChecklist] = useState<ChecklistRow[]>([]);

  const load = async () => {
    const [h, c] = await Promise.all([
      supabase
        .from("roadmap_task_reviews")
        .select("*")
        .eq("task_id", taskId)
        .order("created_at", { ascending: false }),
      supabase
        .from("roadmap_task_checklist")
        .select("id,item_key,category,label,checked,note")
        .eq("task_id", taskId)
        .order("order"),
    ]);
    if (h.data) setHistory(h.data as Review[]);
    if (c.data) setChecklist(c.data as ChecklistRow[]);
  };

  useEffect(() => {
    load();
    const ch = supabase
      .channel(`reviews-${taskId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "roadmap_task_reviews", filter: `task_id=eq.${taskId}` },
        () => load(),
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "roadmap_task_checklist", filter: `task_id=eq.${taskId}` },
        () => load(),
      )
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [taskId]);

  const total = checklist.length;
  const done = checklist.filter((c) => c.checked).length;
  const allTicked = total > 0 && done === total;

  const submit = async (decision: Decision) => {
    const trimmed = notes.trim().slice(0, 2000);
    if (decision === "rejected" && !trimmed) {
      toast({ title: "Notes required to reject", variant: "destructive" });
      return;
    }
    if (decision === "approved" && !allTicked) {
      const ok = confirm(
        `Only ${done}/${total} checklist items are ticked. Approve anyway?`,
      );
      if (!ok) return;
    }
    setBusy(true);
    try {
      const { data: u } = await supabase.auth.getUser();
      const reviewer = u.user?.email ?? null;
      const reviewer_id = u.user?.id ?? null;
      const snapshot = checklist.map((c) => ({
        item_key: c.item_key,
        category: c.category,
        label: c.label,
        checked: c.checked,
        note: c.note,
      }));

      const ins = await supabase.from("roadmap_task_reviews").insert({
        task_id: taskId,
        decision,
        notes: trimmed || null,
        checklist_snapshot: snapshot,
        checklist_total: total,
        checklist_done: done,
        reviewer,
        reviewer_id,
      });
      if (ins.error) throw ins.error;

      const nextStatus: ReviewStatus =
        decision === "approved" ? "approved"
        : decision === "rejected" ? "rejected"
        : decision === "changes_requested" ? "changes_requested"
        : "pending";

      const upd = await supabase
        .from("roadmap_tasks")
        .update({
          review_status: nextStatus,
          reviewed_by: decision === "reopened" ? null : reviewer,
          reviewed_at: decision === "reopened" ? null : new Date().toISOString(),
          review_notes: decision === "reopened" ? null : trimmed || null,
        })
        .eq("id", taskId);
      if (upd.error) throw upd.error;

      toast({ title: `Marked ${nextStatus.replace("_", " ")}` });
      setNotes("");
    } catch (e: unknown) {
      toast({ title: "Failed", description: e instanceof Error ? e.message : String(e), variant: "destructive" });
    } finally {
      setBusy(false);
    }
  };

  const meta = STATUS_META[reviewStatus] ?? STATUS_META.pending;
  const Icon = meta.icon;

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Approval</div>
        <button
          onClick={() => setShowHistory(!showHistory)}
          className="text-[10px] text-muted-foreground hover:text-foreground inline-flex items-center gap-0.5"
        >
          <History className="h-3 w-3" />
          History ({history.length})
        </button>
      </div>

      <div className={`flex items-center gap-2 px-2 py-1.5 rounded border ${meta.cls}`}>
        <Icon className="h-3.5 w-3.5" />
        <span className="text-xs font-medium">{meta.label}</span>
        {total > 0 && (
          <Badge variant="outline" className="text-[10px] ml-auto">
            checklist {done}/{total}
          </Badge>
        )}
      </div>

      {reviewedBy && reviewStatus !== "pending" && (
        <div className="text-[10px] text-muted-foreground">
          {reviewedBy} · {reviewedAt ? new Date(reviewedAt).toLocaleString() : ""}
          {reviewNotes && <div className="mt-0.5 italic whitespace-pre-wrap">"{reviewNotes}"</div>}
        </div>
      )}

      <Textarea
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        maxLength={2000}
        placeholder="Decision notes (required to reject)…"
        className="text-xs min-h-[50px]"
      />

      <div className="flex flex-wrap gap-1">
        <Button
          size="sm"
          className="h-7 text-[11px] bg-emerald-600 hover:bg-emerald-700 text-white"
          onClick={() => submit("approved")}
          disabled={busy}
        >
          <CheckCircle2 className="h-3 w-3 mr-1" /> Approve
        </Button>
        <Button
          size="sm"
          variant="outline"
          className="h-7 text-[11px] border-amber-500/50 text-amber-700 hover:bg-amber-500/10"
          onClick={() => submit("changes_requested")}
          disabled={busy}
        >
          <AlertCircle className="h-3 w-3 mr-1" /> Request changes
        </Button>
        <Button
          size="sm"
          variant="destructive"
          className="h-7 text-[11px]"
          onClick={() => submit("rejected")}
          disabled={busy}
        >
          <XCircle className="h-3 w-3 mr-1" /> Reject
        </Button>
        {reviewStatus !== "pending" && (
          <Button
            size="sm"
            variant="ghost"
            className="h-7 text-[11px]"
            onClick={() => submit("reopened")}
            disabled={busy}
          >
            <RotateCcw className="h-3 w-3 mr-1" /> Reopen
          </Button>
        )}
      </div>

      {showHistory && (
        <div className="space-y-1 border-t border-border pt-2 max-h-60 overflow-auto">
          {history.length === 0 && <div className="text-[11px] italic text-muted-foreground">No prior decisions.</div>}
          {history.map((r) => (
            <div key={r.id} className="text-[11px] border border-border rounded p-1.5 bg-muted/20">
              <div className="flex items-center gap-2 flex-wrap">
                <Badge variant="outline" className="text-[10px] uppercase">{r.decision.replace("_", " ")}</Badge>
                <span className="text-muted-foreground">
                  {r.reviewer ?? "system"} · {new Date(r.created_at).toLocaleString()}
                </span>
                <span className="ml-auto text-[10px] text-muted-foreground">
                  checklist {r.checklist_done}/{r.checklist_total}
                </span>
              </div>
              {r.notes && <div className="mt-0.5 text-muted-foreground whitespace-pre-wrap">{r.notes}</div>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
