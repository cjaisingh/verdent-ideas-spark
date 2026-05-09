import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast } from "@/hooks/use-toast";
import { CheckCircle2, XCircle, AlertTriangle, RefreshCw } from "lucide-react";

type Mismatch = { key: string; env_fp: string; db_fp: string };
type Result = {
  ok: boolean;
  missing_in_db: string[];
  missing_in_env: string[];
  synced_to_db: string[];
  mismatches: Mismatch[];
};
type RunRow = {
  id: string;
  status: string;
  status_code: number | null;
  message: string | null;
  detail: any;
  created_at: string;
};

export default function CronSecretsCheckPanel() {
  const [result, setResult] = useState<Result | null>(null);
  const [lastRun, setLastRun] = useState<RunRow | null>(null);
  const [busy, setBusy] = useState(false);

  const loadLast = async () => {
    const { data } = await supabase
      .from("automation_runs" as any)
      .select("id, status, status_code, message, detail, created_at")
      .eq("job", "secrets-health-check")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    setLastRun((data as any) ?? null);
  };

  useEffect(() => { loadLast(); }, []);

  const runCheck = async () => {
    setBusy(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const resp = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/secrets-health-check`,
        { method: "POST", headers: { Authorization: `Bearer ${session?.access_token}` } },
      );
      const body = await resp.json().catch(() => ({}));
      if (!resp.ok) {
        toast({ title: "Check failed", description: body.error ?? `HTTP ${resp.status}`, variant: "destructive" });
        return;
      }
      setResult(body as Result);
      if ((body as Result).mismatches?.length > 0) {
        toast({
          title: "Secret mismatch detected",
          description: `${(body as Result).mismatches.map((m) => m.key).join(", ")} differ between edge env and app_secrets.`,
          variant: "destructive",
        });
      } else if ((body as Result).ok) {
        toast({ title: "All cron secrets aligned" });
      }
      await loadLast();
    } catch (e) {
      toast({ title: "Check failed", description: e instanceof Error ? e.message : String(e), variant: "destructive" });
    } finally { setBusy(false); }
  };

  const view = result ?? (lastRun?.detail ?? null);
  const mismatches: Mismatch[] = view?.mismatches ?? [];
  const missingInDb: string[] = view?.missing_in_db ?? [];
  const missingInEnv: string[] = view?.missing_in_env ?? [];
  const ok = view ? mismatches.length === 0 && missingInDb.length === 0 && missingInEnv.length === 0 : null;

  return (
    <section className="space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-medium">Cron secret integrity</h2>
          <p className="text-xs text-muted-foreground">
            Verifies <code>AWIP_SERVICE_TOKEN</code> matches between the edge function env and the
            <code> app_secrets</code> row. Mismatches are alerted via the <code>alert_log</code> webhook.
          </p>
        </div>
        <Button size="sm" variant="outline" onClick={runCheck} disabled={busy}>
          <RefreshCw className={`h-3 w-3 mr-1.5 ${busy ? "animate-spin" : ""}`} />
          {busy ? "Checking…" : "Run check"}
        </Button>
      </div>

      <div className="border border-border rounded-md p-3 space-y-2">
        <div className="flex items-center gap-2 text-sm">
          {ok === null ? (
            <Badge variant="secondary">Not checked yet</Badge>
          ) : ok ? (
            <span className="flex items-center gap-1.5 text-emerald-600 dark:text-emerald-400 font-medium">
              <CheckCircle2 className="h-4 w-4" /> All required secrets present and matching
            </span>
          ) : (
            <span className="flex items-center gap-1.5 text-destructive font-medium">
              <XCircle className="h-4 w-4" /> Mismatch or missing secret detected
            </span>
          )}
          {lastRun && (
            <span className="text-[10px] text-muted-foreground ml-auto tabular-nums">
              last run {new Date(lastRun.created_at).toLocaleString()}
            </span>
          )}
        </div>

        {mismatches.length > 0 && (
          <div className="text-xs space-y-1">
            <div className="flex items-center gap-1.5 text-destructive font-medium">
              <AlertTriangle className="h-3.5 w-3.5" /> Mismatched values
            </div>
            <ul className="font-mono text-[11px] space-y-0.5">
              {mismatches.map((m) => (
                <li key={m.key} className="flex gap-3">
                  <span className="text-foreground">{m.key}</span>
                  <span className="text-muted-foreground">env=#{m.env_fp}</span>
                  <span className="text-muted-foreground">db=#{m.db_fp}</span>
                </li>
              ))}
            </ul>
            <div className="text-[11px] text-muted-foreground">
              Fingerprints are short SHA-256 prefixes — never the secret itself. Rotate via the panel
              above (or in Lovable Cloud secrets) and re-run the check.
            </div>
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
        {result?.synced_to_db?.length ? (
          <div className="text-xs text-muted-foreground">
            Auto-synced to db: <code className="font-mono">{result.synced_to_db.join(", ")}</code>
          </div>
        ) : null}
        {lastRun?.message && !result && (
          <div className="text-xs text-muted-foreground">{lastRun.message}</div>
        )}
      </div>
    </section>
  );
}
