import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import {
  Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription,
} from "@/components/ui/sheet";
import { Badge } from "@/components/ui/badge";
import { Loader2, AlertTriangle } from "lucide-react";
import type { PromotionAuditReport } from "@/lib/promotion-audit-types";

const FN = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/awip-api`;

const sevTone = (s: string | null | undefined) =>
  s === "high" ? "bg-destructive/10 text-destructive border-destructive/30"
  : s === "medium" ? "bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-500/30"
  : s === "low" ? "bg-yellow-500/10 text-yellow-700 dark:text-yellow-500 border-yellow-500/30"
  : "bg-muted text-muted-foreground border-border";

const decisionTone = (d: string) =>
  d === "accepted" ? "text-emerald-600 dark:text-emerald-400"
  : d === "rejected" ? "text-destructive"
  : "text-muted-foreground";

type Props = {
  proposalId: string | null;
  onOpenChange: (open: boolean) => void;
};

export default function PromotionAuditDrawer({ proposalId, onOpenChange }: Props) {
  const [report, setReport] = useState<PromotionAuditReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!proposalId) { setReport(null); return; }
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const { data: sess } = await supabase.auth.getSession();
        const token = sess.session?.access_token;
        const r = await fetch(`${FN}/night-agent/promotion-audit?proposal_id=${encodeURIComponent(proposalId)}`, {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        });
        const j = await r.json();
        if (cancelled) return;
        if (!r.ok) setError(j.error ?? `HTTP ${r.status}`);
        else setReport(j as PromotionAuditReport);
      } catch (e) {
        if (!cancelled) setError((e as Error).message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [proposalId]);

  const targetShortNum = (report?.proposal.target_ref as any)?.short_num;

  return (
    <Sheet open={!!proposalId} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-2xl overflow-y-auto">
        <SheetHeader>
          <SheetTitle>Promotion audit report</SheetTitle>
          <SheetDescription>
            {report ? (
              <span className="font-mono text-xs">
                #{targetShortNum ?? "?"} · proposal {report.proposal.id.slice(0, 8)}
              </span>
            ) : "Loading…"}
          </SheetDescription>
        </SheetHeader>

        {loading && (
          <div className="flex items-center gap-2 py-12 justify-center text-muted-foreground text-sm">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading report…
          </div>
        )}
        {error && (
          <div className="border border-destructive/40 rounded-md p-3 text-sm text-destructive mt-4">
            {error}
          </div>
        )}

        {report && (
          <div className="space-y-6 mt-4">
            {/* Decision strip */}
            <div className="rounded-md border border-border bg-muted/20 p-3 text-sm">
              <div className="flex items-center justify-between">
                <span className="text-xs uppercase tracking-wide text-muted-foreground">Decision</span>
                <span className={`font-mono uppercase text-xs ${decisionTone(report.after.decision)}`}>
                  {report.after.decision}
                </span>
              </div>
              {report.after.decided_by && (
                <div className="text-xs text-muted-foreground mt-1 font-mono">
                  by {report.after.decided_by} · {report.after.decided_at ? new Date(report.after.decided_at).toLocaleString() : "—"}
                </div>
              )}
              {report.proposal.rationale && (
                <div className="text-xs text-foreground/80 mt-2 italic">{report.proposal.rationale}</div>
              )}
            </div>

            {/* Two-column: Before / After */}
            <div className="grid md:grid-cols-2 gap-4">
              <Section title="Before — open-time gates">
                {report.before.legacy && (
                  <div className="flex items-start gap-1.5 text-xs text-amber-600 dark:text-amber-400 mb-2">
                    <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                    Legacy shift — gate snapshot was not captured at open time.
                  </div>
                )}
                {report.before.gates ? (
                  <dl className="text-xs space-y-1 font-mono">
                    <Row k="timezone" v={report.before.gates.timezone} />
                    <Row k="window" v={report.before.gates.window} />
                    <Row k="local_time" v={`${report.before.gates.local_date ?? ""} ${report.before.gates.local_time ?? ""}`.trim()} />
                    <Row k="enabled" v={String(report.before.gates.enabled)} />
                    <Row k="in_window" v={String(report.before.gates.in_window)} />
                    <Row k="blackout_hit" v={String(report.before.gates.blackout_hit)} />
                    <Row k="allowed_kinds" v={(report.before.gates.allowed_kinds ?? []).join(", ") || "—"} />
                  </dl>
                ) : (
                  <div className="text-xs text-muted-foreground italic">No gate data.</div>
                )}
                {report.before.skip_reasons.length > 0 && (
                  <div className="mt-3">
                    <div className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1">Skip reasons</div>
                    <ul className="text-xs font-mono text-destructive list-disc pl-4">
                      {report.before.skip_reasons.map((r) => <li key={r}>{r}</li>)}
                    </ul>
                  </div>
                )}
              </Section>

              <Section title="After — operator outcome">
                {report.after.audit_complete ? (
                  <dl className="text-xs space-y-1 font-mono">
                    <Row k="worst_severity" v={
                      <span className={`px-1.5 py-0.5 rounded border text-[10px] ${sevTone(report.after.audit_complete.worst_severity)}`}>
                        {report.after.audit_complete.worst_severity}
                      </span>
                    } />
                    <Row k="qa_passed" v={String(report.after.audit_complete.qa_passed)} />
                    <Row k="steps" v={String(report.after.audit_complete.steps)} />
                  </dl>
                ) : (
                  <div className="text-xs text-muted-foreground italic">No audit_complete observation.</div>
                )}
                {report.after.observations.length > 0 && (
                  <div className="mt-3">
                    <div className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1">
                      Observations ({report.after.observations.length})
                    </div>
                    <ul className="text-xs space-y-1">
                      {report.after.observations.map((o, i) => (
                        <li key={i} className="flex items-start gap-2">
                          <span className={`text-[10px] font-mono px-1.5 py-0.5 rounded border shrink-0 ${sevTone(o.severity)}`}>
                            {o.severity}
                          </span>
                          <span className="font-mono text-muted-foreground shrink-0 text-[10px]">{o.kind}</span>
                          <span className="leading-snug">{o.summary}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </Section>
            </div>

            {/* Candidates */}
            <Section title={`Candidates (${report.before.candidates_total ?? "?"} total)`}>
              <div className="space-y-3 text-xs">
                <div>
                  <div className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1">
                    Selected ({report.before.candidates_selected.length})
                  </div>
                  {report.before.candidates_selected.length === 0 ? (
                    <div className="text-muted-foreground italic">None.</div>
                  ) : (
                    <ul className="divide-y divide-border">
                      {report.before.candidates_selected.map((c) => {
                        const isThisOne = c.short_num === targetShortNum;
                        return (
                          <li key={`s-${c.short_num}`} className="py-1.5 flex items-center gap-2">
                            <span className="font-mono text-muted-foreground">#{c.short_num ?? "?"}</span>
                            {isThisOne && <Badge variant="outline" className="text-[10px]">this one</Badge>}
                            <span className="flex-1 truncate">{c.title}</span>
                            {c.phase && <span className="text-[10px] font-mono text-muted-foreground">{c.phase}</span>}
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </div>
                <div>
                  <div className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1">
                    Skipped ({report.before.candidates_skipped.length})
                  </div>
                  {report.before.candidates_skipped.length === 0 ? (
                    <div className="text-muted-foreground italic">None.</div>
                  ) : (
                    <ul className="divide-y divide-border">
                      {report.before.candidates_skipped.map((c) => (
                        <li key={`k-${c.short_num}`} className="py-1.5 flex items-start gap-2">
                          <span className="font-mono text-muted-foreground shrink-0">#{c.short_num ?? "?"}</span>
                          <span className="flex-1">
                            <span className="block truncate">{c.title}</span>
                            <span className="text-[10px] font-mono text-destructive">{c.reason}</span>
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>
            </Section>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}

const Section = ({ title, children }: { title: string; children: React.ReactNode }) => (
  <div className="border border-border rounded-md p-3 bg-card">
    <div className="text-xs font-semibold mb-2">{title}</div>
    {children}
  </div>
);

const Row = ({ k, v }: { k: string; v: React.ReactNode }) => (
  <div className="flex items-center gap-2">
    <dt className="text-muted-foreground w-28 shrink-0">{k}</dt>
    <dd className="flex-1 truncate">{v ?? "—"}</dd>
  </div>
);
