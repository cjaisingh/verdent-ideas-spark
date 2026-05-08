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

function isInNightWindow(now = new Date()): boolean {
  const h = now.getUTCHours();
  return h >= 22 || h < 6;
}

const SEV_COLOR: Record<string, string> = {
  info: "bg-muted text-muted-foreground",
  low: "bg-blue-500/15 text-blue-500",
  med: "bg-amber-500/15 text-amber-600",
  high: "bg-red-500/15 text-red-500",
  critical: "bg-red-600/20 text-red-600",
};

export function RightPaneNightAgent() {
  const [rows, setRows] = useState<Observation[]>([]);
  const [loading, setLoading] = useState(true);
  const [windowOpen, setWindowOpen] = useState(isInNightWindow());

  useEffect(() => {
    const t = setInterval(() => setWindowOpen(isInNightWindow()), 60_000);
    return () => clearInterval(t);
  }, []);

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
      .channel("right-pane-night-observations")
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
      return <div className="p-3 text-xs text-muted-foreground">No observations yet tonight.</div>;
    return (
      <ul className="divide-y divide-border">
        {rows.map((r) => (
          <li key={r.id}>
            <Link
              to="/night"
              className="block px-3 py-2 text-xs hover:bg-muted/50 transition-colors"
            >
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

  return (
    <aside className="h-full flex flex-col bg-background border-l border-border">
      <header className="h-9 px-3 flex items-center gap-2 border-b border-border shrink-0">
        <span
          className={cn(
            "h-2 w-2 rounded-full",
            windowOpen ? "bg-emerald-500" : "bg-muted-foreground/40",
          )}
          title={windowOpen ? "Night window open (22:00–06:00 UTC)" : "Outside night window"}
        />
        <h2 className="text-xs font-semibold">Night Agent</h2>
        <Link to="/night" className="ml-auto text-[10px] text-muted-foreground hover:text-foreground">
          Open →
        </Link>
      </header>
      <div className="flex-1 overflow-y-auto">{content}</div>
    </aside>
  );
}
