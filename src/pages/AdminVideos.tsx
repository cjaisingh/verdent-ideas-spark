import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { RefreshCw, Video, Sparkles, AlertTriangle, RotateCcw } from "lucide-react";
import { GenerateVideoDialog } from "@/components/heygen/GenerateVideoDialog";
import { toast } from "sonner";
import { formatDistanceToNow } from "date-fns";

type Row = {
  id: string;
  kind: "quarterly_recap" | "external_pitch";
  title: string;
  script: string;
  status: "queued" | "processing" | "ready" | "failed";
  heygen_video_id: string | null;
  video_url: string | null;
  thumbnail_url: string | null;
  duration_s: number | null;
  error: string | null;
  created_at: string;
};

const statusTone = (s: Row["status"]) =>
  s === "ready" ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-500/30"
  : s === "failed" ? "bg-destructive/10 text-destructive border-destructive/30"
  : s === "processing" ? "bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-500/30"
  : "bg-muted text-muted-foreground border-border";

export default function AdminVideos() {
  const [rows, setRows] = useState<Row[]>([]);
  const [used, setUsed] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [dialogKind, setDialogKind] = useState<Row["kind"] | null>(null);
  const [polling, setPolling] = useState(false);
  const [retryingId, setRetryingId] = useState<string | null>(null);
  const channelName = useMemo(() => `heygen_videos:${crypto.randomUUID()}`, []);

  const load = async () => {
    setLoading(true);
    const [r, q] = await Promise.all([
      supabase.from("heygen_videos" as any).select("*").order("created_at", { ascending: false }).limit(50),
      supabase.from("heygen_videos_month_count" as any).select("used").maybeSingle(),
    ]);
    setRows(((r.data ?? []) as unknown) as Row[]);
    setUsed((q.data as any)?.used ?? 0);
    setLoading(false);
  };

  useEffect(() => {
    load();
    const ch = supabase.channel(channelName)
      .on("postgres_changes", { event: "*", schema: "public", table: "heygen_videos" }, () => load())
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [channelName]);

  const refreshStatus = async () => {
    setPolling(true);
    try {
      const { data, error } = await supabase.functions.invoke("heygen-poll-video", { body: {} });
      if (error) throw error;
      const r = data as { polled?: number; ready?: number; failed?: number };
      toast.success(`Polled ${r?.polled ?? 0} (ready: ${r?.ready ?? 0}, failed: ${r?.failed ?? 0})`);
      await load();
    } catch (e: any) {
      toast.error(`Poll failed: ${e?.message ?? e}`);
    } finally {
      setPolling(false);
    }
  };

  const retryFailed = async (row: Row) => {
    if (quotaFull) {
      toast.error("Monthly quota reached (3/3). Cannot retry until next month.");
      return;
    }
    setRetryingId(row.id);
    try {
      const { data, error } = await supabase.functions.invoke("heygen-create-video", {
        body: { kind: row.kind, title: row.title, script: row.script },
      });
      if (error) throw error;
      const r = data as { id?: string; heygen_video_id?: string; error?: string };
      if (r?.error) throw new Error(r.error);
      toast.success("Re-queued — new row created, polling will pick it up.");
      await load();
    } catch (e: any) {
      toast.error(`Retry failed: ${e?.message ?? e}`);
    } finally {
      setRetryingId(null);
    }
  };

  const quotaFull = (used ?? 0) >= 3;

  return (
    <div className="container py-6 max-w-6xl">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-semibold flex items-center gap-2">
            <Video className="h-6 w-6" /> HeyGen videos
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Generate quarterly recaps and external pitch videos. Free plan: 3 / month, ≤60s each.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant="outline" className={quotaFull ? "border-destructive text-destructive" : ""}>
            {used ?? "…"} / 3 used this month
          </Badge>
          <Button variant="outline" size="sm" onClick={refreshStatus} disabled={polling}>
            <RefreshCw className={`h-4 w-4 mr-1 ${polling ? "animate-spin" : ""}`} />
            Refresh status
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Sparkles className="h-4 w-4" /> Quarterly recap
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-sm text-muted-foreground">
              60-second narration of the latest quarterly review action, auto-synthesised via Lovable AI.
            </p>
            <Button onClick={() => setDialogKind("quarterly_recap")} disabled={quotaFull}>
              Generate quarterly recap
            </Button>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Sparkles className="h-4 w-4" /> External pitch
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-sm text-muted-foreground">
              60-second AWIP Core explainer for sharing externally. Hand-written script, editable before submit.
            </p>
            <Button onClick={() => setDialogKind("external_pitch")} disabled={quotaFull}>
              Generate external pitch
            </Button>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">All videos</CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : rows.length === 0 ? (
            <p className="text-sm text-muted-foreground">No videos yet.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Title</TableHead>
                  <TableHead>Kind</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Duration</TableHead>
                  <TableHead>Created</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell className="font-medium">{row.title}</TableCell>
                    <TableCell>
                      <span className="text-xs text-muted-foreground">
                        {row.kind === "quarterly_recap" ? "quarterly" : "pitch"}
                      </span>
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className={statusTone(row.status)}>{row.status}</Badge>
                      {row.error && (
                        <div className="text-xs text-destructive mt-1 flex items-start gap-1 max-w-xs">
                          <AlertTriangle className="h-3 w-3 mt-0.5 shrink-0" />
                          <span className="truncate" title={row.error}>{row.error}</span>
                        </div>
                      )}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {row.duration_s ? `${row.duration_s.toFixed(1)}s` : "—"}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {formatDistanceToNow(new Date(row.created_at), { addSuffix: true })}
                    </TableCell>
                    <TableCell className="text-right">
                      {row.video_url ? (
                        <Button asChild size="sm" variant="outline">
                          <a href={row.video_url} target="_blank" rel="noreferrer">Watch</a>
                        </Button>
                      ) : null}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {dialogKind && (
        <GenerateVideoDialog
          open={!!dialogKind}
          onOpenChange={(o) => !o && setDialogKind(null)}
          kind={dialogKind}
          onCreated={load}
        />
      )}
    </div>
  );
}
