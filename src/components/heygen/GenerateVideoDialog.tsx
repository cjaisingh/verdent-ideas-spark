import { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";

type Kind = "quarterly_recap" | "external_pitch";

const DEFAULT_PITCH =
  "AWIP Core is the operator console and capability registry behind every AWIP module. " +
  "It's substrate, not a brain. Core records OKRs, tracks each module's capability manifest, " +
  "and emits an event for every change. It doesn't decide who acts when. " +
  "That keeps modules decoupled and lets each one ship at its own pace, " +
  "while operators get a single source of truth for objectives, capabilities, and audit trails. " +
  "If you're building autonomous workflows, AWIP Core gives you the ground floor: " +
  "contract API, idempotent writes, role-gated access, and an event log you can replay. " +
  "Modules plug in. Operators stay in control.";

export function GenerateVideoDialog({
  open, onOpenChange, kind, onCreated,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  kind: Kind;
  onCreated?: () => void;
}) {
  const [title, setTitle] = useState("");
  const [script, setScript] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!open) return;
    if (kind === "external_pitch") {
      setTitle("AWIP external pitch");
      setScript(DEFAULT_PITCH);
    } else {
      setTitle("Quarterly recap");
      setScript(""); // server-side synthesises from latest quarterly action
    }
  }, [open, kind]);

  const submit = async () => {
    setSubmitting(true);
    try {
      const { data, error } = await supabase.functions.invoke("heygen-create-video", {
        body: { kind, title: title.trim(), script: script.trim() || undefined },
      });
      if (error) throw error;
      if ((data as any)?.error) throw new Error((data as any).error);
      toast.success("Video queued — HeyGen is rendering. Refresh in ~1–2 min.");
      onCreated?.();
      onOpenChange(false);
    } catch (e: any) {
      const msg = e?.message ?? String(e);
      if (msg.includes("monthly_quota_reached")) {
        toast.error("Monthly quota reached (3/3). Free plan resets next month.");
      } else {
        toast.error(`Failed: ${msg}`);
      }
    } finally {
      setSubmitting(false);
    }
  };

  const wordCount = script.trim().split(/\s+/).filter(Boolean).length;
  const estSeconds = Math.round((wordCount / 150) * 60);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>
            Generate {kind === "quarterly_recap" ? "quarterly recap" : "external pitch"}
          </DialogTitle>
          <DialogDescription>
            HeyGen stock avatar (Madison) + stock voice. Aim for ≤60 seconds (~150 words).
            {kind === "quarterly_recap" && !script && " Leave script empty to auto-synthesise from the latest quarterly review action."}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div>
            <Label htmlFor="title">Title</Label>
            <Input id="title" value={title} onChange={(e) => setTitle(e.target.value)} />
          </div>
          <div>
            <Label htmlFor="script">
              Script {script && <span className="text-xs text-muted-foreground">(~{estSeconds}s, {wordCount} words)</span>}
            </Label>
            <Textarea
              id="script"
              value={script}
              onChange={(e) => setScript(e.target.value)}
              rows={10}
              placeholder={kind === "quarterly_recap" ? "Leave empty to auto-generate from latest quarterly action…" : ""}
            />
            {estSeconds > 65 && (
              <p className="text-xs text-destructive mt-1">
                Estimated &gt;60s — HeyGen free plan caps at 60s. Trim before submitting.
              </p>
            )}
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>Cancel</Button>
          <Button onClick={submit} disabled={submitting}>
            {submitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Generate (uses 1 credit)
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
