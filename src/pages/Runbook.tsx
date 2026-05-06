import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { AlertTriangle, CheckCircle2, ExternalLink, RefreshCw } from "lucide-react";

type Finding = {
  id: string;
  title: string;
  severity: string;
  area: string | null;
  category: string | null;
  body: string | null;
  reviewed_at: string;
  acknowledged: boolean;
};
type TestRun = {
  id: string;
  suite: string;
  status: string;
  failed: number | null;
  total: number | null;
  workflow_run_url: string | null;
  created_at: string;
};
type QaCheck = {
  id: string;
  phase_key: string;
  criterion: string;
  status: string;
  note: string | null;
  last_checked_at: string | null;
};
type AlertRow = {
  id: string;
  job: string;
  reason: string;
  message: string | null;
  delivered: boolean;
  status_code: number | null;
  error: string | null;
  created_at: string;
};

const sevColor = (s: string) =>
  s === "high" ? "destructive" : s === "medium" ? "default" : "secondary";

export default function Runbook() {
  const [findings, setFindings] = useState<Finding[]>([]);
  const [tests, setTests] = useState<TestRun[]>([]);
  const [qa, setQa] = useState<QaCheck[]>([]);
  const [alerts, setAlerts] = useState<AlertRow[]>([]);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    const [f, t, q, a] = await Promise.all([
      supabase
        .from("roadmap_review_findings")
        .select("id,title,severity,area,category,body,reviewed_at,acknowledged")
        .eq("acknowledged", false)
        .in("severity", ["high", "medium"])
        .order("reviewed_at", { ascending: false })
        .limit(50),
      supabase
        .from("test_runs")
        .select("id,suite,status,failed,total,workflow_run_url,created_at")
        .in("status", ["failed", "errored"])
        .order("created_at", { ascending: false })
        .limit(20),
      supabase
        .from("qa_checks")
        .select("id,phase_key,criterion,status,note,last_checked_at")
        .eq("status", "fail")
        .order("last_checked_at", { ascending: false })
        .limit(50),
      supabase
        .from("alert_log")
        .select("id,job,reason,message,delivered,status_code,error,created_at")
        .order("created_at", { ascending: false })
        .limit(20),
    ]);
    setFindings((f.data as Finding[]) ?? []);
    setTests((t.data as TestRun[]) ?? []);
    setQa((q.data as QaCheck[]) ?? []);
    setAlerts((a.data as AlertRow[]) ?? []);
    setLoading(false);
  };

  useEffect(() => {
    load();
    const ch = supabase
      .channel("runbook")
      .on("postgres_changes", { event: "*", schema: "public", table: "roadmap_review_findings" }, load)
      .on("postgres_changes", { event: "*", schema: "public", table: "test_runs" }, load)
      .on("postgres_changes", { event: "*", schema: "public", table: "qa_checks" }, load)
      .on("postgres_changes", { event: "*", schema: "public", table: "alert_log" }, load)
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
  }, []);

  const ackFinding = async (id: string) => {
    const { error } = await supabase
      .from("roadmap_review_findings")
      .update({ acknowledged: true })
      .eq("id", id);
    if (error) toast.error("Failed to acknowledge", { description: error.message });
    else {
      toast.success("Finding acknowledged");
      setFindings((prev) => prev.filter((x) => x.id !== id));
    }
  };

  const ackAllHigh = async () => {
    const ids = findings.filter((f) => f.severity === "high").map((f) => f.id);
    if (ids.length === 0) return;
    const { error } = await supabase
      .from("roadmap_review_findings")
      .update({ acknowledged: true })
      .in("id", ids);
    if (error) toast.error("Failed", { description: error.message });
    else {
      toast.success(`Acknowledged ${ids.length} high-severity finding(s)`);
      setFindings((prev) => prev.filter((f) => !ids.includes(f.id)));
    }
  };

  const markQaPass = async (id: string) => {
    const { error } = await supabase
      .from("qa_checks")
      .update({ status: "pass", last_checked_at: new Date().toISOString() })
      .eq("id", id);
    if (error) toast.error("Failed", { description: error.message });
    else {
      toast.success("Marked passing");
      setQa((prev) => prev.filter((x) => x.id !== id));
    }
  };

  const counts = useMemo(
    () => ({
      high: findings.filter((f) => f.severity === "high").length,
      medium: findings.filter((f) => f.severity === "medium").length,
      tests: tests.length,
      qa: qa.length,
    }),
    [findings, tests, qa],
  );

  const totalRed = counts.high + counts.tests + counts.qa;

  return (
    <div className="space-y-6">
      <header className="flex items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Automation runbook</h1>
          <p className="text-sm text-muted-foreground">
            Triage red items from code review, nightly tests, and QA probes. See the{" "}
            <a
              href="/docs/automation.md"
              className="underline"
              onClick={(e) => {
                e.preventDefault();
                window.open(
                  "https://github.com/" /* placeholder; doc lives in repo */,
                  "_blank",
                );
              }}
            >
              automation doc
            </a>{" "}
            for trigger conditions and webhook payload.
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={load} disabled={loading}>
            <RefreshCw className={`h-4 w-4 mr-1 ${loading ? "animate-spin" : ""}`} />
            Refresh
          </Button>
          <Button variant="outline" size="sm" asChild>
            <Link to="/roadmap">Open Automation panel</Link>
          </Button>
        </div>
      </header>

      <div className="grid grid-cols-4 gap-3">
        <StatCard label="High-severity findings" value={counts.high} tone={counts.high ? "bad" : "ok"} />
        <StatCard label="Medium findings" value={counts.medium} tone={counts.medium ? "warn" : "ok"} />
        <StatCard label="Failed test runs" value={counts.tests} tone={counts.tests ? "bad" : "ok"} />
        <StatCard label="Failing QA probes" value={counts.qa} tone={counts.qa ? "bad" : "ok"} />
      </div>

      {totalRed === 0 && !loading && (
        <Card>
          <CardContent className="py-12 flex flex-col items-center gap-2 text-muted-foreground">
            <CheckCircle2 className="h-8 w-8 text-primary" />
            <p>All clear. No open red items.</p>
          </CardContent>
        </Card>
      )}

      {/* Findings */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-base">
            Open code-review findings ({findings.length})
          </CardTitle>
          {counts.high > 0 && (
            <Button variant="outline" size="sm" onClick={ackAllHigh}>
              Acknowledge all high
            </Button>
          )}
        </CardHeader>
        <CardContent className="space-y-2">
          {findings.length === 0 && (
            <p className="text-sm text-muted-foreground">No open high/medium findings.</p>
          )}
          {findings.map((f) => (
            <div
              key={f.id}
              className="border border-border rounded-md p-3 space-y-2 bg-card"
            >
              <div className="flex items-start gap-2">
                <Badge variant={sevColor(f.severity) as any}>{f.severity}</Badge>
                {f.area && <Badge variant="outline">{f.area}</Badge>}
                {f.category && <Badge variant="outline">{f.category}</Badge>}
                <span className="text-sm font-medium flex-1">{f.title}</span>
                <Button size="sm" variant="ghost" onClick={() => ackFinding(f.id)}>
                  Acknowledge
                </Button>
              </div>
              {f.body && (
                <p className="text-xs text-muted-foreground whitespace-pre-wrap line-clamp-4">
                  {f.body}
                </p>
              )}
              <p className="text-[11px] text-muted-foreground">
                {new Date(f.reviewed_at).toLocaleString()}
              </p>
            </div>
          ))}
        </CardContent>
      </Card>

      {/* Test runs */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Failed test runs ({tests.length})</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {tests.length === 0 && (
            <p className="text-sm text-muted-foreground">No failed runs in recent history.</p>
          )}
          {tests.map((t) => (
            <div
              key={t.id}
              className="border border-border rounded-md p-3 flex items-center gap-3 bg-card"
            >
              <AlertTriangle className="h-4 w-4 text-destructive" />
              <Badge variant="destructive">{t.status}</Badge>
              <span className="text-sm font-medium">{t.suite}</span>
              <span className="text-xs text-muted-foreground">
                {t.failed ?? 0}/{t.total ?? 0} failed
              </span>
              <span className="text-xs text-muted-foreground ml-auto">
                {new Date(t.created_at).toLocaleString()}
              </span>
              {t.workflow_run_url && (
                <a
                  href={t.workflow_run_url}
                  target="_blank"
                  rel="noreferrer"
                  className="text-xs underline inline-flex items-center gap-1"
                >
                  Workflow <ExternalLink className="h-3 w-3" />
                </a>
              )}
            </div>
          ))}
        </CardContent>
      </Card>

      {/* QA */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Failing QA probes ({qa.length})</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {qa.length === 0 && (
            <p className="text-sm text-muted-foreground">All QA probes passing or unknown.</p>
          )}
          {qa.map((c) => (
            <div
              key={c.id}
              className="border border-border rounded-md p-3 space-y-1 bg-card"
            >
              <div className="flex items-center gap-2">
                <Badge variant="destructive">fail</Badge>
                <Badge variant="outline">{c.phase_key}</Badge>
                <span className="text-sm font-medium flex-1">{c.criterion}</span>
                <Button size="sm" variant="ghost" onClick={() => markQaPass(c.id)}>
                  Mark pass
                </Button>
              </div>
              {c.note && <p className="text-xs text-muted-foreground">{c.note}</p>}
              {c.last_checked_at && (
                <p className="text-[11px] text-muted-foreground">
                  Last checked {new Date(c.last_checked_at).toLocaleString()}
                </p>
              )}
            </div>
          ))}
        </CardContent>
      </Card>

      {/* Alert log */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Recent alert deliveries</CardTitle>
        </CardHeader>
        <CardContent className="space-y-1">
          {alerts.length === 0 && (
            <p className="text-sm text-muted-foreground">No alerts dispatched yet.</p>
          )}
          {alerts.map((a) => (
            <div key={a.id} className="flex items-center gap-2 text-xs py-1 border-b border-border last:border-0">
              {a.delivered ? (
                <CheckCircle2 className="h-3.5 w-3.5 text-primary" />
              ) : (
                <AlertTriangle className="h-3.5 w-3.5 text-destructive" />
              )}
              <span className="font-mono">{a.job}</span>
              <Badge variant="outline" className="text-[10px]">{a.reason}</Badge>
              <span className="text-muted-foreground truncate flex-1">{a.message}</span>
              {a.status_code != null && (
                <span className="text-muted-foreground">{a.status_code}</span>
              )}
              <span className="text-muted-foreground">
                {new Date(a.created_at).toLocaleString()}
              </span>
            </div>
          ))}
        </CardContent>
      </Card>

      {/* Playbook */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Playbook</CardTitle>
        </CardHeader>
        <CardContent className="text-sm space-y-3 text-muted-foreground">
          <div>
            <p className="font-medium text-foreground">High-severity finding</p>
            <p>Read the body, open the referenced file, fix or file a follow-up roadmap task, then click <em>Acknowledge</em>. Acknowledging only clears the queue — it does not push a fix.</p>
          </div>
          <div>
            <p className="font-medium text-foreground">Failed nightly test</p>
            <p>Open the GitHub workflow link, identify the failing spec, reproduce locally with <code className="font-mono">bun run test</code> or <code className="font-mono">bunx vitest run -c vitest.e2e.config.ts</code>. Fix forward; the next nightly run clears the row.</p>
          </div>
          <div>
            <p className="font-medium text-foreground">Failing QA probe</p>
            <p>Mechanical probes: inspect the SQL in <code className="font-mono">qa-validate</code> for that <code className="font-mono">phase_key</code>. Judgement probes: verify the criterion in <code className="font-mono">docs/master-plan.md</code> still holds, then click <em>Mark pass</em>.</p>
          </div>
          <div>
            <p className="font-medium text-foreground">Webhook not delivering</p>
            <p>Check the Alert log above for non-2xx rows. Test the receiver from the <Link to="/roadmap" className="underline">Alerts card</Link> with <em>Send test</em>. For Discord, append <code className="font-mono">/slack</code> to the webhook URL.</p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function StatCard({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: "ok" | "warn" | "bad";
}) {
  const toneCls =
    tone === "bad"
      ? "text-destructive"
      : tone === "warn"
      ? "text-foreground"
      : "text-muted-foreground";
  return (
    <Card>
      <CardContent className="py-4">
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className={`text-2xl font-semibold ${toneCls}`}>{value}</p>
      </CardContent>
    </Card>
  );
}
