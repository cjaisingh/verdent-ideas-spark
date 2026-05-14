import { useEffect, useId, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { RefreshCw, AlertTriangle, FileCode2 } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { toast } from "sonner";

type Health = {
  function_name: string;
  total: number;
  errors: number;
  error_rate: number | null;
  p95_latency_ms: number | null;
  last_error_at: string | null;
  last_error_status: number | null;
  last_error_class: string | null;
  last_error_message: string | null;
};

type FailRow = {
  request_id: string | null;
  status: number | null;
  function_name: string;
  classified_error: string | null;
  error_message: string | null;
  user_id_hash: string | null;
  created_at: string;
};

type ClientErr = {
  function_name: string | null;
  message: string;
  url: string | null;
  created_at: string;
};

type LintRow = {
  id: string;
  created_at: string;
  caller: string;
  file_path: string;
  language: string;
  status: string;
  duration_ms: number;
  error_class: string | null;
  error_message: string | null;
  meta: Record<string, unknown> | null;
};

const HOUR_OPTIONS = [1, 6, 24, 72] as const;

export default function EdgeHealth() {
  const channelId = useId();
  const [hours, setHours] = useState<number>(24);
  const [rows, setRows] = useState<Health[]>([]);
  const [client, setClient] = useState<ClientErr[]>([]);
  const [lintRows, setLintRows] = useState<LintRow[]>([]);
  const [lintTotals, setLintTotals] = useState({ total: 0, failed: 0, skipped: 0 });
  const [lintProbeBusy, setLintProbeBusy] = useState(false);
  const [openLint, setOpenLint] = useState<LintRow | null>(null);
  const [loading, setLoading] = useState(false);
  const [openFn, setOpenFn] = useState<string | null>(null);
  const [drawerRows, setDrawerRows] = useState<FailRow[]>([]);
  const [fetchedAt, setFetchedAt] = useState<Date | null>(null);

  const load = async () => {
    setLoading(true);
    const since = new Date(Date.now() - hours * 3600_000).toISOString();
    const [{ data: health }, { data: cli }, { data: lints }] = await Promise.all([
      supabase.rpc("edge_function_health", { _hours: hours }),
      supabase
        .from("client_error_log")
        .select("function_name,message,url,created_at")
        .gte("created_at", since)
        .order("created_at", { ascending: false })
        .limit(50),
      supabase
        .from("lint_delta_runs")
        .select("id,created_at,caller,file_path,language,status,duration_ms,error_class,error_message,meta")
        .gte("created_at", since)
        .order("created_at", { ascending: false })
        .limit(200),
    ]);
    setRows((health as Health[]) ?? []);
    setClient((cli as ClientErr[]) ?? []);
    const allLints = (lints as LintRow[]) ?? [];
    setLintRows(allLints.filter((r) => r.status === "failed").slice(0, 50));
    setLintTotals({
      total: allLints.length,
      failed: allLints.filter((r) => r.status === "failed").length,
      skipped: allLints.filter((r) => r.status === "skipped").length,
    });
    setFetchedAt(new Date());
    setLoading(false);
  };

  useEffect(() => {
    load();
    const id = setInterval(load, 60_000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hours]);

  // Realtime: refresh on new failed lint rows.
  useEffect(() => {
    const ch = supabase
      .channel(`edge-health-lint-${channelId}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "lint_delta_runs", filter: "status=eq.failed" },
        () => load(),
      )
      .subscribe();
    return () => { supabase.removeChannel(ch); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [channelId]);

  const lintProbe = async () => {
    setLintProbeBusy(true);
    try {
      const { data, error } = await supabase.functions.invoke("lint-delta", {
        body: {
          caller: "edge-health-probe",
          files: [
            { path: "probe-ok.ts", content: "export const x: number = 1;\n" },
            { path: "probe-bad.ts", content: "export const x: number = 'oops';\n" },
          ],
        },
      });
      if (error) throw error;
      const failed = (data as { results?: { status: string }[] })?.results?.filter((r) => r.status === "failed").length ?? 0;
      toast.success(`Lint probe ran: ${failed} failure(s) recorded`);
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Lint probe failed");
    } finally {
      setLintProbeBusy(false);
    }
  };

  const openDrawer = async (fn: string) => {
    setOpenFn(fn);
    const { data } = await supabase
      .from("edge_request_logs")
      .select("request_id,status,function_name,classified_error,error_message,user_id_hash,created_at")
      .eq("function_name", fn)
      .gte("status", 400)
      .gte("created_at", new Date(Date.now() - hours * 3600_000).toISOString())
      .order("created_at", { ascending: false })
      .limit(50);
    setDrawerRows((data as FailRow[]) ?? []);
  };

  const totals = useMemo(() => {
    return rows.reduce(
      (a, r) => ({ calls: a.calls + r.total, errors: a.errors + r.errors }),
      { calls: 0, errors: 0 },
    );
  }, [rows]);

  const sevColor = (rate: number | null, errors: number) => {
    if (errors === 0) return "secondary";
    if ((rate ?? 0) >= 0.2 || errors >= 10) return "destructive";
    return "default";
  };

  return (
    <div className="container mx-auto py-6 space-y-6">
      <div className="flex items-end justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold">Edge function health</h1>
          <p className="text-sm text-muted-foreground">
            Per-function calls, errors, latency and last failure from{" "}
            <code className="text-xs">edge_request_logs</code>. Browser-side network
            failures appear in the Client transport errors panel.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {HOUR_OPTIONS.map((h) => (
            <Button
              key={h}
              size="sm"
              variant={hours === h ? "default" : "outline"}
              onClick={() => setHours(h)}
            >
              {h}h
            </Button>
          ))}
          <Button size="sm" variant="ghost" onClick={load} disabled={loading}>
            <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
          </Button>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            Last {hours}h — {totals.calls.toLocaleString()} calls, {totals.errors} server errors
            {fetchedAt && (
              <span className="text-xs font-normal text-muted-foreground ml-2">
                refreshed {formatDistanceToNow(fetchedAt, { addSuffix: true })}
              </span>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-xs uppercase text-muted-foreground border-b">
                <tr>
                  <th className="text-left px-4 py-2">Function</th>
                  <th className="text-right px-4 py-2">Calls</th>
                  <th className="text-right px-4 py-2">Errors</th>
                  <th className="text-right px-4 py-2">Rate</th>
                  <th className="text-right px-4 py-2">p95 ms</th>
                  <th className="text-left px-4 py-2">Last error</th>
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 && !loading && (
                  <tr><td colSpan={6} className="px-4 py-6 text-center text-muted-foreground">
                    No traffic in the selected window.
                  </td></tr>
                )}
                {rows.map((r) => (
                  <tr
                    key={r.function_name}
                    className="border-b hover:bg-muted/30 cursor-pointer"
                    onClick={() => r.errors > 0 && openDrawer(r.function_name)}
                  >
                    <td className="px-4 py-2 font-mono text-xs">{r.function_name}</td>
                    <td className="px-4 py-2 text-right tabular-nums">{r.total}</td>
                    <td className="px-4 py-2 text-right tabular-nums">
                      <Badge variant={sevColor(r.error_rate, r.errors)}>{r.errors}</Badge>
                    </td>
                    <td className="px-4 py-2 text-right tabular-nums">
                      {r.error_rate == null ? "—" : `${(Number(r.error_rate) * 100).toFixed(1)}%`}
                    </td>
                    <td className="px-4 py-2 text-right tabular-nums">
                      {r.p95_latency_ms ?? "—"}
                    </td>
                    <td className="px-4 py-2 text-xs text-muted-foreground">
                      {r.last_error_at ? (
                        <>
                          <span className="text-foreground">{r.last_error_status}</span>{" "}
                          {r.last_error_class && <span>[{r.last_error_class}] </span>}
                          {r.last_error_message?.slice(0, 90)}
                          <span className="ml-1 opacity-60">
                            · {formatDistanceToNow(new Date(r.last_error_at), { addSuffix: true })}
                          </span>
                        </>
                      ) : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <AlertTriangle className="h-4 w-4" />
            Client transport errors ({client.length})
          </CardTitle>
        </CardHeader>
        <CardContent>
          {client.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No browser-side network failures captured in the last {hours}h.
            </p>
          ) : (
            <ul className="space-y-2 text-sm">
              {client.map((c, i) => (
                <li key={i} className="border rounded p-2">
                  <div className="flex justify-between gap-2 text-xs text-muted-foreground">
                    <span className="font-mono">{c.function_name ?? "(unknown)"}</span>
                    <span>{formatDistanceToNow(new Date(c.created_at), { addSuffix: true })}</span>
                  </div>
                  <div className="text-foreground">{c.message}</div>
                  {c.url && <div className="text-xs text-muted-foreground truncate">{c.url}</div>}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Sheet open={!!openFn} onOpenChange={(o) => !o && setOpenFn(null)}>
        <SheetContent className="w-[min(720px,100vw)] sm:max-w-none overflow-y-auto">
          <SheetHeader>
            <SheetTitle className="font-mono text-base">{openFn}</SheetTitle>
          </SheetHeader>
          <div className="mt-4 space-y-2">
            {drawerRows.map((r, i) => (
              <div key={i} className="border rounded p-2 text-sm">
                <div className="flex justify-between text-xs text-muted-foreground">
                  <span>
                    <Badge variant="destructive" className="mr-2">{r.status}</Badge>
                    {r.classified_error && <span>[{r.classified_error}]</span>}
                  </span>
                  <span>{formatDistanceToNow(new Date(r.created_at), { addSuffix: true })}</span>
                </div>
                <div className="font-mono text-xs mt-1 break-words">
                  {r.error_message ?? "(no message)"}
                </div>
                <div className="text-xs text-muted-foreground mt-1">
                  req {r.request_id ?? "—"} · user {r.user_id_hash ?? "—"}
                </div>
              </div>
            ))}
            {drawerRows.length === 0 && (
              <p className="text-sm text-muted-foreground">No failing rows in the window.</p>
            )}
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}
