import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { supabase } from "@/integrations/supabase/client";
import { useState } from "react";
import { toast } from "sonner";

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
};

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
  if (!row) return null;

  const markReviewed = async () => {
    setSaving(true);
    const { error } = await supabase
      .from("postmortems")
      .update({ status: "reviewed", reviewed_at: new Date().toISOString() })
      .eq("id", row.id);
    setSaving(false);
    if (error) { toast.error(error.message); return; }
    toast.success("Marked reviewed");
    onChanged();
    onOpenChange(false);
  };

  const subjectHref = row.subject_kind === "phase" ? "/master-plan" : "/roadmap";

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-2xl overflow-y-auto">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            <Badge variant="outline">{row.subject_kind}</Badge>
            {row.subject_label}
          </SheetTitle>
          <SheetDescription>
            Slipped on {row.slipped_on} · {row.days_late} day{row.days_late === 1 ? "" : "s"} late ·
            status {row.status}{row.model ? ` · ${row.model}` : ""}
          </SheetDescription>
        </SheetHeader>

        <div className="mt-6 space-y-6 text-sm">
          <section>
            <h3 className="font-semibold mb-2">Root cause</h3>
            <p className="whitespace-pre-wrap text-muted-foreground">
              {row.root_cause ?? "— (AI returned no root cause)"}
            </p>
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

          <section>
            <h3 className="font-semibold mb-2">What changed</h3>
            <p className="whitespace-pre-wrap text-muted-foreground">
              {row.what_changed ?? "— (AI returned no remediation summary)"}
            </p>
          </section>

          <Separator />

          <div className="flex items-center justify-between gap-2">
            <a href={subjectHref} className="text-xs underline text-muted-foreground">
              View {row.subject_kind} →
            </a>
            <div className="flex gap-2">
              {row.status === "draft" && (
                <Button size="sm" onClick={markReviewed} disabled={saving}>
                  Mark reviewed
                </Button>
              )}
            </div>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
