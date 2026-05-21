import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Moon } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";
import { toast } from "@/hooks/use-toast";
import {
  RISK_DOT_CLASS,
  RISK_RUBRIC,
  isJobRisk,
  nightAllowedFor,
  nightBlockedReason,
  type JobRisk,
} from "@/lib/jobRisk";

interface ActionRow {
  id: string;
  short_num: number;
  title: string;
  status: string;
  priority: string;
  risk: string;
  owner: string | null;
  due_at: string | null;
  source: string;
  source_ref: string | null;
  created_at: string;
  night_eligible: boolean | null;
  night_override_reason: string | null;
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
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    let active = true;

    const load = async () => {
      const { data } = await supabase
        .from("discussion_actions")
        .select(
          "id, short_num, title, status, priority, risk, owner, due_at, source, source_ref, created_at, night_eligible, night_override_reason",
        )
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

  const toggleNight = async (row: ActionRow) => {
    const risk: JobRisk = isJobRisk(row.risk) ? row.risk : "med";
    const blocked = nightBlockedReason(risk, row.night_override_reason);
    if (blocked && !row.night_eligible) {
      toast({ title: "Blocked by risk", description: blocked, variant: "destructive" });
      return;
    }
    const next = !row.night_eligible;
    setBusy(row.id);
    setRows((prev) => prev.map((r) => (r.id === row.id ? { ...r, night_eligible: next } : r)));
    const { error } = await supabase
      .from("discussion_actions")
      .update({ night_eligible: next })
      .eq("id", row.id);
    setBusy(null);
    if (error) {
      setRows((prev) => prev.map((r) => (r.id === row.id ? { ...r, night_eligible: !next } : r)));
      toast({
        title: "Could not update night-shift status",
        description: error.message,
        variant: "destructive",
      });
    } else {
      toast({
        title: next ? `#${row.short_num} added to night shift` : `#${row.short_num} removed from night shift`,
      });
    }
  };

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
        {rows.map((r) => {
          const risk: JobRisk = isJobRisk(r.risk) ? r.risk : "med";
          const allowed = nightAllowedFor(risk, r.night_override_reason);
          const blocked = nightBlockedReason(risk, r.night_override_reason);
          const moonOn = !!r.night_eligible;
          return (
            <li key={r.id} className="relative group">
              <Link
                to={`/jobs?action=${r.id}`}
                className="block px-3 py-2 pr-10 text-xs hover:bg-muted/50 transition-colors"
              >
                <div className="flex items-center gap-2 mb-1">
                  <span
                    className={cn("h-1.5 w-1.5 rounded-full shrink-0", RISK_DOT_CLASS[risk])}
                    title={`Risk: ${risk} — ${RISK_RUBRIC[risk]}`}
                  />
                  <span
                    className={cn(
                      "inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium",
                      PRIORITY_COLOR[r.priority] ?? PRIORITY_COLOR.med,
                    )}
                  >
                    {r.priority}
                  </span>
                  <span className="text-muted-foreground">#{r.short_num}</span>
                  {r.source === "plan_footer" && (
                    <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] border border-amber-500/40 text-amber-600" title={r.source_ref ?? undefined}>
                      from plan
                    </span>
                  )}
                  {r.source === "session_summary" && (
                    <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] border border-indigo-500/40 text-indigo-600" title={r.source_ref ?? undefined}>
                      from session
                    </span>
                  )}
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
              <button
                type="button"
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  if (busy !== r.id) toggleNight(r);
                }}
                disabled={busy === r.id || (!allowed && !moonOn)}
                aria-label={moonOn ? "Remove from night shift" : "Add to night shift"}
                title={
                  blocked && !moonOn
                    ? blocked
                    : moonOn
                      ? "On night shift — click to remove"
                      : "Off night shift — click to add"
                }
                className={cn(
                  "absolute top-1.5 right-1.5 inline-flex h-6 w-6 items-center justify-center rounded transition-colors",
                  moonOn
                    ? "bg-tint-night/20 text-tint-night hover:bg-tint-night/30"
                    : allowed
                      ? "text-muted-foreground/50 hover:text-foreground hover:bg-muted"
                      : "text-muted-foreground/20 cursor-not-allowed",
                  busy === r.id && "opacity-50",
                )}
              >
                <Moon className="h-3.5 w-3.5" />
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
