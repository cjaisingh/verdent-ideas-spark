import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { ChevronDown, CheckCircle2, ShieldCheck } from "lucide-react";
import { format } from "date-fns";
import { OvernightRunControl } from "./OvernightRunControl";

interface SignoffRow {
  id: string;
  phase_id: string;
  phase_key: string;
  approval_id: string | null;
  approver: string | null;
  approver_user_id: string | null;
  decided_at: string;
  gate_snapshot: Record<string, unknown>;
  notes: string | null;
}

interface Props {
  phaseId?: string; // optional: filter to a single phase
  limit?: number;
}

export function PhaseSignoffAudit({ phaseId, limit = 20 }: Props) {
  const [rows, setRows] = useState<SignoffRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    const load = async () => {
      let q = supabase
        .from("roadmap_phase_signoffs")
        .select("*")
        .order("decided_at", { ascending: false })
        .limit(limit);
      if (phaseId) q = q.eq("phase_id", phaseId);
      const { data } = await q;
      if (!active) return;
      setRows((data ?? []) as SignoffRow[]);
      setLoading(false);
    };
    load();
    const ch = supabase
      .channel(`phase-signoffs-${phaseId ?? "all"}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "roadmap_phase_signoffs" }, load)
      .subscribe();
    return () => {
      active = false;
      supabase.removeChannel(ch);
    };
  }, [phaseId, limit]);

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <ShieldCheck className="h-4 w-4 text-primary" />
          Phase sign-off audit trail
          <Badge variant="outline" className="ml-auto font-mono text-xs">{rows.length}</Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {loading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">No phase sign-offs recorded yet.</p>
        ) : (
          rows.map((r) => <SignoffRowItem key={r.id} row={r} />)
        )}
      </CardContent>
    </Card>
  );
}

function SignoffRowItem({ row }: { row: SignoffRow }) {
  const snap = row.gate_snapshot as Record<string, unknown>;
  const allOk = snap?.all_ok === true;
  const blockers = (snap?.blockers ?? {}) as Record<string, number>;
  const blockerCount = Object.values(blockers).reduce((a, b) => a + (b ?? 0), 0);

  return (
    <Collapsible className="rounded-md border bg-card/50">
      <CollapsibleTrigger className="flex w-full items-center gap-3 px-3 py-2 text-left hover:bg-accent/30">
        <CheckCircle2 className="h-4 w-4 shrink-0 text-green-500" />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="font-mono text-xs font-semibold">{row.phase_key}</span>
            <span className="text-sm">signed off by</span>
            <span className="text-sm font-medium">{row.approver ?? "system"}</span>
          </div>
          <div className="text-xs text-muted-foreground">
            {format(new Date(row.decided_at), "PPp")}
          </div>
        </div>
        <Badge variant={allOk ? "secondary" : "destructive"} className="font-mono text-[10px]">
          {allOk ? "all gates ✓" : `${blockerCount} blocker${blockerCount === 1 ? "" : "s"}`}
        </Badge>
        <div onClick={(e) => e.stopPropagation()}>
          <OvernightRunControl phaseId={row.phase_id} phaseKey={row.phase_key} />
        </div>
        <ChevronDown className="h-4 w-4 text-muted-foreground transition-transform [[data-state=open]>&]:rotate-180" />
      </CollapsibleTrigger>
      <CollapsibleContent className="border-t bg-muted/30 px-3 py-2">
        <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
          <GateDt label="Structural" v={snap.structural_ok} extra={`${snap.open_tasks ?? 0} open`} />
          <GateDt label="QA" v={snap.qa_ok} extra={`${snap.qa_pass ?? 0}/${snap.qa_total ?? 0} pass`} />
          <GateDt label="Night audits" v={snap.night_ok} extra={`${snap.night_high_open ?? 0} high open`} />
          <GateDt label="Approvals" v={snap.approvals_ok} extra={`${snap.pending_signoffs ?? 0} pending`} />
        </dl>
        <div className="mt-2 flex flex-wrap gap-3 text-[11px] text-muted-foreground">
          {row.approval_id && (
            <span className="font-mono">approval: {row.approval_id.slice(0, 8)}</span>
          )}
          <span className="font-mono">audit: {row.id.slice(0, 8)}</span>
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}

function GateDt({ label, v, extra }: { label: string; v: unknown; extra: string }) {
  const ok = v === true;
  return (
    <>
      <dt className="text-muted-foreground">{label}</dt>
      <dd className={ok ? "text-green-600" : "text-amber-600"}>
        {ok ? "✓" : "⚠"} <span className="text-muted-foreground">({extra})</span>
      </dd>
    </>
  );
}
