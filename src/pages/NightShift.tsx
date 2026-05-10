import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { Loader2, RefreshCw, Play } from "lucide-react";

type Job = {
  jobid: number;
  jobname: string;
  schedule: string;
  active: boolean;
  category: string;
  last_status: string | null;
  last_start: string | null;
  last_end: string | null;
};

const JOB_TO_FN: Record<string, string> = {
  "nightly-rollup-analytics": "nightly-rollup-analytics",
  "snapshot-daily-report": "snapshot-daily-report",
  "ingest-external-data": "ingest-external-data",
  "cache-warm": "cache-warm",
  "scheduled-morning-review": "morning-review",
  "scheduled-sentinel-tick": "sentinel-tick",
  "scheduled-lessons-weekly": "lessons-synthesize",
  "scheduled-deep-audit-weekly": "deep-audit",
  "scheduled-deep-audit-monthly": "deep-audit",
  "scheduled-app-walkthrough": "app-walkthrough",
  "scheduled-awip-reviews-pull": "awip-reviews-pull",
  "scheduled-quarterly-review-open": "quarterly-review-open",
  "scheduled-code-review": "scheduled-code-review",
  "night-agent-open": "night-agent",
  "night-agent-close": "night-agent",
  "overnight-prequeue": "overnight-prequeue",
  "overnight-phase-runner-15m": "overnight-phase-runner",
};

const CATEGORY_VARIANT: Record<string, "default" | "secondary" | "outline" | "destructive"> = {
  audit: "destructive",
  ingest: "default",
  rollup: "default",
  cache: "secondary",
  "night-agent": "outline",
  hygiene: "secondary",
  monitor: "default",
  other: "outline",
};

function fmt(s: string | null) {
  if (!s) return "—";
  return new Date(s).toLocaleString();
}

export default function NightShift() {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    const { data, error } = await supabase.rpc("list_all_nightly_jobs");
    if (error) toast.error(error.message);
    else setJobs((data ?? []) as Job[]);
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const runNow = async (job: Job) => {
    const fn = JOB_TO_FN[job.jobname];
    if (!fn) {
      toast.error(`No edge function mapping for ${job.jobname}`);
      return;
    }
    setBusy(job.jobname);
    try {
      const { error } = await supabase.functions.invoke(fn, { body: {} });
      if (error) throw error;
      toast.success(`${job.jobname} triggered`);
      setTimeout(load, 1500);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Run failed");
    } finally {
      setBusy(null);
    }
  };

  const grouped = jobs.reduce<Record<string, Job[]>>((acc, j) => {
    (acc[j.category] ??= []).push(j);
    return acc;
  }, {});
  const categoryOrder = ["rollup", "ingest", "cache", "monitor", "night-agent", "audit", "hygiene", "other"];

  return (
    <div className="container mx-auto p-6 space-y-6 max-w-6xl">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Night Shift</h1>
          <p className="text-sm text-muted-foreground">
            Every scheduled batch job in one place. Trigger any job manually for a smoke test.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={load} disabled={loading}>
          <RefreshCw className={`h-4 w-4 mr-2 ${loading ? "animate-spin" : ""}`} />
          Refresh
        </Button>
      </div>

      {loading && jobs.length === 0 && (
        <div className="flex items-center justify-center py-12 text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin mr-2" /> Loading…
        </div>
      )}

      {categoryOrder.filter((c) => grouped[c]?.length).map((cat) => (
        <Card key={cat}>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 capitalize">
              <Badge variant={CATEGORY_VARIANT[cat] ?? "outline"}>{cat}</Badge>
              <span className="text-sm font-normal text-muted-foreground">{grouped[cat].length} job(s)</span>
            </CardTitle>
            <CardDescription>
              {cat === "rollup" && "Pre-computed daily aggregates that morning surfaces read instead of recomputing."}
              {cat === "ingest" && "External data pulled into AWIP overnight."}
              {cat === "cache" && "Pre-warm heavy read paths before the operator opens the console."}
              {cat === "monitor" && "Continuous and daily watchers that surface findings."}
              {cat === "night-agent" && "Audit and observation pipelines for promoted work."}
              {cat === "audit" && "Periodic deep audits of the platform."}
              {cat === "hygiene" && "Retention sweeps and lessons synthesis."}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-muted-foreground border-b">
                    <th className="py-2 pr-4">Job</th>
                    <th className="py-2 pr-4 font-mono">Schedule (UTC)</th>
                    <th className="py-2 pr-4">Active</th>
                    <th className="py-2 pr-4">Last status</th>
                    <th className="py-2 pr-4">Last run</th>
                    <th className="py-2 pr-4 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {grouped[cat].map((j) => (
                    <tr key={j.jobid} className="border-b last:border-0">
                      <td className="py-2 pr-4 font-medium">{j.jobname}</td>
                      <td className="py-2 pr-4 font-mono text-xs">{j.schedule}</td>
                      <td className="py-2 pr-4">
                        <Badge variant={j.active ? "default" : "outline"}>{j.active ? "on" : "paused"}</Badge>
                      </td>
                      <td className="py-2 pr-4">
                        {j.last_status ? (
                          <Badge variant={j.last_status === "succeeded" ? "default" : j.last_status === "failed" ? "destructive" : "secondary"}>
                            {j.last_status}
                          </Badge>
                        ) : <span className="text-muted-foreground">—</span>}
                      </td>
                      <td className="py-2 pr-4 text-xs">{fmt(j.last_start)}</td>
                      <td className="py-2 pr-4 text-right">
                        {JOB_TO_FN[j.jobname] && (
                          <Button size="sm" variant="outline" onClick={() => runNow(j)} disabled={busy === j.jobname}>
                            <Play className="h-3.5 w-3.5 mr-1" /> Run now
                          </Button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
