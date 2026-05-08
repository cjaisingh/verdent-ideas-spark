import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";

interface ActionRow {
  id: string;
  short_num: number;
  title: string;
  status: string;
  priority: string;
  owner: string | null;
  due_at: string | null;
  source: string;
  created_at: string;
}

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const s = Math.floor(diff / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
}

const PRIORITY_COLOR: Record<string, string> = {
  low: "bg-muted text-muted-foreground",
  med: "bg-tint-discussion/15 text-tint-discussion",
  high: "bg-tint-approval/15 text-tint-approval",
  critical: "bg-tint-risk/15 text-tint-risk",
};

export function DiscussionActionsBody() {
  const [rows, setRows] = useState<ActionRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;

    const load = async () => {
      const { data } = await supabase
        .from("discussion_actions")
        .select("id, short_num, title, status, priority, owner, due_at, source, created_at")
        .in("status", ["open", "in_progress"])
        .order("created_at", { ascending: false })
        .limit(30);
      if (!active) return;
      setRows((data as ActionRow[]) ?? []);
      setLoading(false);
    };

    load();

    const channel = supabase
      .channel("pane-discussion-actions")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "discussion_actions" },
        () => load(),
      )
      .subscribe();

    return () => {
      active = false;
      supabase.removeChannel(channel);
    };
  }, []);

  if (loading) return <div className="p-3 text-xs text-muted-foreground">Loading…</div>;
  if (rows.length === 0)
    return (
      <div className="h-full overflow-y-auto p-3 text-xs text-muted-foreground">
        No open discussion actions.
      </div>
    );

  return (
    <div className="h-full overflow-y-auto">
      <ul className="divide-y divide-border">
        {rows.map((r) => (
          <li key={r.id}>
            <Link
              to={`/jobs?action=${r.id}`}
              className="block px-3 py-2 text-xs hover:bg-muted/50 transition-colors"
            >
              <div className="flex items-center gap-2 mb-1">
                <span
                  className={cn(
                    "inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium",
                    PRIORITY_COLOR[r.priority] ?? PRIORITY_COLOR.med,
                  )}
                >
                  {r.priority}
                </span>
                <span className="text-muted-foreground">#{r.short_num}</span>
                {r.status === "in_progress" && (
                  <span className="text-[10px] text-tint-discussion">in progress</span>
                )}
                <span className="ml-auto text-muted-foreground">{timeAgo(r.created_at)}</span>
              </div>
              <p className="text-foreground/90 line-clamp-2">{r.title}</p>
              {(r.owner || r.due_at) && (
                <p className="mt-0.5 text-[10px] text-muted-foreground">
                  {r.owner && <span>{r.owner}</span>}
                  {r.owner && r.due_at && <span> · </span>}
                  {r.due_at && <span>due {new Date(r.due_at).toLocaleDateString()}</span>}
                </p>
              )}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
