import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";

interface Observation {
  id: string;
  kind: string;
  severity: string;
  summary: string;
  subject_ref: Record<string, unknown> | null;
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

const SEV_COLOR: Record<string, string> = {
  info: "bg-muted text-muted-foreground",
  low: "bg-tint-discussion/15 text-tint-discussion",
  med: "bg-tint-approval/15 text-tint-approval",
  high: "bg-tint-risk/15 text-tint-risk",
  critical: "bg-tint-risk/25 text-tint-risk",
};

export function NightAgentBody() {
  const [rows, setRows] = useState<Observation[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    (async () => {
      const { data } = await supabase
        .from("night_observations")
        .select("id, kind, severity, summary, subject_ref, created_at")
        .order("created_at", { ascending: false })
        .limit(30);
      if (!active) return;
      setRows((data as Observation[]) ?? []);
      setLoading(false);
    })();

    const channel = supabase
      .channel("pane-night-observations")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "night_observations" },
        (payload) => {
          const row = payload.new as Observation;
          setRows((prev) => [row, ...prev].slice(0, 30));
        },
      )
      .subscribe();

    return () => {
      active = false;
      supabase.removeChannel(channel);
    };
  }, []);

  const content = useMemo(() => {
    if (loading) return <div className="p-3 text-xs text-muted-foreground">Loading…</div>;
    if (rows.length === 0)
      return <div className="p-3 text-xs text-muted-foreground">No observations yet.</div>;
    return (
      <ul className="divide-y divide-border">
        {rows.map((r) => (
          <li key={r.id}>
            <Link to="/night" className="block px-3 py-2 text-xs hover:bg-muted/50 transition-colors">
              <div className="flex items-center gap-2 mb-1">
                <span
                  className={cn(
                    "inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium",
                    SEV_COLOR[r.severity] ?? SEV_COLOR.info,
                  )}
                >
                  {r.severity}
                </span>
                <span className="text-muted-foreground">{r.kind}</span>
                <span className="ml-auto text-muted-foreground">{timeAgo(r.created_at)}</span>
              </div>
              <p className="text-foreground/90 line-clamp-2">{r.summary}</p>
            </Link>
          </li>
        ))}
      </ul>
    );
  }, [rows, loading]);

  return <div className="h-full overflow-y-auto">{content}</div>;
}
