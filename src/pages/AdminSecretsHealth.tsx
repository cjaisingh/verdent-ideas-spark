import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast } from "@/hooks/use-toast";
import { CheckCircle2, XCircle, AlertTriangle, RefreshCw, ArrowLeftRight, ShieldAlert } from "lucide-react";

type Mismatch = { key: string; env_fp: string; db_fp: string; resynced?: boolean };
type Result = {
  ok: boolean;
  missing_in_db: string[];
  missing_in_env: string[];
  synced_to_db: string[];
  resynced_env_to_db?: string[];
  mismatches: Mismatch[];
};
type RunRow = {
  id: string;
  trigger: string | null;
  status: string;
  status_code: number | null;
  message: string | null;
  detail: any;
  created_at: string;
};

const SECRETS_HEALTH_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/secrets-health-check`;

function fmtTime(iso: string) {
  return new Date(iso).toLocaleString();
}

function StatusBadge({ status }: { status: string }) {
  if (status === "ok") {
    return (
      <Badge variant="outline" className="border-emerald-500/40 text-emerald-600 dark:text-emerald-400">
        <CheckCircle2 className="h-3 w-3 mr-1" /> ok
      </Badge>
    );
  }
  return (
    <Badge variant="destructive">
      <XCircle className="h-3 w-3 mr-1" /> {status}
    </Badge>
  );
}

function RunCard({ title, run }: { title: string; run: RunRow | null }) {
  return (
    <div className="border border-border rounded-md p-3 space-y-2 bg-card">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium">{title}</h3>
        {run ? <StatusBadge status={run.status} /> : <Badge variant="secondary">none</Badge>}
      </div>
      {!run ? (
        <p className="text-xs text-muted-foreground">No matching run on record.</p>
      ) : (
        <>
          <div className="text-[11px] text-muted-foreground tabular-nums flex gap-3">
            <span>{fmtTime(run.created_at)}</span>
            <span>HTTP {run.status_code ?? "—"}</span>
            <span>trigger: {run.trigger ?? "—"}</span>
          </div>
          {run.message && (
            <p className="text-xs font-mono whitespace-pre-wrap break-words">{run.message}</p>
          )}
          {run.detail && (
            <details className="text-[11px]">
              <summary className="cursor-pointer text-muted-foreground hover:text-foreground">detail</summary>
              <pre className="mt-1 p-2 bg-muted rounded text-[10px] overflow-x-auto">
                {JSON.stringify(run.detail, null, 2)}
              </pre>
            </details>
          )}
        </>
      )}
    </div>
  );
}

export default function AdminSecretsHealth() {
  const [result, setResult] = useState<Result | null>(null);
  const [lastOk, setLastOk] = useState<RunRow | null>(null);
  const [lastError, setLastError] = useState<RunRow | null>(null);
  const [recent, setRecent] = useState<RunRow[]>([]);
  const [busy, setBusy] = useState<"check" | "sync" | null>(null);
  const [confirmSync, setConfirmSync] = useState(false);

  const loadRuns = async () => {
    const select = "id, trigger, status, status_code, message, detail, created_at";
    const [okRes, errRes, recentRes] = await Promise.all([
      supabase
        .from("automation_runs" as any)
        .select(select)
        .eq("job", "secrets-health-check")
        .eq("status", "ok")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
      supabase
        .from("automation_runs" as any)
        .select(select)
        .eq("job", "secrets-health-check")
        .neq("status", "ok")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
      supabase
        .from("automation_runs" as any)
        .select(select)
        .eq("job", "secrets-health-check")
        .order("created_at", { ascending: false })
        .limit(20),
    ]);
    setLastOk((okRes.data as any) ?? null);
    setLastError((errRes.data as any) ?? null);
    setRecent(((recentRes.data as any) ?? []) as RunRow[]);
  };

  useEffect(() => { loadRuns(); }, []);

  const call = async (mode: "check" | "sync") => {
    setBusy(mode);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        toast({ title: "Not signed in", description: "Operator session required.", variant: "destructive" });
        return;
      }
      const url = mode === "sync" ? `${SECRETS_HEALTH_URL}?sync=env-to-db` : SECRETS_HEALTH_URL;
      const resp = await fetch(url, {
        method: "POST",
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      const body = await resp.json().catch(() => ({}));
      if (!resp.ok) {
        toast({
          title: mode === "sync" ? "Sync failed" : "Check failed",
          description: body.error ?? `HTTP ${resp.status}`,
          variant: "destructive",
        });
        return;
      }
      setResult(body as Result);
      const r = body as Result;
      const resynced = r.resynced_env_to_db ?? [];
      if (mode === "sync" && resynced.length) {
        toast({
          title: "Synced env → db",
          description: `${resynced.join(", ")} aligned to edge env values.`,
        });
      } else if (r.mismatches?.length) {
        toast({
          title: "Mismatch detected",
          description: r.mismatches.map((m) => m.key).join(", "),
          variant: "destructive",
        });
      } else if (r.ok) {
        toast({ title: mode === "sync" ? "Already aligned" : "All secrets aligned" });
      }
    } catch (e) {
      toast({
        title: "Request failed",
        description: e instanceof Error ? e.message : String(e),
        variant: "destructive",
      });
    } finally {
      setBusy(null);
      setConfirmSync(false);
      await loadRuns();
    }
  };

  const view = result;
  const mismatches: Mismatch[] = view?.mismatches ?? [];
  const missingInDb: string[] = view?.missing_in_db ?? [];
  const missingInEnv: string[] = view?.missing_in_env ?? [];
  const resynced: string[] = view?.resynced_env_to_db ?? [];

  return (
    <div className="max-w-5xl mx-auto p-6 space-y-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold">Secrets health</h1>
        <p className="text-sm text-muted-foreground">
          Manual trigger for <code className="font-mono">secrets-health-check</code>. Verifies that required
          auth secrets (<code>AWIP_SERVICE_TOKEN</code>, <code>SUPABASE_SERVICE_ROLE_KEY</code>) match between
          the edge function env and the <code>app_secrets</code> table. Use <em>sync env → db</em> to align the
          DB row to whatever the edge env currently holds (operators rotate via the Lovable secret form,
          which only updates env).
        </p>
      </header>

      <section className="flex flex-wrap gap-2">
        <Button onClick={() => call("check")} disabled={!!busy} variant="outline">
          <RefreshCw className={`h-4 w-4 mr-1.5 ${busy === "check" ? "animate-spin" : ""}`} />
          {busy === "check" ? "Checking…" : "Run check"}
        </Button>
        {!confirmSync ? (
          <Button onClick={() => setConfirmSync(true)} disabled={!!busy} variant="secondary">
            <ArrowLeftRight className="h-4 w-4 mr-1.5" />
            Sync env → db
          </Button>
        ) : (
          <>
            <Button onClick={() => call("sync")} disabled={!!busy} variant="destructive">
              <ShieldAlert className={`h-4 w-4 mr-1.5 ${busy === "sync" ? "animate-spin" : ""}`} />
              {busy === "sync" ? "Syncing…" : "Confirm sync"}
            </Button>
            <Button onClick={() => setConfirmSync(false)} disabled={!!busy} variant="ghost" size="sm">
              Cancel
            </Button>
            <span className="text-xs text-muted-foreground self-center">
              Overwrites <code>app_secrets</code> rows from edge env. Run a check first.
            </span>
          </>
        )}
      </section>

      {view && (
        <section className="border border-border rounded-md p-4 space-y-3 bg-card">
          <div className="flex items-center gap-2">
            {view.ok ? (
              <span className="flex items-center gap-1.5 text-emerald-600 dark:text-emerald-400 font-medium">
                <CheckCircle2 className="h-4 w-4" /> All required secrets present and matching
              </span>
            ) : (
              <span className="flex items-center gap-1.5 text-destructive font-medium">
                <XCircle className="h-4 w-4" /> Mismatch or missing secret detected
              </span>
            )}
            <span className="text-xs text-muted-foreground ml-auto">live result</span>
          </div>

          {mismatches.length > 0 && (
            <div className="text-xs space-y-1">
              <div className="flex items-center gap-1.5 text-destructive font-medium">
                <AlertTriangle className="h-3.5 w-3.5" /> Mismatched values
              </div>
              <ul className="font-mono text-[11px] space-y-0.5">
                {mismatches.map((m) => (
                  <li key={m.key} className="flex gap-3">
                    <span>{m.key}</span>
                    <span className="text-muted-foreground">env=#{m.env_fp}</span>
                    <span className="text-muted-foreground">db=#{m.db_fp}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {missingInDb.length > 0 && (
            <div className="text-xs">
              <span className="text-destructive font-medium">Missing in app_secrets:</span>{" "}
              <code className="font-mono">{missingInDb.join(", ")}</code>
            </div>
          )}
          {missingInEnv.length > 0 && (
            <div className="text-xs">
              <span className="text-destructive font-medium">Missing in edge env:</span>{" "}
              <code className="font-mono">{missingInEnv.join(", ")}</code>
            </div>
          )}
          {resynced.length > 0 && (
            <div className="text-xs text-muted-foreground">
              Re-synced env→db: <code className="font-mono">{resynced.join(", ")}</code>
            </div>
          )}
        </section>
      )}

      <section className="grid md:grid-cols-2 gap-3">
        <RunCard title="Last ok run" run={lastOk} />
        <RunCard title="Last error run" run={lastError} />
      </section>

      <section className="space-y-2">
        <h2 className="text-sm font-medium">Recent runs (20)</h2>
        <div className="border border-border rounded-md overflow-hidden">
          <table className="w-full text-xs">
            <thead className="bg-muted/50">
              <tr className="text-left">
                <th className="px-3 py-2 font-medium">When</th>
                <th className="px-3 py-2 font-medium">Status</th>
                <th className="px-3 py-2 font-medium">HTTP</th>
                <th className="px-3 py-2 font-medium">Trigger</th>
                <th className="px-3 py-2 font-medium">Message</th>
              </tr>
            </thead>
            <tbody>
              {recent.length === 0 ? (
                <tr>
                  <td className="px-3 py-3 text-muted-foreground" colSpan={5}>No runs yet.</td>
                </tr>
              ) : (
                recent.map((r) => (
                  <tr key={r.id} className="border-t border-border">
                    <td className="px-3 py-2 tabular-nums whitespace-nowrap">{fmtTime(r.created_at)}</td>
                    <td className="px-3 py-2"><StatusBadge status={r.status} /></td>
                    <td className="px-3 py-2 tabular-nums">{r.status_code ?? "—"}</td>
                    <td className="px-3 py-2">{r.trigger ?? "—"}</td>
                    <td className="px-3 py-2 font-mono text-[11px] truncate max-w-[36ch]" title={r.message ?? ""}>
                      {r.message ?? "—"}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
