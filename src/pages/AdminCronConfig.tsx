import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { Loader2, RefreshCw } from "lucide-react";

type ManagedJob = {
  jobid: number;
  jobname: string;
  schedule: string;
  active: boolean;
  last_status: string | null;
  last_start: string | null;
  last_end: string | null;
};

const META: Record<string, { label: string; workstream: string; description: string; presets: { label: string; cron: string }[] }> = {
  "scheduled-morning-review": {
    label: "Morning Review",
    workstream: "W2",
    description: "Daily KPI snapshot, stuck-job and drift detection.",
    presets: [
      { label: "Daily 06:00 UTC", cron: "0 6 * * *" },
      { label: "Daily 07:00 UTC", cron: "0 7 * * *" },
      { label: "Twice daily (06,18 UTC)", cron: "0 6,18 * * *" },
    ],
  },
  "scheduled-sentinel-tick": {
    label: "Sentinel Agent",
    workstream: "W3",
    description: "Continuous watcher for 5xx spikes, cron silence, stale secrets, role grants.",
    presets: [
      { label: "Every 15 minutes", cron: "*/15 * * * *" },
      { label: "Every 5 minutes", cron: "*/5 * * * *" },
      { label: "Every hour", cron: "0 * * * *" },
    ],
  },
  "scheduled-lessons-weekly": {
    label: "Lessons Loop",
    workstream: "W4",
    description: "Weekly AI synthesis of operational signals into durable lessons.",
    presets: [
      { label: "Sunday 05:00 UTC", cron: "0 5 * * 0" },
      { label: "Monday 06:00 UTC", cron: "0 6 * * 1" },
      { label: "Daily 05:00 UTC", cron: "0 5 * * *" },
    ],
  },
};

const ORDER = ["scheduled-morning-review", "scheduled-sentinel-tick", "scheduled-lessons-weekly"];

function fmtTime(s: string | null) {
  if (!s) return "—";
  return new Date(s).toLocaleString();
}

function StatusBadge({ status }: { status: string | null }) {
  if (!status) return <Badge variant="outline">No runs</Badge>;
  const variant: "default" | "secondary" | "destructive" =
    status === "succeeded" ? "default" : status === "failed" ? "destructive" : "secondary";
  return <Badge variant={variant}>{status}</Badge>;
}

export default function AdminCronConfig() {
  const [jobs, setJobs] = useState<ManagedJob[]>([]);
  const [loading, setLoading] = useState(true);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    const { data, error } = await supabase.rpc("list_managed_cron_jobs");
    if (error) {
      toast.error(`Failed to load cron jobs: ${error.message}`);
    } else {
      const rows = (data ?? []) as ManagedJob[];
      rows.sort((a, b) => ORDER.indexOf(a.jobname) - ORDER.indexOf(b.jobname));
      setJobs(rows);
      setDrafts(Object.fromEntries(rows.map((r) => [r.jobname, r.schedule])));
    }
    setLoading(false);
  };

  useEffect(() => {
    load();
  }, []);

  const toggleActive = async (jobname: string, active: boolean) => {
    setBusy(jobname);
    const { error } = await supabase.rpc("set_managed_cron_active", { _jobname: jobname, _active: active });
    if (error) toast.error(error.message);
    else toast.success(`${META[jobname]?.label ?? jobname} ${active ? "resumed" : "paused"}`);
    await load();
    setBusy(null);
  };

  const saveSchedule = async (jobname: string) => {
    const sched = drafts[jobname]?.trim();
    if (!sched) return;
    setBusy(jobname);
    const { error } = await supabase.rpc("update_managed_cron_schedule", {
      _jobname: jobname,
      _schedule: sched,
    });
    if (error) toast.error(error.message);
    else toast.success(`Schedule updated for ${META[jobname]?.label ?? jobname}`);
    await load();
    setBusy(null);
  };

  const allPaused = useMemo(() => jobs.length > 0 && jobs.every((j) => !j.active), [jobs]);

  return (
    <div className="container mx-auto p-6 space-y-6 max-w-4xl">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Automation schedules</h1>
          <p className="text-sm text-muted-foreground">
            Configure and pause/resume the W2/W3/W4 cron jobs. Changes take effect at the next tick.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={load} disabled={loading}>
          <RefreshCw className={`h-4 w-4 mr-2 ${loading ? "animate-spin" : ""}`} />
          Refresh
        </Button>
      </div>

      {allPaused && (
        <Card className="border-destructive/40 bg-destructive/5">
          <CardContent className="py-3 text-sm text-destructive">
            All managed automation jobs are currently paused. Daily hygiene snapshots and continuous monitoring will not run.
          </CardContent>
        </Card>
      )}

      {loading && jobs.length === 0 && (
        <div className="flex items-center justify-center py-12 text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin mr-2" /> Loading…
        </div>
      )}

      {jobs.map((job) => {
        const meta = META[job.jobname];
        const dirty = (drafts[job.jobname] ?? job.schedule) !== job.schedule;
        return (
          <Card key={job.jobid}>
            <CardHeader>
              <div className="flex items-start justify-between gap-4">
                <div>
                  <CardTitle className="flex items-center gap-2">
                    <Badge variant="outline">{meta?.workstream ?? "—"}</Badge>
                    {meta?.label ?? job.jobname}
                    <code className="text-xs font-normal text-muted-foreground ml-1">{job.jobname}</code>
                  </CardTitle>
                  <CardDescription>{meta?.description}</CardDescription>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-muted-foreground">{job.active ? "Active" : "Paused"}</span>
                  <Switch
                    checked={job.active}
                    disabled={busy === job.jobname}
                    onCheckedChange={(v) => toggleActive(job.jobname, v)}
                  />
                </div>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-sm">
                <div>
                  <div className="text-xs text-muted-foreground">Last status</div>
                  <div className="mt-1"><StatusBadge status={job.last_status} /></div>
                </div>
                <div>
                  <div className="text-xs text-muted-foreground">Last start</div>
                  <div className="mt-1">{fmtTime(job.last_start)}</div>
                </div>
                <div>
                  <div className="text-xs text-muted-foreground">Last end</div>
                  <div className="mt-1">{fmtTime(job.last_end)}</div>
                </div>
              </div>

              <div className="space-y-2">
                <label className="text-xs text-muted-foreground">Cron schedule (UTC, 5 fields)</label>
                <div className="flex gap-2">
                  <Input
                    value={drafts[job.jobname] ?? job.schedule}
                    onChange={(e) => setDrafts((d) => ({ ...d, [job.jobname]: e.target.value }))}
                    className="font-mono"
                    placeholder="* * * * *"
                  />
                  <Button
                    onClick={() => saveSchedule(job.jobname)}
                    disabled={!dirty || busy === job.jobname}
                  >
                    Save
                  </Button>
                  {dirty && (
                    <Button
                      variant="ghost"
                      onClick={() => setDrafts((d) => ({ ...d, [job.jobname]: job.schedule }))}
                    >
                      Reset
                    </Button>
                  )}
                </div>
                <div className="flex flex-wrap gap-2 pt-1">
                  {meta?.presets.map((p) => (
                    <Button
                      key={p.cron}
                      size="sm"
                      variant="outline"
                      onClick={() => setDrafts((d) => ({ ...d, [job.jobname]: p.cron }))}
                    >
                      {p.label} <code className="ml-2 text-xs text-muted-foreground">{p.cron}</code>
                    </Button>
                  ))}
                </div>
              </div>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
