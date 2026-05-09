import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast } from "@/hooks/use-toast";

type Job = {
  key: string;
  label: string;
  description: string;
  fn: string;          // edge function name
  path?: string;       // sub-path appended after the function name
  body?: unknown;
};

const JOBS: Job[] = [
  {
    key: "open",
    label: "Open night shift",
    description: "Manually fires night-agent/open. Same as the 22:00 UTC cron.",
    fn: "night-agent",
    path: "/open",
  },
  {
    key: "close",
    label: "Close night shift",
    description: "Manually fires night-agent/close. Same as the 06:00 UTC cron.",
    fn: "night-agent",
    path: "/close",
  },
  {
    key: "prequeue",
    label: "Pre-queue nightly phases",
    description: "Manually fires overnight-prequeue. Same as the 21:55 UTC cron. Inserts queued runs for all phases flagged 'nightly'.",
    fn: "overnight-prequeue",
  },
  {
    key: "phase-runner",
    label: "Run queued phases",
    description: "Manually fires the 15-minute overnight phase runner against any queued runs.",
    fn: "overnight-phase-runner",
  },
];

type Result = {
  status: "ok" | "error";
  http: number;
  body: unknown;
  ms: number;
};

const ManualOvernightTriggers = () => {
  const [busy, setBusy] = useState<string | null>(null);
  const [results, setResults] = useState<Record<string, Result>>({});

  const trigger = async (job: Job) => {
    setBusy(job.key);
    const startedAt = Date.now();
    try {
      // We use fetch so we can hit a sub-path on the same function (`/open`, `/close`)
      // and so we capture the real HTTP status — supabase.functions.invoke swallows
      // non-2xx into `error`. The session JWT is added manually as Bearer auth, which
      // satisfies the auth gate in both functions (manual trigger).
      const { data: { session } } = await supabase.auth.getSession();
      const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/${job.fn}${job.path ?? ""}`;
      const resp = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${session?.access_token ?? ""}`,
          "apikey": import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
        },
        body: JSON.stringify(job.body ?? {}),
      });
      const text = await resp.text();
      let parsed: unknown = text;
      try { parsed = JSON.parse(text); } catch { /* keep raw */ }
      const result: Result = {
        status: resp.ok ? "ok" : "error",
        http: resp.status,
        body: parsed,
        ms: Date.now() - startedAt,
      };
      setResults((r) => ({ ...r, [job.key]: result }));
      toast({
        title: resp.ok ? `${job.label} — ok (${resp.status})` : `${job.label} — failed (${resp.status})`,
        description: "Result recorded in automation_runs",
        variant: resp.ok ? "default" : "destructive",
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setResults((r) => ({ ...r, [job.key]: { status: "error", http: 0, body: { error: msg }, ms: Date.now() - startedAt } }));
      toast({ title: `${job.label} — request failed`, description: msg, variant: "destructive" });
    } finally {
      setBusy(null);
    }
  };

  return (
    <section className="space-y-3">
      <div>
        <h2 className="text-lg font-medium">Overnight automation — manual triggers</h2>
        <p className="text-sm text-muted-foreground">
          Run the overnight cron jobs on demand. Each invocation is logged to{" "}
          <code className="font-mono">automation_runs</code> with{" "}
          <code className="font-mono">trigger = manual</code>.
        </p>
      </div>
      <div className="border border-border rounded-md divide-y divide-border">
        {JOBS.map((job) => {
          const result = results[job.key];
          return (
            <div key={job.key} className="p-4 flex items-start gap-4">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <div className="font-medium">{job.label}</div>
                  <code className="text-xs font-mono text-muted-foreground">
                    {job.fn}{job.path ?? ""}
                  </code>
                </div>
                <div className="text-xs text-muted-foreground mt-0.5">{job.description}</div>
                {result && (
                  <div className="mt-2 text-xs space-y-1">
                    <div className="flex items-center gap-2">
                      <Badge variant={result.status === "ok" ? "default" : "destructive"}>
                        {result.status} · {result.http}
                      </Badge>
                      <span className="text-muted-foreground tabular-nums">{result.ms} ms</span>
                    </div>
                    <pre className="font-mono text-xs bg-muted/50 rounded p-2 max-h-48 overflow-auto">
                      {JSON.stringify(result.body, null, 2)}
                    </pre>
                  </div>
                )}
              </div>
              <Button
                size="sm"
                onClick={() => trigger(job)}
                disabled={busy === job.key}
              >
                {busy === job.key ? "Running…" : "Trigger"}
              </Button>
            </div>
          );
        })}
      </div>
    </section>
  );
};

export default ManualOvernightTriggers;
