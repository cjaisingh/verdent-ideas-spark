import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";

type Pending = {
  id: string;
  activity: string;
  risk: string | null;
  created_at: string;
};

const PendingApprovalsIndicator = () => {
  const [pending, setPending] = useState<Pending[]>([]);
  const [lastDecidedId, setLastDecidedId] = useState<string | null>(null);
  const [open, setOpen] = useState(false);

  const load = async () => {
    const { data } = await supabase
      .from("approval_queue")
      .select("id, activity, risk, created_at")
      .eq("status", "pending")
      .order("created_at", { ascending: false })
      .limit(20);
    setPending((data ?? []) as Pending[]);
  };

  useEffect(() => {
    load();
    const channel = supabase
      .channel("approval_queue_indicator")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "approval_queue" },
        (payload) => {
          const next = payload.new as Pending & { status?: string };
          const prev = payload.old as { status?: string } | null;

          if (payload.eventType === "INSERT" && next.status === "pending") {
            setPending((c) => [next, ...c.filter((r) => r.id !== next.id)].slice(0, 20));
          } else if (payload.eventType === "UPDATE") {
            if (next.status === "pending") {
              setPending((c) => [next, ...c.filter((r) => r.id !== next.id)].slice(0, 20));
            } else {
              // Status flipped away from pending (or row updated while non-pending).
              // payload.old usually only has the PK without REPLICA IDENTITY FULL,
              // so we can't trust prev?.status — drop by id and flash if it was in our list.
              setPending((c) => {
                const wasPending = c.some((r) => r.id === next.id);
                if (wasPending) {
                  setLastDecidedId(next.id);
                  setTimeout(() => {
                    setLastDecidedId((cur) => (cur === next.id ? null : cur));
                  }, 4000);
                }
                return c.filter((r) => r.id !== next.id);
              });
            }
          } else if (payload.eventType === "DELETE") {
            const old = payload.old as { id: string };
            setPending((c) => c.filter((r) => r.id !== old.id));
          }
        },
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  const count = pending.length;
  const dotColor =
    count === 0 ? "bg-muted-foreground" : count > 5 ? "bg-destructive" : "bg-amber-500";

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        className={`flex items-center gap-2 px-3 py-1.5 rounded-md text-sm border border-border hover:bg-muted/40 transition ${
          lastDecidedId ? "ring-2 ring-primary/60 animate-pulse" : ""
        }`}
        title="Pending approvals"
      >
        <span className={`inline-block h-2 w-2 rounded-full ${dotColor} ${count > 0 ? "animate-pulse" : ""}`} />
        <span>Approvals</span>
        <Badge variant={count > 0 ? "default" : "secondary"} className="tabular-nums">
          {count}
        </Badge>
      </button>

      {open && (
        <div className="absolute right-0 mt-2 w-96 z-50 border border-border rounded-md bg-popover text-popover-foreground shadow-lg">
          <div className="px-3 py-2 border-b border-border flex items-center justify-between">
            <div className="text-sm font-medium">Pending approvals</div>
            <span className="text-xs text-muted-foreground">{count} waiting</span>
          </div>
          <div className="max-h-80 overflow-auto divide-y divide-border">
            {count === 0 && (
              <div className="p-4 text-sm text-muted-foreground">All clear — no pending approvals.</div>
            )}
            {pending.map((p) => (
              <Link
                key={p.id}
                to={`/approvals/${p.id}`}
                onClick={() => setOpen(false)}
                className="flex items-center gap-2 px-3 py-2 text-sm hover:bg-muted/40 transition"
              >
                <Badge variant="outline" className="border-amber-500/40 text-amber-500 shrink-0">
                  pending
                </Badge>
                <span className="font-medium truncate">{p.activity}</span>
                {p.risk && (
                  <span className="text-xs text-muted-foreground font-mono shrink-0">risk:{p.risk}</span>
                )}
                <span className="ml-auto text-[10px] text-muted-foreground font-mono shrink-0">
                  {p.id.slice(0, 8)}
                </span>
              </Link>
            ))}
          </div>
          {lastDecidedId && (
            <Link
              to={`/approvals/${lastDecidedId}`}
              onClick={() => setOpen(false)}
              className="block px-3 py-2 border-t border-border bg-primary/10 text-xs hover:bg-primary/20 transition"
            >
              ✓ Just decided:{" "}
              <span className="font-mono">{lastDecidedId.slice(0, 8)}</span> — view
            </Link>
          )}
        </div>
      )}
    </div>
  );
};

export default PendingApprovalsIndicator;
