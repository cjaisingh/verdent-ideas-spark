import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";

interface ApprovalRow {
  id: string;
  activity: string;
  risk: string;
  status: string;
  requesting_module: string | null;
  capability_id: string | null;
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

const RISK_COLOR: Record<string, string> = {
  safe: "bg-tint-capability/15 text-tint-capability",
  risky: "bg-tint-approval/15 text-tint-approval",
  blocker: "bg-tint-risk/15 text-tint-risk",
  unknown: "bg-muted text-muted-foreground",
};

export function ApprovalsBody() {
  const [rows, setRows] = useState<ApprovalRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;

    const load = async () => {
      const { data } = await supabase
        .from("approval_queue")
        .select("id, activity, risk, status, requesting_module, capability_id, created_at")
        .eq("status", "pending")
        .order("created_at", { ascending: false })
        .limit(30);
      if (!active) return;
      setRows((data as ApprovalRow[]) ?? []);
      setLoading(false);
    };

    load();

    const channel = supabase
      .channel("pane-approvals")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "approval_queue" },
        () => {
          // Cheapest correct path: refetch on any change. Volume is low.
          load();
        },
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
        Nothing pending. Quiet shift.
      </div>
    );

  return (
    <div className="h-full overflow-y-auto">
      <ul className="divide-y divide-border">
        {rows.map((r) => (
          <li key={r.id}>
            <Link
              to={`/approvals/${r.id}`}
              className="block px-3 py-2 text-xs hover:bg-muted/50 transition-colors"
            >
              <div className="flex items-center gap-2 mb-1">
                <span
                  className={cn(
                    "inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium",
                    RISK_COLOR[r.risk] ?? RISK_COLOR.unknown,
                  )}
                >
                  {r.risk}
                </span>
                {r.requesting_module && (
                  <span className="text-muted-foreground">{r.requesting_module}</span>
                )}
                <span className="ml-auto text-muted-foreground">{timeAgo(r.created_at)}</span>
              </div>
              <p className="text-foreground/90 line-clamp-2">{r.activity}</p>
              {r.capability_id && (
                <p className="mt-0.5 text-[10px] text-muted-foreground">{r.capability_id}</p>
              )}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
