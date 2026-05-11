import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { CheckCircle2, Loader2, RefreshCcw, ArrowUpRight, BookOpen } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import TomorrowPlan from "@/components/morning-review/TomorrowPlan";
import TriageChip from "@/components/morning-review/TriageChip";
import DiscussNextStrip, { type PanelEntry } from "@/components/morning-review/DiscussNextStrip";
import PanelDiscussionDrawer from "@/components/morning-review/PanelDiscussionDrawer";
import { useMorningReviewTriage, type TriageState } from "@/hooks/useMorningReviewTriage";
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

const stateBadgeCls: Record<TriageState, string> = {
  focus: "bg-primary text-primary-foreground",
  revisit: "bg-amber-500 text-white",
  done: "bg-emerald-600 text-white",
  skip: "bg-muted text-muted-foreground",
};

export default function MorningReview() {
  const [review, setReview] = useState<Review | null>(null);
  const [proposedLessons, setProposedLessons] = useState<number>(0);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const triage = useMorningReviewTriage();

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

  const panels: PanelEntry[] = useMemo(() => {
    if (!review) return [];
    return [
      { ref: "stuck-cron-jobs", title: "Stuck cron jobs", count: review.stuck_jobs.length },
      { ref: "promotion-drift", title: "Promotion-vs-shipping drift", count: review.promotion_drift.length },
      { ref: "night-throughput", title: "Night throughput", count: review.night_throughput?.shifts ?? 0 },
      { ref: "open-findings", title: "Open findings (medium+)", count: review.open_findings.length },
      { ref: "top-actions", title: "Top 5 actions", count: review.top_actions.length },
      { ref: "revisit", title: "Revisit (deferred items due)", count: review.revisit_items.length },
    ];
  }, [review]);

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

    return (
      <div className="space-y-6">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <h2 className="text-xl font-semibold">Yesterday · {review.review_date}</h2>
            <p className="text-sm text-muted-foreground">
              Generated by {review.generated_by} · {new Date(review.created_at).toLocaleString()}
            </p>
          </div>
          <div className="flex items-center gap-2">
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

        <DiscussNextStrip panels={panels} triageMap={triage.map} />

        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <KpiTile label="Automation success 24h" value={`${successPct}%`} sub={`${k.automation_total_runs_24h ?? 0} runs`} />
          <KpiTile label="AI cost 24h" value={`$${(k.ai_cost_24h_usd ?? 0).toFixed(2)}`} />
          <KpiTile label="Stuck cron jobs" value={String(review.stuck_jobs.length)} tone={review.stuck_jobs.length ? "warn" : "ok"} />
          <KpiTile label="Open findings" value={String(review.open_findings.length)} tone={review.open_findings.length ? "warn" : "ok"} />
        </div>

        <OvernightRetroLine reviewDate={review.review_date} />

        <div className="grid md:grid-cols-2 gap-4">
          <Section anchor="stuck-cron-jobs" title="Stuck cron jobs" triage={triage} empty={!review.stuck_jobs.length} emptyMsg="All crons fresh.">
            {review.stuck_jobs.map((s) => (
              <div key={s.job} className="flex items-center justify-between text-sm border-b border-border/40 py-2 last:border-0">
                <div>
                  <div className="font-medium">{s.job}</div>
                  <div className="text-xs text-muted-foreground">
                    cadence {s.expected_within_minutes}m · {s.silent_for_minutes == null ? "never run" : `silent ${s.silent_for_minutes}m`}
                  </div>
                </div>
                <Badge variant="destructive">stuck</Badge>
              </div>
            ))}
          </Section>

          <Section anchor="promotion-drift" title="Promotion-vs-shipping drift" triage={triage} empty={!review.promotion_drift.length} emptyMsg="No drift in last 72h.">
            {review.promotion_drift.map((d) => (
              <div key={d.action_id} className="flex items-center justify-between text-sm border-b border-border/40 py-2 last:border-0">
                <div>
                  <div className="font-medium">#{d.short_num} {d.title}</div>
                  <div className="text-xs text-muted-foreground">task {d.task_status ?? "?"} · {d.promoted_age_hours}h since promotion</div>
                </div>
                <Button size="sm" variant="ghost" onClick={() => mirrorAction(`Drift: ${d.title}`)}>
                  <ArrowUpRight className="h-3 w-3 mr-1" /> Mirror
                </Button>
              </div>
            ))}
          </Section>

          <Section anchor="night-throughput" title="Night throughput" triage={triage} empty={!review.night_throughput?.shifts} emptyMsg="No shifts in last 24h.">
            <div className="text-sm space-y-1">
              <div>Shifts: <strong>{review.night_throughput?.shifts ?? 0}</strong> ({review.night_throughput?.completed_shifts ?? 0} completed)</div>
              <div>Last window end: {review.night_throughput?.last_window_end ?? "—"}</div>
              <pre className="text-xs bg-muted/40 p-2 rounded overflow-x-auto max-h-40">
{JSON.stringify(review.night_throughput?.summary ?? {}, null, 2)}
              </pre>
            </div>
          </Section>

          <Section anchor="open-findings" title="Open findings (medium+)" triage={triage} empty={!review.open_findings.length} emptyMsg="No open findings.">
            {review.open_findings.slice(0, 10).map((f) => (
              <div key={f.id} className="flex items-start justify-between gap-2 text-sm border-b border-border/40 py-2 last:border-0">
                <div className="flex-1">
                  <div className="font-medium line-clamp-2">{f.title}</div>
                  <div className="text-xs text-muted-foreground">{f.source ?? "code_review"} · {f.category ?? "—"}</div>
                </div>
                <Badge className={sevColor[f.severity] ?? "bg-muted"}>{f.severity}</Badge>
              </div>
            ))}
          </Section>

          <Section anchor="top-actions" title="Top 5 actions" triage={triage} empty={!review.top_actions.length} emptyMsg="No open actions.">
            {review.top_actions.map((a) => (
              <div key={a.action_id} className="flex items-center justify-between text-sm border-b border-border/40 py-2 last:border-0">
                <div>
                  <div className="font-medium">#{a.short_num} {a.title}</div>
                  <div className="text-xs text-muted-foreground">{a.priority} · {a.age_hours}h old</div>
                </div>
                <Button size="sm" variant="ghost" onClick={() => mirrorAction(`Action: ${a.title}`)}>
                  <ArrowUpRight className="h-3 w-3 mr-1" /> Mirror
                </Button>
              </div>
            ))}
          </Section>

          <Section anchor="revisit" title="Revisit (deferred items due)" triage={triage} empty={!review.revisit_items.length} emptyMsg="Nothing due.">
            {review.revisit_items.map((r) => (
              <div key={r.id} className="flex items-center justify-between text-sm border-b border-border/40 py-2 last:border-0">
                <div>
                  <div className="font-medium">{r.title}</div>
                  <div className="text-xs text-muted-foreground">due {r.defer_until}</div>
                </div>
                <Badge className={sevColor[r.severity] ?? "bg-muted"}>{r.severity}</Badge>
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
  anchor,
  triage,
  children,
  empty,
  emptyMsg,
}: {
  title: string;
  anchor: string;
  triage: ReturnType<typeof useMorningReviewTriage>;
  children: React.ReactNode;
  empty?: boolean;
  emptyMsg?: string;
}) {
  const state = triage.getState("panel", anchor);
  return (
    <Card
      id={`panel-${anchor}`}
      className={cn(
        "scroll-mt-24 transition-opacity",
        (state === "done" || state === "skip") && "opacity-60",
      )}
    >
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-3">
          <CardTitle className="text-base flex items-center gap-2">
            <span>{title}</span>
            {state && (
              <Badge className={cn("text-[10px] capitalize", stateBadgeCls[state])}>{state}</Badge>
            )}
          </CardTitle>
          <TriageChip
            kind="panel"
            itemRef={anchor}
            current={state}
            onChange={triage.setState}
          />
        </div>
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
