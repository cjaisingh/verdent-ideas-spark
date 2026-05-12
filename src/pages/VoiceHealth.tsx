import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { RefreshCw, Mic, Volume2, Radio, AlertCircle } from "lucide-react";
import { formatDistanceToNow } from "date-fns";

type Component = {
  key: "tts" | "browser" | "telegram";
  label: string;
  fn: string;
  icon: typeof Mic;
  description: string;
};

const COMPONENTS: Component[] = [
  { key: "tts", label: "TTS (Gemini)", fn: "gemini-tts", icon: Volume2, description: "Server-synthesized speech." },
  { key: "browser", label: "Transport — browser", fn: "companion-cloud-chat", icon: Radio, description: "/companion chat round-trip." },
  { key: "telegram", label: "Transport — Telegram voice", fn: "telegram-send-voice", icon: Radio, description: "Telegram voice delivery." },
];

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
  status: number | null;
  function_name: string;
  classified_error: string | null;
  error_message: string | null;
  created_at: string;
};

type Band = "green" | "amber" | "red" | "idle";

function classify(h: Health | undefined, lastSuccess: string | null): Band {
  if (!h || h.total === 0) {
    // Idle if we've never seen a call. Red if we previously did but no success in 60m.
    if (lastSuccess && Date.now() - +new Date(lastSuccess) > 60 * 60_000) return "red";
    return "idle";
  }
  const rate = h.error_rate ?? 0;
  const noSuccess = !lastSuccess || Date.now() - +new Date(lastSuccess) > 60 * 60_000;
  if (rate > 0.1 || noSuccess) return "red";
  if (rate >= 0.02) return "amber";
  return "green";
}

const bandStyle: Record<Band, string> = {
  green: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border-emerald-500/30",
  amber: "bg-amber-500/15 text-amber-700 dark:text-amber-400 border-amber-500/30",
  red: "bg-destructive/15 text-destructive border-destructive/30",
  idle: "bg-muted text-muted-foreground border-border",
};

export default function VoiceHealth() {
  const [rows, setRows] = useState<Health[]>([]);
  const [lastSuccess, setLastSuccess] = useState<Record<string, string | null>>({});
  const [recentErrors, setRecentErrors] = useState<FailRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [fetchedAt, setFetchedAt] = useState<Date | null>(null);

  const load = async () => {
    setLoading(true);
    const since = new Date(Date.now() - 3600_000).toISOString();
    const fns = COMPONENTS.map((c) => c.fn);

    const [{ data: health }, { data: errs }, ...successQueries] = await Promise.all([
      supabase.rpc("edge_function_health", { _hours: 1 }),
      supabase
        .from("edge_request_logs")
        .select("status,function_name,classified_error,error_message,created_at")
        .in("function_name", fns)
        .gte("status", 400)
        .gte("created_at", since)
        .order("created_at", { ascending: false })
        .limit(50),
      ...fns.map((fn) =>
        supabase
          .from("edge_request_logs")
          .select("created_at")
          .eq("function_name", fn)
          .lt("status", 400)
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle(),
      ),
    ]);

    setRows(((health as Health[]) ?? []).filter((h) => fns.includes(h.function_name)));
    setRecentErrors((errs as FailRow[]) ?? []);
    const succ: Record<string, string | null> = {};
    fns.forEach((fn, i) => {
      const r = successQueries[i] as { data: { created_at: string } | null };
      succ[fn] = r.data?.created_at ?? null;
    });
    setLastSuccess(succ);
    setFetchedAt(new Date());
    setLoading(false);
  };

  useEffect(() => {
    load();
    const id = setInterval(load, 30_000);
    const ch = supabase
      .channel("voice-health-edge-logs")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "edge_request_logs" },
        () => load(),
      )
      .subscribe();
    return () => {
      clearInterval(id);
      supabase.removeChannel(ch);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const byFn = useMemo(() => {
    const m: Record<string, Health> = {};
    rows.forEach((r) => (m[r.function_name] = r));
    return m;
  }, [rows]);

  return (
    <div className="container mx-auto py-6 space-y-6">
      <div className="flex items-end justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold">Voice pipeline health</h1>
          <p className="text-sm text-muted-foreground">
            STT, TTS and transport status from <code className="text-xs">edge_request_logs</code>.
            Bands: green &lt;2% errors / amber 2–10% / red &gt;10% or no success in 60min (1h window).
          </p>
        </div>
        <div className="flex items-center gap-2">
          {fetchedAt && (
            <span className="text-xs text-muted-foreground">
              refreshed {formatDistanceToNow(fetchedAt, { addSuffix: true })}
            </span>
          )}
          <Button size="sm" variant="ghost" onClick={load} disabled={loading}>
            <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
          </Button>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {COMPONENTS.map((c) => {
          const h = byFn[c.fn];
          const ls = lastSuccess[c.fn] ?? null;
          const band = classify(h, ls);
          const Icon = c.icon;
          return (
            <Card key={c.key} className={`border ${bandStyle[band]}`}>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium flex items-center gap-2">
                  <Icon className="h-4 w-4" />
                  {c.label}
                  <Badge variant="outline" className="ml-auto uppercase text-[10px]">
                    {band}
                  </Badge>
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-1 text-xs">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Calls / errors</span>
                  <span className="tabular-nums">
                    {h?.total ?? 0} / {h?.errors ?? 0}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Error rate</span>
                  <span className="tabular-nums">
                    {h?.error_rate == null ? "—" : `${(h.error_rate * 100).toFixed(1)}%`}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">p95 latency</span>
                  <span className="tabular-nums">{h?.p95_latency_ms ?? "—"} ms</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Last success</span>
                  <span>
                    {ls ? formatDistanceToNow(new Date(ls), { addSuffix: true }) : "never"}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Last error</span>
                  <span>
                    {h?.last_error_at
                      ? formatDistanceToNow(new Date(h.last_error_at), { addSuffix: true })
                      : "—"}
                  </span>
                </div>
                <p className="pt-2 text-[11px] text-muted-foreground">{c.description}</p>
              </CardContent>
            </Card>
          );
        })}

        <Card className={`border ${bandStyle.idle}`}>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <Mic className="h-4 w-4" />
              STT (browser)
              <Badge variant="outline" className="ml-auto uppercase text-[10px]">n/a</Badge>
            </CardTitle>
          </CardHeader>
          <CardContent className="text-xs text-muted-foreground space-y-2">
            <p>
              Browser Web Speech runs locally and leaves no server trace. To monitor STT,
              wire calls through a beacon or switch to a server STT provider.
            </p>
            <p className="text-[11px]">
              Validate end-to-end via the{" "}
              <a href="/voice-setup" className="underline">Voice setup wizard</a>.
            </p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <AlertCircle className="h-4 w-4" />
            Recent errors (last 1h, {recentErrors.length})
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {recentErrors.length === 0 ? (
            <p className="px-4 py-6 text-sm text-center text-muted-foreground">
              No voice-pipeline errors in the last hour.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-xs uppercase text-muted-foreground border-b">
                  <tr>
                    <th className="text-left px-4 py-2">When</th>
                    <th className="text-left px-4 py-2">Function</th>
                    <th className="text-right px-4 py-2">Status</th>
                    <th className="text-left px-4 py-2">Class</th>
                    <th className="text-left px-4 py-2">Message</th>
                  </tr>
                </thead>
                <tbody>
                  {recentErrors.map((r, i) => (
                    <tr key={i} className="border-b">
                      <td className="px-4 py-2 text-xs text-muted-foreground whitespace-nowrap">
                        {formatDistanceToNow(new Date(r.created_at), { addSuffix: true })}
                      </td>
                      <td className="px-4 py-2 font-mono text-xs">{r.function_name}</td>
                      <td className="px-4 py-2 text-right">
                        <Badge variant="destructive">{r.status}</Badge>
                      </td>
                      <td className="px-4 py-2 text-xs">{r.classified_error ?? "—"}</td>
                      <td className="px-4 py-2 text-xs break-words max-w-md">
                        {r.error_message?.slice(0, 200) ?? "(no message)"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
