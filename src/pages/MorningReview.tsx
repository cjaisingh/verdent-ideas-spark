import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { CheckCircle2, Loader2, RefreshCcw, ArrowUpRight, BookOpen } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import TomorrowPlan from "@/components/morning-review/TomorrowPlan";
import TriageChip from "@/components/morning-review/TriageChip";
import DiscussNextStrip, { type FocusItem } from "@/components/morning-review/DiscussNextStrip";
import { useMorningReviewTriage, type TriageKind, type TriageState } from "@/hooks/useMorningReviewTriage";
import { cn } from "@/lib/utils";

type Review = {
  id: string;
  review_date: string;
  kpis: any;
  stuck_jobs: any[];
  promotion_drift: any[];
  night_throughput: any;
  open_findings: any[];
  top_actions: any[];
  revisit_items: any[];
  generated_by: string;
  acknowledged_at: string | null;
  created_at: string;
};

const sevColor: Record<string, string> = {
  critical: "bg-destructive text-destructive-foreground",
  high: "bg-destructive/80 text-destructive-foreground",
  medium: "bg-amber-500 text-white",
  low: "bg-muted text-muted-foreground",
  info: "bg-muted text-muted-foreground",
};

const HIDE_CLEARED_KEY = "mr-hide-cleared";

export default function MorningReview() {
  const [review, setReview] = useState<Review | null>(null);
  const [proposedLessons, setProposedLessons] = useState<number>(0);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [hideCleared, setHideCleared] = useState<boolean>(() => {
    if (typeof window === "undefined") return true;
    return localStorage.getItem(HIDE_CLEARED_KEY) !== "false";
  });
  const triage = useMorningReviewTriage();

  useEffect(() => {
    localStorage.setItem(HIDE_CLEARED_KEY, String(hideCleared));
  }, [hideCleared]);

  const load = async () => {
    setLoading(true);
    const [{ data: r }, { count }] = await Promise.all([
      supabase.from("morning_reviews").select("*").order("review_date", { ascending: false }).limit(1).maybeSingle(),
      supabase.from("lessons").select("id", { count: "exact", head: true }).eq("status", "proposed"),
    ]);
    setReview((r as Review | null) ?? null);
    setProposedLessons(count ?? 0);
    setLoading(false);
  };

  useEffect(() => {
    load();
    const ch = supabase.channel("morning-review-live")
      .on("postgres_changes", { event: "*", schema: "public", table: "morning_reviews" }, load)
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, []);

  const runNow = async () => {
    setRunning(true);
    try {
      const { error } = await supabase.functions.invoke("morning-review", { body: {} });
      if (error) throw error;
      toast.success("Morning review regenerated.");
      await load();
    } catch (e: any) { toast.error(e.message ?? "failed"); }
    finally { setRunning(false); }
  };

  const acknowledge = async () => {
    if (!review) return;
    const { error } = await supabase.from("morning_reviews")
      .update({ acknowledged_at: new Date().toISOString() })
      .eq("id", review.id);
    if (error) toast.error(error.message); else { toast.success("Acknowledged."); load(); }
  };

  const mirrorAction = async (title: string) => {
    if (!review) return;
    const { error } = await supabase.from("discussion_actions").insert({
      title: `[MR ${review.review_date}] ${title}`.slice(0, 240),
      status: "open",
      priority: "med",
      source: "manual",
      subject_type: "morning_review",
      subject_id: review.id,
    });
    if (error) toast.error(error.message); else toast.success("Mirrored as discussion action.");
  };

  const focusItems: FocusItem[] = useMemo(() => {
    if (!review) return [];
    const items: FocusItem[] = [];
    for (const s of review.stuck_jobs) {
      items.push({ kind: "cron_stuck", ref: s.job, label: s.job, sub: `cadence ${s.expected_within_minutes}m`, panel: "Stuck cron jobs" });
    }
    for (const d of review.promotion_drift) {
      items.push({ kind: "promotion_drift", ref: d.action_id, label: `#${d.short_num} ${d.title}`, sub: `${d.promoted_age_hours}h since promotion`, panel: "Promotion-vs-shipping drift" });
    }
    for (const f of review.open_findings) {
      const k: TriageKind = f.source === "sentinel" ? "sentinel_finding" : "code_review_finding";
      items.push({ kind: k, ref: f.id, label: f.title, sub: `${f.source ?? "code_review"} · ${f.severity}`, panel: "Open findings (medium+)" });
    }
    for (const a of review.top_actions) {
      items.push({ kind: "discussion_action", ref: a.action_id, label: `#${a.short_num} ${a.title}`, sub: `${a.priority} · ${a.age_hours}h old`, panel: "Top 5 actions" });
    }
    for (const r of review.revisit_items) {
      items.push({ kind: "deferred", ref: r.id, label: r.title, sub: `due ${r.defer_until}`, panel: "Revisit (deferred items due)" });
    }
    return items;
  }, [review]);

  const isCleared = (kind: TriageKind, ref: string) => {
    const s = triage.getState(kind, ref);
    return s === "done" || s === "skip";
  };

  const panelCounts = (kind: TriageKind, refs: string[]) => {
    let f = 0, r = 0;
    for (const ref of refs) {
      const s = triage.getState(kind, ref);
      if (s === "focus") f++;
      else if (s === "revisit") r++;
    }
    return { f, r };
  };

  const renderYesterday = () => {
    if (loading) {
      return <div className="flex items-center gap-2 p-8 text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</div>;
    }
    if (!review) {
      return (
        <div className="p-2 space-y-4">
          <p className="text-muted-foreground">No review yet.</p>
          <Button onClick={runNow} disabled={running}>
            {running ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <RefreshCcw className="h-4 w-4 mr-2" />}
            Generate now
          </Button>
        </div>
      );
    }
    const k = review.kpis ?? {};
    const successPct = Math.round((k.automation_success_rate_24h ?? 1) * 100);

    const stuckJobs = hideCleared ? review.stuck_jobs.filter((s) => !isCleared("cron_stuck", s.job)) : review.stuck_jobs;
    const drift = hideCleared ? review.promotion_drift.filter((d) => !isCleared("promotion_drift", d.action_id)) : review.promotion_drift;
    const findings = hideCleared
      ? review.open_findings.filter((f) => {
          const kk: TriageKind = f.source === "sentinel" ? "sentinel_finding" : "code_review_finding";
          return !isCleared(kk, f.id);
        })
      : review.open_findings;
    const actions = hideCleared ? review.top_actions.filter((a) => !isCleared("discussion_action", a.action_id)) : review.top_actions;
    const revisit = hideCleared ? review.revisit_items.filter((r) => !isCleared("deferred", r.id)) : review.revisit_items;

    const stuckCounts = panelCounts("cron_stuck", review.stuck_jobs.map((s) => s.job));
    const driftCounts = panelCounts("promotion_drift", review.promotion_drift.map((d) => d.action_id));
    const findingCountsCR = panelCounts("code_review_finding", review.open_findings.filter((f) => f.source !== "sentinel").map((f) => f.id));
    const findingCountsSE = panelCounts("sentinel_finding", review.open_findings.filter((f) => f.source === "sentinel").map((f) => f.id));
    const findingCounts = { f: findingCountsCR.f + findingCountsSE.f, r: findingCountsCR.r + findingCountsSE.r };
    const actionCounts = panelCounts("discussion_action", review.top_actions.map((a) => a.action_id));
    const revisitCounts = panelCounts("deferred", review.revisit_items.map((r) => r.id));

    const rowCls = (kind: TriageKind, ref: string) =>
      cn(
        "flex items-center justify-between gap-2 text-sm border-b border-border/40 py-2 last:border-0",
        isCleared(kind, ref) && "opacity-50",
      );

    return (
      <div className="space-y-6">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <h2 className="text-xl font-semibold">Yesterday · {review.review_date}</h2>
            <p className="text-sm text-muted-foreground">
              Generated by {review.generated_by} · {new Date(review.created_at).toLocaleString()}
            </p>
          </div>
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2">
              <Switch id="hide-cleared" checked={hideCleared} onCheckedChange={setHideCleared} />
              <Label htmlFor="hide-cleared" className="text-xs text-muted-foreground cursor-pointer">Hide cleared</Label>
            </div>
            {proposedLessons > 0 && (
              <Button asChild variant="outline" size="sm">
                <Link to="/admin/lessons"><BookOpen className="h-4 w-4 mr-1" />{proposedLessons} proposed lessons</Link>
              </Button>
            )}
            <Button onClick={runNow} disabled={running} size="sm" variant="outline">
              {running ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <RefreshCcw className="h-4 w-4 mr-1" />}
              Re-run
            </Button>
            {review.acknowledged_at ? (
              <Badge variant="secondary"><CheckCircle2 className="h-3 w-3 mr-1" /> Acknowledged</Badge>
            ) : (
              <Button onClick={acknowledge} size="sm">Acknowledge</Button>
            )}
          </div>
        </div>

        <DiscussNextStrip items={focusItems} triageMap={triage.map} />

        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <KpiTile label="Automation success 24h" value={`${successPct}%`} sub={`${k.automation_total_runs_24h ?? 0} runs`} />
          <KpiTile label="AI cost 24h" value={`$${(k.ai_cost_24h_usd ?? 0).toFixed(2)}`} />
          <KpiTile label="Stuck cron jobs" value={String(review.stuck_jobs.length)} tone={review.stuck_jobs.length ? "warn" : "ok"} />
          <KpiTile label="Open findings" value={String(review.open_findings.length)} tone={review.open_findings.length ? "warn" : "ok"} />
        </div>

        <OvernightRetroLine reviewDate={review.review_date} />

        <div className="grid md:grid-cols-2 gap-4">
          <Section anchor="stuck-cron-jobs" title="Stuck cron jobs" counts={stuckCounts} empty={!stuckJobs.length} emptyMsg="All clear in this panel.">
            {stuckJobs.map((s) => (
              <div key={s.job} className={rowCls("cron_stuck", s.job)}>
                <div className="flex-1 min-w-0">
                  <div className="font-medium">{s.job}</div>
                  <div className="text-xs text-muted-foreground">
                    cadence {s.expected_within_minutes}m · {s.silent_for_minutes == null ? "never run" : `silent ${s.silent_for_minutes}m`}
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <Badge variant="destructive">stuck</Badge>
                  <TriageChip kind="cron_stuck" itemRef={s.job} current={triage.getState("cron_stuck", s.job)} onChange={triage.setState} />
                </div>
              </div>
            ))}
          </Section>

          <Section anchor="promotion-vs-shipping-drift" title="Promotion-vs-shipping drift" counts={driftCounts} empty={!drift.length} emptyMsg="No drift in last 72h.">
            {drift.map((d) => (
              <div key={d.action_id} className={rowCls("promotion_drift", d.action_id)}>
                <div className="flex-1 min-w-0">
                  <div className="font-medium">#{d.short_num} {d.title}</div>
                  <div className="text-xs text-muted-foreground">task {d.task_status ?? "?"} · {d.promoted_age_hours}h since promotion</div>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <Button size="sm" variant="ghost" onClick={() => mirrorAction(`Drift: ${d.title}`)}>
                    <ArrowUpRight className="h-3 w-3 mr-1" /> Mirror
                  </Button>
                  <TriageChip kind="promotion_drift" itemRef={d.action_id} current={triage.getState("promotion_drift", d.action_id)} onChange={triage.setState} />
                </div>
              </div>
            ))}
          </Section>

          <Section anchor="night-throughput" title="Night throughput" empty={!review.night_throughput?.shifts}
                   emptyMsg="No shifts in last 24h.">
            <div className="text-sm space-y-1">
              <div>Shifts: <strong>{review.night_throughput?.shifts ?? 0}</strong> ({review.night_throughput?.completed_shifts ?? 0} completed)</div>
              <div>Last window end: {review.night_throughput?.last_window_end ?? "—"}</div>
              <pre className="text-xs bg-muted/40 p-2 rounded overflow-x-auto max-h-40">
{JSON.stringify(review.night_throughput?.summary ?? {}, null, 2)}
              </pre>
              {review.night_throughput?.last_window_end && (
                <div className="pt-2">
                  <TriageChip
                    kind="night_throughput"
                    itemRef={review.night_throughput.last_window_end}
                    current={triage.getState("night_throughput", review.night_throughput.last_window_end)}
                    onChange={triage.setState}
                  />
                </div>
              )}
            </div>
          </Section>

          <Section anchor="open-findings" title="Open findings (medium+)" counts={findingCounts} empty={!findings.length} emptyMsg="All clear in this panel.">
            {findings.slice(0, 10).map((f) => {
              const kk: TriageKind = f.source === "sentinel" ? "sentinel_finding" : "code_review_finding";
              return (
                <div key={f.id} className={rowCls(kk, f.id)}>
                  <div className="flex-1 min-w-0">
                    <div className="font-medium line-clamp-2">{f.title}</div>
                    <div className="text-xs text-muted-foreground">{f.source ?? "code_review"} · {f.category ?? "—"}</div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <Badge className={sevColor[f.severity] ?? "bg-muted"}>{f.severity}</Badge>
                    <TriageChip kind={kk} itemRef={f.id} current={triage.getState(kk, f.id)} onChange={triage.setState} />
                  </div>
                </div>
              );
            })}
          </Section>

          <Section anchor="top-5-actions" title="Top 5 actions" counts={actionCounts} empty={!actions.length} emptyMsg="No open actions.">
            {actions.map((a) => (
              <div key={a.action_id} className={rowCls("discussion_action", a.action_id)}>
                <div className="flex-1 min-w-0">
                  <div className="font-medium">#{a.short_num} {a.title}</div>
                  <div className="text-xs text-muted-foreground">{a.priority} · {a.age_hours}h old</div>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <Button size="sm" variant="ghost" onClick={() => mirrorAction(`Action: ${a.title}`)}>
                    <ArrowUpRight className="h-3 w-3 mr-1" /> Mirror
                  </Button>
                  <TriageChip kind="discussion_action" itemRef={a.action_id} current={triage.getState("discussion_action", a.action_id)} onChange={triage.setState} />
                </div>
              </div>
            ))}
          </Section>

          <Section anchor="revisit-deferred-items-due" title="Revisit (deferred items due)" counts={revisitCounts} empty={!revisit.length} emptyMsg="Nothing due.">
            {revisit.map((r) => (
              <div key={r.id} className={rowCls("deferred", r.id)}>
                <div className="flex-1 min-w-0">
                  <div className="font-medium">{r.title}</div>
                  <div className="text-xs text-muted-foreground">due {r.defer_until}</div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <Badge className={sevColor[r.severity] ?? "bg-muted"}>{r.severity}</Badge>
                  <TriageChip kind="deferred" itemRef={r.id} current={triage.getState("deferred", r.id)} onChange={triage.setState} />
                </div>
              </div>
            ))}
          </Section>
        </div>
      </div>
    );
  };

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-4">
      <div>
        <h1 className="text-2xl font-semibold">Morning Review</h1>
        <p className="text-sm text-muted-foreground">Yesterday's roll-up and tomorrow's plan.</p>
      </div>
      <Tabs defaultValue="yesterday" className="w-full">
        <TabsList>
          <TabsTrigger value="yesterday">Yesterday</TabsTrigger>
          <TabsTrigger value="tomorrow">Tomorrow</TabsTrigger>
        </TabsList>
        <TabsContent value="yesterday" className="mt-4">{renderYesterday()}</TabsContent>
        <TabsContent value="tomorrow" className="mt-4"><TomorrowPlan /></TabsContent>
      </Tabs>
    </div>
  );
}

function KpiTile({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: "ok" | "warn" }) {
  return (
    <Card>
      <CardContent className="pt-4">
        <div className="text-xs text-muted-foreground">{label}</div>
        <div className={`text-2xl font-semibold mt-1 ${tone === "warn" ? "text-destructive" : ""}`}>{value}</div>
        {sub && <div className="text-xs text-muted-foreground mt-0.5">{sub}</div>}
      </CardContent>
    </Card>
  );
}

function Section({
  title,
  children,
  empty,
  emptyMsg,
  counts,
  anchor,
}: {
  title: string;
  children: React.ReactNode;
  empty?: boolean;
  emptyMsg?: string;
  counts?: { f: number; r: number };
  anchor?: string;
}) {
  return (
    <Card id={anchor ? `panel-${anchor}` : undefined} className="scroll-mt-24">
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <span>{title}</span>
          {counts && counts.f > 0 && (
            <Badge variant="default" className="text-[10px] h-5">Focus {counts.f}</Badge>
          )}
          {counts && counts.r > 0 && (
            <Badge className="text-[10px] h-5 bg-amber-500 text-white hover:bg-amber-500/90">Revisit {counts.r}</Badge>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent>
        {empty ? (
          <div className="text-sm text-muted-foreground flex items-center gap-2">
            <CheckCircle2 className="h-4 w-4" /> {emptyMsg}
          </div>
        ) : children}
      </CardContent>
    </Card>
  );
}

function OvernightRetroLine({ reviewDate }: { reviewDate: string }) {
  const [stats, setStats] = useState<{ total: number; queued: number; dismissed: number; open: number } | null>(null);
  useEffect(() => {
    (async () => {
      const { data } = await supabase
        .from("overnight_recommendations")
        .select("status")
        .eq("scheduled_for", reviewDate);
      const rows = (data ?? []) as Array<{ status: string }>;
      setStats({
        total: rows.length,
        queued: rows.filter((r) => r.status === "queued").length,
        dismissed: rows.filter((r) => r.status === "dismissed").length,
        open: rows.filter((r) => r.status === "open").length,
      });
    })();
  }, [reviewDate]);
  if (!stats || stats.total === 0) return null;
  return (
    <div className="text-xs text-muted-foreground border-l-2 border-border pl-3">
      Last night: {stats.total} overnight candidate{stats.total === 1 ? "" : "s"} suggested ·{" "}
      {stats.queued} queued · {stats.dismissed} dismissed
      {stats.open > 0 ? ` · ${stats.open} ignored` : ""}.
    </div>
  );
}
