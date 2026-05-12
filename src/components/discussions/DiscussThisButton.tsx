import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { MessageCircle } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/use-toast";
import { jobHandle, subjectHandle } from "@/lib/discussionHandles";

type Props = {
  /** Free-form subject type — e.g. "discussion_action", "roadmap_finding", "morning_review_panel". */
  subjectType: string;
  /** Subject identifier (job id, finding id, panel slug). */
  subjectId: string;
  /** Headline shown in the seeded system message. */
  title: string;
  /** Optional details/body shown to the AI as context. */
  details?: string | null;
  /** Job short_num for handle rendering (e.g. J-12). Optional. */
  shortNum?: number | null;
  /** Subject short_num for handle rendering (e.g. F-3). Optional. */
  subjectShortNum?: number | null;
  /** Visual variant. "icon" = compact, "button" = labelled. */
  variant?: "icon" | "button";
  className?: string;
};

/**
 * One-click "Discuss this" — creates (or reuses) a Companion thread tagged
 * with the subject and navigates to /companion?thread=…&voice=1 so the mic
 * arms automatically. Reuses the existing Companion seed pattern.
 */
export function DiscussThisButton({
  subjectType,
  subjectId,
  title,
  details,
  shortNum,
  subjectShortNum,
  variant = "icon",
  className,
}: Props) {
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);

  const open = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        toast({ title: "Not signed in", variant: "destructive" });
        return;
      }

      const handle = shortNum != null ? jobHandle(shortNum) : null;
      const subjHandle = subjectShortNum != null ? subjectHandle(subjectType, subjectShortNum) : subjectType;
      const threadTitle = handle ? `${handle} · ${title}`.slice(0, 120) : title.slice(0, 120);

      // Look for an existing thread tagged with this exact subject so we don't
      // spawn duplicates if the operator clicks twice. Tag stored in the
      // thread title prefix `[subject:{type}:{id}]` — cheap and migration-free.
      const tag = `[subject:${subjectType}:${subjectId}]`;
      const taggedTitle = `${tag} ${threadTitle}`.slice(0, 200);

      const { data: existing } = await supabase
        .from("companion_threads")
        .select("id")
        .ilike("title", `%${tag}%`)
        .is("archived_at", null)
        .order("updated_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      let threadId = existing?.id as string | undefined;

      if (!threadId) {
        const { data: created, error } = await supabase
          .from("companion_threads")
          .insert({
            title: taggedTitle,
            agent_kind: "general",
            created_by: user.id,
          })
          .select("id")
          .single();
        if (error || !created) {
          toast({ title: "Couldn't open discussion", description: error?.message, variant: "destructive" });
          return;
        }
        threadId = created.id;

        const seed = [
          `Discussing ${handle ?? subjHandle}: ${title}`,
          "",
          details ? details : "_(no details captured)_",
          "",
          `Subject: \`${subjectType}\` · id: \`${subjectId}\``,
        ].join("\n");
        await supabase.from("companion_messages").insert({
          thread_id: threadId,
          role: "system",
          content: "Seed context:\n\n" + seed,
        });
      }

      navigate(`/companion?thread=${threadId}&voice=1`);
    } finally {
      setBusy(false);
    }
  };

  if (variant === "button") {
    return (
      <Button size="sm" variant="outline" onClick={open} disabled={busy} className={className}>
        <MessageCircle className="h-3.5 w-3.5 mr-1" />
        Discuss this
      </Button>
    );
  }
  return (
    <button
      type="button"
      onClick={(e) => { e.stopPropagation(); open(); }}
      disabled={busy}
      title="Discuss this in Companion (voice on)"
      className={`inline-flex items-center gap-0.5 hover:underline disabled:opacity-50 ${className ?? ""}`}
    >
      <MessageCircle className="h-3 w-3" />
    </button>
  );
}
