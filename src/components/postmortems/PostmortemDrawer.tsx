import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";
import { supabase } from "@/integrations/supabase/client";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Archive, CheckCircle, RotateCcw, Save, History } from "lucide-react";

export type EvidenceItem = {
  at: string;
  kind: "sentinel_finding" | "failed_run" | "cost_spike" | "log_error" | "discussion_action" | "automation_failure";
  summary: string;
  ref?: Record<string, unknown>;
};

export type PostmortemRow = {
  id: string;
  subject_kind: "phase" | "sprint";
  subject_id: string;
  subject_label: string;
  slipped_on: string;
  days_late: number;
  root_cause: string | null;
  contributing_factors: string[];
  timeline: Array<{ at: string; what: string }>;
  what_changed: string | null;
  status: "draft" | "reviewed" | "archived";
  model: string | null;
  created_at: string;
  reviewed_at: string | null;
  archived_at: string | null;
  evidence: EvidenceItem[];
};

type EventRow = {
  id: string;
  postmortem_id: string;
  actor: string | null;
  action: string;
  field: string | null;
  before_value: string | null;
  after_value: string | null;
  created_at: string;
};

const fmtField = (f: string | null) =>
  f === "root_cause" ? "Root cause"
  : f === "what_changed" ? "What changed"
  : f === "contributing_factors" ? "Contributing factors"
  : f === "status" ? "Status"
  : f ?? "—";

const truncate = (s: string | null, n = 80) =>
  !s ? "" : s.length > n ? s.slice(0, n) + "…" : s;

export function PostmortemDrawer({
  row,
  open,
  onOpenChange,
  onChanged,
}: {
  row: PostmortemRow | null;
  open: boolean;
  onOpenChange: (b: boolean) => void;
  onChanged: () => void;
}) {
  const [saving, setSaving] = useState(false);
  const [rootCause, setRootCause] = useState("");
  const [whatChanged, setWhatChanged] = useState("");
  const [events, setEvents] = useState<EventRow[]>([]);
  const [showEvents, setShowEvents] = useState(false);

  useEffect(() => {
    if (!row) return;
    setRootCause(row.root_cause ?? "");
    setWhatChanged(row.what_changed ?? "");
    setShowEvents(false);
    (async () => {
      const { data, error } = await supabase
        .from("postmortem_events")
        .select("*")
        .eq("postmortem_id", row.id)
        .order("created_at", { ascending: false });
      if (error) toast.error(`events: ${error.message}`);
      else setEvents((data ?? []) as EventRow[]);
    })();
  }, [row]);

  if (!row) return null;

  const dirty = (rootCause !== (row.root_cause ?? "")) || (whatChanged !== (row.what_changed ?? ""));

  const save = async () => {
    setSaving(true);
    const { error } = await supabase
      .from("postmortems")
      .update({
        root_cause: rootCause.trim() === "" ? null : rootCause,
        what_changed: whatChanged.trim() === "" ? null : whatChanged,
      })
      .eq("id", row.id);
    setSaving(false);
    if (error) { toast.error(error.message); return; }
    toast.success("Saved");
    onChanged();
  };

  const setStatus = async (status: "draft" | "reviewed" | "archived") => {
    setSaving(true);
    const { data: { user } } = await supabase.auth.getUser();
    const nowIso = new Date().toISOString();
    const patch =
      status === "reviewed" ? {
        status, reviewed_at: nowIso, reviewed_by: user?.id ?? undefined,
        archived_at: null as string | null, archived_by: null as string | null,
      }
      : status === "archived" ? {
        status, archived_at: nowIso, archived_by: user?.id ?? undefined,
      }
      : {
        status,
        reviewed_at: null as string | null, reviewed_by: null as string | null,
        archived_at: null as string | null, archived_by: null as string | null,
      };
    const { error } = await supabase.from("postmortems").update(patch).eq("id", row.id);
    setSaving(false);
    if (error) { toast.error(error.message); return; }
    toast.success(
      status === "reviewed" ? "Marked reviewed"
      : status === "archived" ? "Archived"
      : "Reopened",
    );
    onChanged();
  };

  const subjectHref = row.subject_kind === "phase" ? "/master-plan" : "/roadmap";
  const statusVariant =
    row.status === "draft" ? "default"
    : row.status === "reviewed" ? "secondary"
    : "outline";

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-2xl overflow-y-auto">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            <Badge variant="outline">{row.subject_kind}</Badge>
            {row.subject_label}
            <Badge variant={statusVariant} className="ml-1 capitalize">{row.status}</Badge>
          </SheetTitle>
          <SheetDescription>
            Slipped {row.slipped_on} · {row.days_late} day{row.days_late === 1 ? "" : "s"} late
            {row.model ? ` · ${row.model}` : ""}
            {row.reviewed_at ? ` · reviewed ${new Date(row.reviewed_at).toLocaleDateString()}` : ""}
            {row.archived_at ? ` · archived ${new Date(row.archived_at).toLocaleDateString()}` : ""}
          </SheetDescription>
        </SheetHeader>

        <div className="mt-6 space-y-6 text-sm">
          <section>
            <h3 className="font-semibold mb-2">Root cause</h3>
            <Textarea
              value={rootCause}
              onChange={(e) => setRootCause(e.target.value)}
              placeholder="(AI returned no root cause — write one)"
              rows={4}
            />
          </section>

          {row.contributing_factors.length > 0 && (
            <section>
              <h3 className="font-semibold mb-2">Contributing factors</h3>
              <ul className="list-disc pl-5 space-y-1 text-muted-foreground">
                {row.contributing_factors.map((f, i) => <li key={i}>{f}</li>)}
              </ul>
            </section>
          )}

          {row.timeline.length > 0 && (
            <section>
              <h3 className="font-semibold mb-2">Timeline</h3>
              <ol className="space-y-1 text-muted-foreground">
                {row.timeline.map((t, i) => (
                  <li key={i}>
                    <span className="font-mono text-xs mr-2">{t.at}</span>
                    {t.what}
                  </li>
                ))}
              </ol>
            </section>
          )}

          {row.evidence && row.evidence.length > 0 && (
            <section>
              <h3 className="font-semibold mb-2">Evidence ({row.evidence.length})</h3>
              <p className="text-xs text-muted-foreground mb-2">
                Raw events the AI was shown when drafting this postmortem — use to verify the
                root cause and contributing factors.
              </p>
              <ol className="space-y-1.5">
                {row.evidence.map((e, i) => (
                  <li key={i} className="text-xs border-l-2 border-border pl-3">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-mono text-[10px] text-muted-foreground">
                        {new Date(e.at).toLocaleString()}
                      </span>
                      <Badge variant="outline" className="text-[10px]">{e.kind.replace(/_/g, " ")}</Badge>
                    </div>
                    <div className="text-foreground/90 mt-0.5">{e.summary}</div>
                  </li>
                ))}
              </ol>
            </section>
          )}

          <section>
            <h3 className="font-semibold mb-2">What changed</h3>
            <Textarea
              value={whatChanged}
              onChange={(e) => setWhatChanged(e.target.value)}
              placeholder="(AI returned no remediation summary — write one)"
              rows={4}
            />
          </section>

          {dirty && (
            <div className="flex justify-end">
              <Button size="sm" onClick={save} disabled={saving}>
                <Save className="h-3.5 w-3.5 mr-1" /> Save edits
              </Button>
            </div>
          )}

          <Separator />

          <section>
            <button
              type="button"
              onClick={() => setShowEvents((v) => !v)}
              className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
            >
              <History className="h-3.5 w-3.5" />
              Audit trail ({events.length}) {showEvents ? "▾" : "▸"}
            </button>
            {showEvents && (
              <ul className="mt-3 space-y-2">
                {events.length === 0 && (
                  <li className="text-xs text-muted-foreground">No events yet.</li>
                )}
                {events.map((e) => (
                  <li key={e.id} className="text-xs border-l-2 border-border pl-3">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-mono text-muted-foreground">
                        {new Date(e.created_at).toLocaleString()}
                      </span>
                      <Badge variant="outline" className="text-[10px]">{e.action}</Badge>
                      <span>{fmtField(e.field)}</span>
                      {e.actor && (
                        <span className="text-muted-foreground font-mono">
                          · {e.actor.slice(0, 8)}
                        </span>
                      )}
                    </div>
                    {(e.before_value || e.after_value) && (
                      <div className="mt-1 text-muted-foreground">
                        {e.before_value && (
                          <div><span className="line-through">{truncate(e.before_value)}</span></div>
                        )}
                        {e.after_value && (
                          <div>→ {truncate(e.after_value)}</div>
                        )}
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </section>

          <Separator />

          <div className="flex items-center justify-between gap-2">
            <a href={subjectHref} className="text-xs underline text-muted-foreground">
              View {row.subject_kind} →
            </a>
            <div className="flex gap-2">
              {row.status !== "draft" && (
                <Button size="sm" variant="ghost" onClick={() => setStatus("draft")} disabled={saving}>
                  <RotateCcw className="h-3.5 w-3.5 mr-1" /> Reopen
                </Button>
              )}
              {row.status === "draft" && (
                <Button size="sm" onClick={() => setStatus("reviewed")} disabled={saving}>
                  <CheckCircle className="h-3.5 w-3.5 mr-1" /> Mark reviewed
                </Button>
              )}
              {row.status !== "archived" && (
                <Button size="sm" variant="outline" onClick={() => setStatus("archived")} disabled={saving}>
                  <Archive className="h-3.5 w-3.5 mr-1" /> Archive
                </Button>
              )}
            </div>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
