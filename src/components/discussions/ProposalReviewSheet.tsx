import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription, SheetFooter } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sparkles, Check, X, Loader2 } from "lucide-react";
import { toast } from "@/hooks/use-toast";

export type Proposal = {
  title: string;
  details: string | null;
  priority: string;
  risk?: string;
  owner_hint: string | null;
  confidence: number | null;
};

type Draft = Proposal & { decision: "pending" | "accepted" | "rejected"; risk: string };

type Props = {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  discussionId: string;
  subjectType: string;
  subjectId: string;
  proposals: Proposal[];
  onDone?: (counts: { accepted: number; rejected: number }) => void;
};

export function ProposalReviewSheet({
  open, onOpenChange, discussionId, subjectType, subjectId, proposals, onDone,
}: Props) {
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (open) {
      setDrafts(proposals.map((p) => ({ ...p, risk: p.risk ?? "med", decision: "pending" })));
    }
  }, [open, proposals]);

  const update = (i: number, patch: Partial<Draft>) =>
    setDrafts((prev) => prev.map((d, idx) => (idx === i ? { ...d, ...patch } : d)));

  const pending = drafts.filter((d) => d.decision === "pending").length;
  const accepted = drafts.filter((d) => d.decision === "accepted").length;
  const rejected = drafts.filter((d) => d.decision === "rejected").length;

  const submit = async () => {
    if (pending > 0) {
      toast({ title: "Decide on every proposal", description: `${pending} still pending.`, variant: "destructive" });
      return;
    }
    setSubmitting(true);
    try {
      const { data: u } = await supabase.auth.getUser();
      const toAccept = drafts.filter((d) => d.decision === "accepted");
      const toReject = drafts.filter((d) => d.decision === "rejected");

      if (toAccept.length > 0) {
        const rows = toAccept.map((p) => ({
          discussion_id: discussionId,
          subject_type: subjectType,
          subject_id: subjectId,
          title: p.title,
          details: p.details,
          priority: p.priority,
          risk: p.risk ?? "med",
          owner: p.owner_hint,
          source: "extracted",
          extracted_confidence: p.confidence,
          created_by: u.user?.id ?? null,
        }));
        const { error } = await supabase.from("discussion_actions").insert(rows);
        if (error) throw error;
      }

      if (toReject.length > 0) {
        const events = toReject.map((p) => ({
          action_id: null,
          discussion_id: discussionId,
          event_type: "rejected",
          payload: {
            title: p.title,
            details: p.details,
            priority: p.priority,
            owner_hint: p.owner_hint,
            confidence: p.confidence,
          },
        }));
        await supabase.from("discussion_action_events").insert(events);
      }

      toast({
        title: "Review complete",
        description: `${toAccept.length} accepted, ${toReject.length} rejected.`,
      });
      onDone?.({ accepted: toAccept.length, rejected: toReject.length });
      onOpenChange(false);
    } catch (e: any) {
      toast({ title: "Could not save", description: e?.message ?? "unknown", variant: "destructive" });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full sm:max-w-2xl flex flex-col">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            <Sparkles className="h-4 w-4" /> Review extracted proposals
            <Badge variant="secondary" className="text-[10px]">{drafts.length}</Badge>
          </SheetTitle>
          <SheetDescription className="text-xs">
            Edit, accept, or reject each item. Accepted items are inserted as jobs; rejections are logged for audit.
          </SheetDescription>
        </SheetHeader>

        <div className="flex-1 overflow-y-auto -mx-6 px-6 py-3 space-y-3">
          {drafts.length === 0 && (
            <div className="text-xs text-muted-foreground py-6 text-center">No proposals to review.</div>
          )}
          {drafts.map((d, i) => (
            <div
              key={i}
              className={[
                "rounded-md border p-3 space-y-2 transition-colors",
                d.decision === "accepted" && "border-emerald-500/50 bg-emerald-500/5",
                d.decision === "rejected" && "border-destructive/40 bg-destructive/5 opacity-70",
              ].filter(Boolean).join(" ")}
            >
              <div className="flex items-center gap-2">
                <Badge variant="outline" className="text-[10px] uppercase">#{i + 1}</Badge>
                {d.confidence != null && (
                  <span className="text-[10px] text-muted-foreground">
                    conf {Math.round(d.confidence * 100)}%
                  </span>
                )}
                <div className="ml-auto flex items-center gap-1">
                  <Button
                    size="sm"
                    variant={d.decision === "accepted" ? "default" : "outline"}
                    className="h-7"
                    onClick={() => update(i, { decision: d.decision === "accepted" ? "pending" : "accepted" })}
                  >
                    <Check className="h-3.5 w-3.5 mr-1" /> Accept
                  </Button>
                  <Button
                    size="sm"
                    variant={d.decision === "rejected" ? "destructive" : "outline"}
                    className="h-7"
                    onClick={() => update(i, { decision: d.decision === "rejected" ? "pending" : "rejected" })}
                  >
                    <X className="h-3.5 w-3.5 mr-1" /> Reject
                  </Button>
                </div>
              </div>

              <Input
                value={d.title}
                onChange={(e) => update(i, { title: e.target.value })}
                placeholder="Title"
                className="h-8 text-sm"
                disabled={d.decision === "rejected"}
              />
              <Textarea
                value={d.details ?? ""}
                onChange={(e) => update(i, { details: e.target.value || null })}
                placeholder="Details (optional)"
                className="text-xs min-h-[60px]"
                disabled={d.decision === "rejected"}
              />
              <div className="grid grid-cols-3 gap-2">
                <Select
                  value={d.priority}
                  onValueChange={(v) => update(i, { priority: v })}
                  disabled={d.decision === "rejected"}
                >
                  <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="priority" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="low">prio: low</SelectItem>
                    <SelectItem value="med">prio: med</SelectItem>
                    <SelectItem value="high">prio: high</SelectItem>
                    <SelectItem value="critical">prio: critical</SelectItem>
                  </SelectContent>
                </Select>
                <Select
                  value={d.risk}
                  onValueChange={(v) => update(i, { risk: v })}
                  disabled={d.decision === "rejected"}
                >
                  <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="risk" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="low">risk: low</SelectItem>
                    <SelectItem value="med">risk: med</SelectItem>
                    <SelectItem value="high">risk: high</SelectItem>
                    <SelectItem value="critical">risk: critical</SelectItem>
                  </SelectContent>
                </Select>
                <Input
                  value={d.owner_hint ?? ""}
                  onChange={(e) => update(i, { owner_hint: e.target.value || null })}
                  placeholder="Owner (optional)"
                  className="h-8 text-xs"
                  disabled={d.decision === "rejected"}
                />
              </div>
            </div>
          ))}
        </div>

        <SheetFooter className="flex-row items-center justify-between sm:justify-between gap-2 border-t pt-3">
          <div className="text-xs text-muted-foreground">
            {accepted} accept · {rejected} reject · {pending} pending
          </div>
          <div className="flex gap-2">
            <Button variant="ghost" size="sm" onClick={() => onOpenChange(false)} disabled={submitting}>Cancel</Button>
            <Button size="sm" onClick={submit} disabled={submitting || drafts.length === 0}>
              {submitting && <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />}
              Apply decisions
            </Button>
          </div>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
