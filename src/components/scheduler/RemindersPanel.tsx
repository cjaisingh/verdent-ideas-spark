// Reusable reminders panel for an entity (tenant / external_contact / operator).
// Lists open + recent scheduled_jobs of kind='reminder.send' scoped to the
// given subject, and lets the user enqueue a new one via scheduler-enqueue.
//
// Used on /tenants/:id and /contacts/:id (W8.1 client-facing surface).

import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import { Bell, Plus, X, Loader2 } from "lucide-react";

type SubjectType = "tenant" | "external_contact" | "operator";

type Job = {
  id: string;
  kind: string;
  status: string;
  run_at: string;
  recurrence: string | null;
  payload: Record<string, unknown>;
  dedupe_key: string;
  last_error: string | null;
  attempts: number;
  max_retries: number;
};

const STATUS_VARIANT: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  pending: "secondary",
  running: "default",
  done: "outline",
  failed: "destructive",
  cancelled: "outline",
  auto_blocked: "destructive",
};

type Props = {
  subjectType: SubjectType;
  subjectId: string;
  tenantId?: string | null;
  subjectLabel?: string;
};

export function RemindersPanel({ subjectType, subjectId, tenantId, subjectLabel }: Props) {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState("");
  const [runAt, setRunAt] = useState(() =>
    new Date(Date.now() + 60 * 60_000).toISOString().slice(0, 16),
  );
  const [actionTitle, setActionTitle] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("scheduled_jobs")
      .select("id, kind, status, run_at, recurrence, payload, dedupe_key, last_error, attempts, max_retries")
      .eq("kind", "reminder.send")
      .eq("subject_type", subjectType)
      .eq("subject_id", subjectId)
      .order("run_at", { ascending: false })
      .limit(50);
    if (error) toast.error(`Reminders: ${error.message}`);
    setJobs((data ?? []) as Job[]);
    setLoading(false);
  }, [subjectType, subjectId]);

  useEffect(() => {
    load();
    const ch = supabase
      .channel(`reminders-${subjectType}-${subjectId}-${crypto.randomUUID()}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "scheduled_jobs", filter: `subject_id=eq.${subjectId}` },
        () => load(),
      )
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
  }, [load, subjectType, subjectId]);

  const submit = async () => {
    if (!message.trim()) {
      toast.error("Message is required");
      return;
    }
    const isoRunAt = new Date(runAt).toISOString();
    if (Number.isNaN(Date.parse(isoRunAt))) {
      toast.error("Invalid run_at");
      return;
    }
    setSubmitting(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/scheduler-enqueue`;
      const dedupe = `reminder:${subjectType}:${subjectId}:${Date.now()}`;
      const res = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session?.access_token ?? ""}`,
        },
        body: JSON.stringify({
          kind: "reminder.send",
          owning_module: "awip_core",
          tenant_id: tenantId ?? null,
          subject_type: subjectType,
          subject_id: subjectId,
          dedupe_key: dedupe,
          run_at: isoRunAt,
          payload: {
            message: message.trim(),
            action_title: actionTitle.trim() || undefined,
            create_action: true,
          },
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`);
      toast.success(json.created ? "Reminder scheduled" : "Reminder already exists");
      setOpen(false);
      setMessage("");
      setActionTitle("");
      load();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSubmitting(false);
    }
  };

  const cancel = async (id: string) => {
    const { error } = await supabase
      .from("scheduled_jobs")
      .update({ status: "cancelled" })
      .eq("id", id)
      .eq("status", "pending");
    if (error) toast.error(error.message);
    else {
      toast.success("Cancelled");
      load();
    }
  };

  return (
    <Card data-testid="reminders-panel">
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <Bell className="h-4 w-4" /> Reminders
          {jobs.length > 0 && (
            <span className="text-xs text-muted-foreground">({jobs.length})</span>
          )}
        </CardTitle>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button size="sm" variant="outline">
              <Plus className="h-3.5 w-3.5 mr-1" /> Add reminder
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>
                Schedule reminder{subjectLabel ? ` — ${subjectLabel}` : ""}
              </DialogTitle>
            </DialogHeader>
            <div className="space-y-3">
              <div>
                <Label htmlFor="rem-msg">Message</Label>
                <Textarea
                  id="rem-msg"
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  placeholder="What should the reminder say?"
                  rows={3}
                />
              </div>
              <div>
                <Label htmlFor="rem-title">Operator-inbox title (optional)</Label>
                <Input
                  id="rem-title"
                  value={actionTitle}
                  onChange={(e) => setActionTitle(e.target.value)}
                  placeholder="Defaults to first line of message"
                />
              </div>
              <div>
                <Label htmlFor="rem-run">Run at (UTC)</Label>
                <Input
                  id="rem-run"
                  type="datetime-local"
                  value={runAt}
                  onChange={(e) => setRunAt(e.target.value)}
                />
              </div>
              <p className="text-xs text-muted-foreground">
                Delivered via Telegram (if a chat_id is on the contact) + operator inbox.
              </p>
            </div>
            <DialogFooter>
              <Button variant="ghost" onClick={() => setOpen(false)} disabled={submitting}>
                Cancel
              </Button>
              <Button onClick={submit} disabled={submitting}>
                {submitting && <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />}
                Schedule
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </CardHeader>
      <CardContent className="space-y-2">
        {loading ? (
          <p className="text-xs text-muted-foreground">Loading…</p>
        ) : jobs.length === 0 ? (
          <p className="text-xs text-muted-foreground">No reminders yet.</p>
        ) : (
          <ul className="space-y-2">
            {jobs.map((j) => {
              const msg = typeof j.payload?.message === "string" ? (j.payload.message as string) : "(no message)";
              return (
                <li key={j.id} className="flex items-start gap-2 text-sm border-l-2 pl-2 border-border">
                  <Badge variant={STATUS_VARIANT[j.status] ?? "outline"} className="shrink-0 text-[10px]">
                    {j.status}
                  </Badge>
                  <div className="flex-1 min-w-0">
                    <div className="truncate">{msg}</div>
                    <div className="text-[10px] text-muted-foreground">
                      {new Date(j.run_at).toLocaleString()} · attempts {j.attempts}/{j.max_retries}
                      {j.last_error && <> · err: {j.last_error.slice(0, 60)}</>}
                    </div>
                  </div>
                  {j.status === "pending" && (
                    <Button size="sm" variant="ghost" onClick={() => cancel(j.id)} title="Cancel">
                      <X className="h-3.5 w-3.5" />
                    </Button>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

export default RemindersPanel;
