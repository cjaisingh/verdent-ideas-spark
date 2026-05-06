import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

type Approval = {
  id: string;
  activity: string;
  status: string;
  risk: string | null;
  intent_payload: unknown;
  result: unknown;
  requested_by: string | null;
  decided_by: string | null;
  decided_at: string | null;
  created_at: string;
  telegram_message_id: number | null;
};

const ApprovalDetail = () => {
  const { id } = useParams<{ id: string }>();
  const [row, setRow] = useState<Approval | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    let active = true;
    const load = async () => {
      const { data, error } = await supabase
        .from("approval_queue")
        .select("*")
        .eq("id", id)
        .maybeSingle();
      if (!active) return;
      if (error) setError(error.message);
      else setRow(data as Approval);
    };
    load();
    const channel = supabase
      .channel(`approval_detail_${id}`)
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "approval_queue", filter: `id=eq.${id}` },
        (payload) => setRow(payload.new as Approval),
      )
      .subscribe();
    return () => {
      active = false;
      supabase.removeChannel(channel);
    };
  }, [id]);

  const variant =
    row?.status === "approved"
      ? "border-emerald-500/40 text-emerald-500"
      : row?.status === "rejected"
        ? "border-destructive/40 text-destructive"
        : "border-muted-foreground/40 text-muted-foreground";

  return (
    <div className="space-y-6">
      <div className="flex items-end justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Approval</h1>
          <p className="text-xs text-muted-foreground font-mono">{id}</p>
        </div>
        <Button variant="outline" size="sm" asChild>
          <Link to="/control-plane">← Control plane</Link>
        </Button>
      </div>

      {error && (
        <div className="border border-destructive/50 text-destructive text-sm rounded-md p-3 font-mono">
          {error}
        </div>
      )}
      {!row && !error && <div className="text-sm text-muted-foreground">Loading…</div>}

      {row && (
        <div className="border border-border rounded-md p-4 space-y-4">
          <div className="flex items-center gap-3">
            <Badge variant="outline" className={variant}>
              {row.status}
            </Badge>
            <span className="text-sm font-medium">{row.activity}</span>
            {row.risk && (
              <span className="text-xs text-muted-foreground font-mono">risk:{row.risk}</span>
            )}
          </div>
          <dl className="grid grid-cols-2 gap-3 text-sm">
            <div>
              <dt className="text-xs text-muted-foreground">Requested by</dt>
              <dd className="font-mono">{row.requested_by ?? "—"}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Decided by</dt>
              <dd className="font-mono">{row.decided_by ?? "—"}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Created</dt>
              <dd className="font-mono">{new Date(row.created_at).toLocaleString()}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Decided at</dt>
              <dd className="font-mono">
                {row.decided_at ? new Date(row.decided_at).toLocaleString() : "—"}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Telegram message</dt>
              <dd className="font-mono">{row.telegram_message_id ?? "—"}</dd>
            </div>
          </dl>
          <div>
            <div className="text-xs text-muted-foreground mb-1">Intent payload</div>
            <pre className="text-[11px] font-mono bg-muted/30 rounded p-2 overflow-auto max-h-60">
{JSON.stringify(row.intent_payload, null, 2)}
            </pre>
          </div>
          {row.result != null && (
            <div>
              <div className="text-xs text-muted-foreground mb-1">Result</div>
              <pre className="text-[11px] font-mono bg-muted/30 rounded p-2 overflow-auto max-h-60">
{JSON.stringify(row.result, null, 2)}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default ApprovalDetail;
