import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ChevronDown, ChevronRight, History, Sparkles, MessagesSquare } from "lucide-react";

/**
 * Reusable timestamped history of past Copilot/Lovable-chat discussions
 * for any subject (subject_type + subject_id).
 *
 * Backed by `roadmap_finding_discussions` + `roadmap_finding_discussion_messages`
 * — the tables are now generic; the names are kept for backward compatibility.
 */

type Discussion = {
  id: string;
  mode: string;
  title: string | null;
  created_at: string;
  ended_at: string | null;
};

type Msg = {
  id: string;
  role: string;
  source: string;
  body: string;
  model: string | null;
  created_at: string;
};

type Props = {
  subjectType: string;
  subjectId: string;
  /** Hide the discussion currently being viewed, if any. */
  excludeDiscussionId?: string | null;
  className?: string;
};

export function DiscussionHistory({ subjectType, subjectId, excludeDiscussionId, className }: Props) {
  const [discussions, setDiscussions] = useState<Discussion[]>([]);
  const [openIds, setOpenIds] = useState<Set<string>>(new Set());
  const [msgsById, setMsgsById] = useState<Record<string, Msg[]>>({});
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      const { data } = await supabase
        .from("roadmap_finding_discussions")
        .select("id,mode,title,created_at,ended_at")
        .eq("subject_type", subjectType)
        .eq("subject_id", subjectId)
        .order("created_at", { ascending: false });
      if (cancelled) return;
      setDiscussions((data ?? []) as Discussion[]);
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [subjectType, subjectId]);

  const visible = discussions.filter((d) => d.id !== excludeDiscussionId);
  if (loading || visible.length === 0) return null;

  const loadMsgs = async (id: string) => {
    if (msgsById[id]) return;
    const { data } = await supabase
      .from("roadmap_finding_discussion_messages")
      .select("id,role,source,body,model,created_at")
      .eq("discussion_id", id)
      .order("created_at", { ascending: true });
    setMsgsById((prev) => ({ ...prev, [id]: (data ?? []) as Msg[] }));
  };

  const toggle = async (id: string) => {
    const next = new Set(openIds);
    if (next.has(id)) next.delete(id);
    else { next.add(id); await loadMsgs(id); }
    setOpenIds(next);
  };

  return (
    <div className={`rounded-md border bg-muted/20 ${className ?? ""}`}>
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="w-full flex items-center justify-between px-3 py-2 text-xs font-medium hover:bg-muted/40 rounded-md"
      >
        <span className="flex items-center gap-2">
          <History className="h-3.5 w-3.5" />
          Previous discussions
          <Badge variant="secondary" className="text-[10px]">{visible.length}</Badge>
        </span>
        {expanded ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
      </button>
      {expanded && (
        <div className="px-2 pb-2 space-y-1">
          {visible.map((d) => {
            const open = openIds.has(d.id);
            const msgs = msgsById[d.id] ?? [];
            return (
              <div key={d.id} className="rounded border bg-background">
                <button
                  type="button"
                  onClick={() => toggle(d.id)}
                  className="w-full flex items-center gap-2 px-2 py-1.5 text-xs text-left hover:bg-muted/40"
                >
                  {open ? <ChevronDown className="h-3 w-3 shrink-0" /> : <ChevronRight className="h-3 w-3 shrink-0" />}
                  {d.mode === "copilot"
                    ? <Sparkles className="h-3 w-3 shrink-0" />
                    : <MessagesSquare className="h-3 w-3 shrink-0" />}
                  <span className="text-muted-foreground tabular-nums">
                    {new Date(d.created_at).toLocaleString()}
                  </span>
                  <Badge variant="outline" className="text-[9px]">{d.mode}</Badge>
                  {d.ended_at && <Badge variant="secondary" className="text-[9px]">ended</Badge>}
                  {d.title && <span className="truncate ml-1">{d.title}</span>}
                </button>
                {open && (
                  <div className="border-t px-2 py-2 space-y-1.5 max-h-72 overflow-y-auto">
                    {msgs.length === 0 && (
                      <p className="text-[11px] text-muted-foreground italic">No messages.</p>
                    )}
                    {msgs.map((m) => (
                      <div
                        key={m.id}
                        className={`rounded px-2 py-1 text-xs ${
                          m.role === "copilot" ? "bg-muted/50"
                          : m.role === "system" ? "bg-accent/30 italic"
                          : "bg-background border"
                        }`}
                      >
                        <div className="flex items-center gap-1.5 mb-0.5">
                          <Badge variant="outline" className="text-[9px] uppercase">{m.role}</Badge>
                          <Badge variant="outline" className="text-[9px]">{m.source}</Badge>
                          <span className="text-[10px] text-muted-foreground tabular-nums">
                            {new Date(m.created_at).toLocaleString()}
                          </span>
                        </div>
                        <div className="whitespace-pre-wrap">{m.body}</div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
