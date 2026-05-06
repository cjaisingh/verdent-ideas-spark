import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";

type Row = {
  id: string;
  activity: string;
  status: "approved" | "rejected" | "pending" | string;
  risk: string | null;
  decided_by: string | null;
  decided_at: string | null;
  created_at: string;
};

const ApprovalDecisions = () => {
  const [rows, setRows] = useState<Row[]>([]);
  const [flashIds, setFlashIds] = useState<Set<string>>(new Set());

  const load = async () => {
    const { data } = await supabase
      .from("approval_queue")
      .select("id, activity, status, risk, decided_by, decided_at, created_at")
      .in("status", ["approved", "rejected"])
      .order("decided_at", { ascending: false, nullsFirst: false })
      .limit(25);
    setRows((data ?? []) as Row[]);
  };

  useEffect(() => {
    load();
    const channel = supabase
      .channel("approval_queue_history")
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "approval_queue" },
        (payload) => {
          const next = payload.new as Row;
          const prev = payload.old as { status: string };
          if (prev?.status === next.status) return;
          if (next.status !== "approved" && next.status !== "rejected") return;
          setRows((curr) => {
            const without = curr.filter((r) => r.id !== next.id);
            return [next, ...without].slice(0, 25);
          });
          setFlashIds((s) => new Set(s).add(next.id));
          setTimeout(() => {
            setFlashIds((s) => {
              const n = new Set(s);
              n.delete(next.id);
              return n;
            });
          }, 2000);
        },
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  return (
    <div className="border border-border rounded-md">
      <div className="flex items-center justify-between px-4 py-2 bg-muted/30">
        <div>
          <div className="text-sm font-medium">Decision history</div>
          <div className="text-xs text-muted-foreground">
            Live updates as operators tap ✅ / ❌ in Telegram
          </div>
        </div>
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span className="inline-block h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
          Realtime
        </div>
      </div>
      <div className="divide-y divide-border max-h-[40vh] overflow-auto">
        {rows.length === 0 && (
          <div className="p-6 text-sm text-muted-foreground">No decisions yet.</div>
        )}
        {rows.map((r) => {
          const fresh = flashIds.has(r.id);
          const approved = r.status === "approved";
          return (
            <div
              key={r.id}
              className={`flex items-center gap-3 px-4 py-2 text-sm transition-colors ${
                fresh ? "bg-primary/10" : ""
              }`}
            >
              <Badge
                variant="outline"
                className={
                  approved
                    ? "border-emerald-500/40 text-emerald-500"
                    : "border-destructive/40 text-destructive"
                }
              >
                {approved ? "approved" : "rejected"}
              </Badge>
              <span className="font-medium truncate">{r.activity}</span>
              {r.risk && (
                <span className="text-xs text-muted-foreground font-mono">risk:{r.risk}</span>
              )}
              <span className="ml-auto text-xs text-muted-foreground font-mono truncate max-w-[40%]">
                {r.decided_by ?? "—"}
              </span>
              <span className="text-xs text-muted-foreground tabular-nums shrink-0">
                {r.decided_at ? new Date(r.decided_at).toLocaleTimeString() : "—"}
              </span>
              <span className="text-[10px] text-muted-foreground font-mono shrink-0">
                {r.id.slice(0, 8)}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default ApprovalDecisions;
