// Reminder banner on /admin: after changing Ollama models, the local worker
// needs its .env updated and a restart. We surface this automatically when:
//   1. A recently-enqueued ai_job requested a model that no online worker
//      currently advertises (likely operator pulled a new model but hasn't
//      restarted the worker), OR
//   2. No worker has reported in the last 5 minutes (worker offline).
// Always-visible checklist below the alert so it can be used as a runbook.

import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Link } from "react-router-dom";
import { AlertTriangle, CheckCircle2, Cpu, ExternalLink, RefreshCw } from "lucide-react";

const FRESH_MS = 5 * 60 * 1000;
const RECENT_JOB_MS = 60 * 60 * 1000;

type WorkerRow = {
  name: string;
  default_model: string | null;
  model_tags: string[] | null;
  last_seen_at: string | null;
  created_at: string | null;
  enabled: boolean;
};

type ClaimLog = {
  created_at: string;
  status: number | null;
  latency_ms: number | null;
};

type State = {
  loading: boolean;
  onlineWorkers: number;
  defaultModels: string[];
  availableTags: string[];
  unservedModels: string[];
  workers: WorkerRow[];
  lastClaim: ClaimLog | null;
};

const EMPTY: State = {
  loading: true,
  onlineWorkers: 0,
  defaultModels: [],
  availableTags: [],
  unservedModels: [],
  workers: [],
  lastClaim: null,
};

function ago(iso: string | null): string {
  if (!iso) return "—";
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 60_000) return `${Math.round(ms / 1000)}s ago`;
  if (ms < 3600_000) return `${Math.round(ms / 60_000)}m ago`;
  if (ms < 86400_000) return `${Math.round(ms / 3600_000)}h ago`;
  return new Date(iso).toLocaleString();
}

export function WorkerRestartChecklist() {
  const [s, setS] = useState<State>(EMPTY);

  async function load() {
    setS((p) => ({ ...p, loading: true }));
    const since = new Date(Date.now() - RECENT_JOB_MS).toISOString();
    const [workersRes, jobsRes, claimRes] = await Promise.all([
      supabase
        .from("ai_workers")
        .select("name, model_tags, default_model, last_seen_at, created_at, enabled")
        .order("last_seen_at", { ascending: false, nullsFirst: false }),
      supabase
        .from("ai_jobs")
        .select("requested_model, created_at")
        .gte("created_at", since)
        .not("requested_model", "is", null),
      supabase
        .from("edge_request_logs")
        .select("created_at, status, latency_ms")
        .eq("function_name", "ai-jobs-claim")
        .order("created_at", { ascending: false })
        .limit(1),
    ]);
    const now = Date.now();
    const allWorkers = (workersRes.data ?? []) as WorkerRow[];
    const online = allWorkers.filter(
      (w) => w.enabled && w.last_seen_at && now - new Date(w.last_seen_at).getTime() < FRESH_MS,
    );
    const availableTags = Array.from(new Set(online.flatMap((w) => w.model_tags ?? []))).sort();
    const defaultModels = Array.from(
      new Set(online.map((w) => w.default_model).filter((m): m is string => !!m)),
    );
    const recentModels = Array.from(
      new Set(((jobsRes.data ?? []) as Array<{ requested_model: string }>)
        .map((j) => j.requested_model)
        .filter(Boolean)),
    );
    const unservedModels = recentModels.filter((m) => !availableTags.includes(m));
    setS({
      loading: false,
      onlineWorkers: online.length,
      defaultModels,
      availableTags,
      unservedModels,
      workers: allWorkers,
      lastClaim: ((claimRes.data ?? [])[0] as ClaimLog | undefined) ?? null,
    });
  }

  useEffect(() => {
    load();
    const ch = supabase
      .channel(`admin-worker-checklist-${crypto.randomUUID()}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "ai_workers" }, load)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "ai_jobs" }, load)
      .subscribe();
    const t = setInterval(load, 30_000);
    return () => {
      supabase.removeChannel(ch);
      clearInterval(t);
    };
  }, []);

  const showAlert =
    !s.loading && (s.onlineWorkers === 0 || s.unservedModels.length > 0);
  const alertReason =
    s.onlineWorkers === 0
      ? "No Ollama worker has reported in the last 5 minutes."
      : `A recent job requested model${s.unservedModels.length === 1 ? "" : "s"} not advertised by any online worker: ${s.unservedModels.join(", ")}.`;

  return (
    <section className="space-y-3">
      {showAlert && (
        <Alert variant="destructive">
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>Worker out of sync</AlertTitle>
          <AlertDescription className="space-y-2">
            <p>{alertReason}</p>
            <p className="text-xs">
              Pull the model on the worker box, update <code>.env</code>, and restart the worker.
            </p>
          </AlertDescription>
        </Alert>
      )}

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm flex items-center gap-2">
            <Cpu className="h-4 w-4" />
            Ollama worker checklist
            <Badge variant="outline" className="ml-1">
              {s.loading ? "…" : `${s.onlineWorkers} online`}
            </Badge>
            <Button
              size="sm"
              variant="ghost"
              className="ml-auto h-7 gap-1"
              onClick={load}
              disabled={s.loading}
            >
              <RefreshCw className={`h-3 w-3 ${s.loading ? "animate-spin" : ""}`} />
              Refresh
            </Button>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <div className="grid grid-cols-2 gap-3 text-xs">
            <div>
              <div className="text-muted-foreground mb-1">Default model</div>
              <div className="flex flex-wrap gap-1">
                {s.defaultModels.length === 0
                  ? <span className="text-muted-foreground">—</span>
                  : s.defaultModels.map((m) => (
                      <Badge key={m} className="font-mono">{m}</Badge>
                    ))}
              </div>
            </div>
            <div>
              <div className="text-muted-foreground mb-1">Available tags</div>
              <div className="flex flex-wrap gap-1">
                {s.availableTags.length === 0
                  ? <span className="text-muted-foreground">—</span>
                  : s.availableTags.map((t) => (
                      <Badge key={t} variant="outline" className="font-mono text-[11px]">{t}</Badge>
                    ))}
              </div>
            </div>
          </div>

          <ol className="list-decimal list-inside space-y-1 text-xs leading-relaxed">
            <li>
              On the worker box: <code className="font-mono">ollama pull &lt;new-model&gt;</code>
            </li>
            <li>
              Edit <code className="font-mono">~/awip/ollama-worker/.env</code> — update{" "}
              <code className="font-mono">MODEL_TAGS</code> and{" "}
              <code className="font-mono">DEFAULT_MODEL</code>.
            </li>
            <li>
              Restart the worker (<code className="font-mono">launchctl kickstart -k …</code> on macOS,
              or <code className="font-mono">systemctl --user restart awip-ollama-worker</code>).
            </li>
            <li>
              Verify here:{" "}
              <Link to="/admin/ai-jobs" className="underline">
                /admin/ai-jobs → Workers
              </Link>{" "}
              should show the new tag within ~5 s.
            </li>
            <li>
              Enqueue a smoke test from{" "}
              <Link to="/admin/ai-usage" className="underline">/admin/ai-usage</Link> with the new
              model selected.
            </li>
          </ol>

          {!showAlert && !s.loading && (
            <div className="flex items-center gap-2 text-xs text-muted-foreground pt-1 border-t">
              <CheckCircle2 className="h-3 w-3 text-green-600" />
              All recent jobs are served by online workers.
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm flex items-center gap-2">
            <Cpu className="h-4 w-4" />
            Verify worker activity
            <Button asChild size="sm" variant="ghost" className="ml-auto h-7 gap-1">
              <Link to="/admin/logs">
                <ExternalLink className="h-3 w-3" />
                All logs
              </Link>
            </Button>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-xs">
          <div className="rounded-md border p-2 flex items-center justify-between gap-2">
            <div>
              <div className="text-muted-foreground">Last <code className="font-mono">ai-jobs-claim</code> poll</div>
              <div className="font-mono">
                {s.lastClaim
                  ? `${ago(s.lastClaim.created_at)} · ${s.lastClaim.status ?? "?"} · ${s.lastClaim.latency_ms ?? "?"}ms`
                  : "no poll recorded"}
              </div>
            </div>
            <Button asChild size="sm" variant="outline" className="h-7 gap-1">
              <Link to="/admin/logs">
                <ExternalLink className="h-3 w-3" />
                Open
              </Link>
            </Button>
          </div>

          <div className="space-y-1">
            <div className="text-muted-foreground">Workers (registered)</div>
            {s.workers.length === 0 && (
              <div className="text-muted-foreground italic">none registered yet</div>
            )}
            {s.workers.map((w) => {
              const isOnline =
                w.enabled &&
                w.last_seen_at &&
                Date.now() - new Date(w.last_seen_at).getTime() < FRESH_MS;
              return (
                <div
                  key={w.name}
                  className="rounded-md border p-2 flex items-center justify-between gap-2"
                >
                  <div className="space-y-0.5">
                    <div className="flex items-center gap-2">
                      <span className="font-mono font-medium">{w.name}</span>
                      <Badge variant={isOnline ? "default" : "outline"} className="text-[10px]">
                        {isOnline ? "online" : "offline"}
                      </Badge>
                      {!w.enabled && <Badge variant="outline" className="text-[10px]">disabled</Badge>}
                    </div>
                    <div className="text-muted-foreground">
                      default: <code className="font-mono">{w.default_model ?? "—"}</code>
                      {" · "}tags: <code className="font-mono">{(w.model_tags ?? []).join(",") || "—"}</code>
                    </div>
                    <div className="text-muted-foreground">
                      last poll: {ago(w.last_seen_at)} · registered: {ago(w.created_at)}
                    </div>
                  </div>
                  <Button asChild size="sm" variant="outline" className="h-7 gap-1">
                    <Link to="/admin/ai-jobs">
                      <ExternalLink className="h-3 w-3" />
                      Workers tab
                    </Link>
                  </Button>
                </div>
              );
            })}
          </div>

          <div className="flex flex-wrap gap-2 pt-1 border-t">
            <Button asChild size="sm" variant="outline" className="h-7 gap-1">
              <Link to="/admin/edge-health">
                <ExternalLink className="h-3 w-3" />
                Edge health
              </Link>
            </Button>
            <Button asChild size="sm" variant="outline" className="h-7 gap-1">
              <Link to="/admin/ai-jobs">
                <ExternalLink className="h-3 w-3" />
                /admin/ai-jobs
              </Link>
            </Button>
          </div>
        </CardContent>
      </Card>
    </section>
  );
}
