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
          {(() => {
            const payload = (row.intent_payload ?? {}) as Record<string, unknown>;
            const policy = payload._policy as
              | {
                  matched: boolean;
                  activity: string;
                  rule_default_action: string | null;
                  rule_conditions: unknown;
                  rule_notes: string | null;
                  risk: string;
                  decision: string;
                  reason: string;
                  evaluated_at: string;
                }
              | undefined;
            const summary = payload._summary as string | undefined;
            const sourceText = payload._source_text as string | undefined;
            const cleanPayload = Object.fromEntries(
              Object.entries(payload).filter(([k]) => !k.startsWith("_")),
            );
            const decisionColor =
              policy?.decision === "approve"
                ? "border-emerald-500/40 text-emerald-500"
                : policy?.decision === "reject"
                  ? "border-destructive/40 text-destructive"
                  : "border-amber-500/40 text-amber-500";

            return (
              <>
                {summary && (
                  <div>
                    <div className="text-xs text-muted-foreground mb-1">Summary</div>
                    <div className="text-sm">{summary}</div>
                  </div>
                )}
                {sourceText && (
                  <div>
                    <div className="text-xs text-muted-foreground mb-1">Source message</div>
                    <div className="text-sm font-mono bg-muted/30 rounded p-2 whitespace-pre-wrap">
                      {sourceText}
                    </div>
                  </div>
                )}
                {policy && (
                  <div className="border border-border rounded-md p-3 space-y-2 bg-muted/20">
                    <div className="flex items-center justify-between gap-2">
                      <div className="text-sm font-medium">Policy preview</div>
                      <Badge variant="outline" className={decisionColor}>
                        {policy.decision}
                      </Badge>
                    </div>
                    <div className="text-xs text-muted-foreground">{policy.reason}</div>
                    <dl className="grid grid-cols-2 gap-2 text-xs">
                      <div>
                        <dt className="text-muted-foreground">Rule matched</dt>
                        <dd className="font-mono">
                          {policy.matched ? `activity_policies(${policy.activity})` : "— (fallback)"}
                        </dd>
                      </div>
                      <div>
                        <dt className="text-muted-foreground">Default action</dt>
                        <dd className="font-mono">{policy.rule_default_action ?? "—"}</dd>
                      </div>
                      <div>
                        <dt className="text-muted-foreground">Risk</dt>
                        <dd className="font-mono">{policy.risk}</dd>
                      </div>
                      <div>
                        <dt className="text-muted-foreground">Evaluated at</dt>
                        <dd className="font-mono">
                          {new Date(policy.evaluated_at).toLocaleString()}
                        </dd>
                      </div>
                    </dl>
                    {policy.rule_notes && (
                      <div className="text-xs">
                        <span className="text-muted-foreground">Notes: </span>
                        {policy.rule_notes}
                      </div>
                    )}
                    {policy.rule_conditions != null &&
                      Array.isArray(policy.rule_conditions) &&
                      policy.rule_conditions.length > 0 && (
                        <div>
                          <div className="text-xs text-muted-foreground mb-1">Conditions</div>
                          <pre className="text-[11px] font-mono bg-background/60 rounded p-2 overflow-auto max-h-40">
{JSON.stringify(policy.rule_conditions, null, 2)}
                          </pre>
                        </div>
                      )}
                  </div>
                )}
                <div>
                  <div className="text-xs text-muted-foreground mb-1">Intent payload</div>
                  <pre className="text-[11px] font-mono bg-muted/30 rounded p-2 overflow-auto max-h-60">
{JSON.stringify(cleanPayload, null, 2)}
                  </pre>
                </div>
              </>
            );
          })()}
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
