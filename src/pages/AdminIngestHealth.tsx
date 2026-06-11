import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { RefreshCw, FileText, AlertTriangle, CheckCircle2, Clock } from "lucide-react";

type FileRow = {
  id: string;
  engagement_id: string | null;
  domain_id: string | null;
  filename: string;
  mime: string;
  size_bytes: number;
  status: string;
  parser: string | null;
  source: string;
  cad_fm: boolean;
  attempts: number;
  failure_reason: string | null;
  last_heartbeat_at: string | null;
  created_at: string;
};

type StatusCount = { status: string; count: number };

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { variant: "default" | "outline" | "destructive" | "secondary"; cls?: string; icon: typeof FileText }> = {
    parsed: { variant: "outline", cls: "border-emerald-500/40 text-emerald-600 dark:text-emerald-400", icon: CheckCircle2 },
    metadata_only: { variant: "outline", cls: "border-blue-500/40 text-blue-600 dark:text-blue-400", icon: FileText },
    pending: { variant: "outline", cls: "border-amber-500/40 text-amber-600 dark:text-amber-400", icon: Clock },
    parsing: { variant: "outline", cls: "border-amber-500/40 text-amber-600 dark:text-amber-400", icon: Clock },
    failed: { variant: "destructive", icon: AlertTriangle },
    superseded: { variant: "secondary", icon: FileText },
  };
  const cfg = map[status] ?? { variant: "outline" as const, icon: FileText };
  const Icon = cfg.icon;
  return (
    <Badge variant={cfg.variant} className={cfg.cls}>
      <Icon className="h-3 w-3 mr-1" /> {status}
    </Badge>
  );
}

function fmtBytes(n: number) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

export default function AdminIngestHealth() {
  const [files, setFiles] = useState<FileRow[]>([]);
  const [counts, setCounts] = useState<StatusCount[]>([]);
  const [loading, setLoading] = useState(false);

  async function load() {
    setLoading(true);
    const [recent, agg] = await Promise.all([
      supabase
        .from("ingested_files")
        .select("id, engagement_id, domain_id, filename, mime, size_bytes, status, parser, source, cad_fm, attempts, failure_reason, last_heartbeat_at, created_at")
        .order("created_at", { ascending: false })
        .limit(100),
      supabase
        .from("ingested_files")
        .select("status"),
    ]);
    setFiles((recent.data ?? []) as FileRow[]);
    const c: Record<string, number> = {};
    for (const r of agg.data ?? []) c[r.status] = (c[r.status] ?? 0) + 1;
    setCounts(Object.entries(c).map(([status, count]) => ({ status, count })).sort((a, b) => b.count - a.count));
    setLoading(false);
  }

  useEffect(() => {
    load();
    const ch = supabase
      .channel(`admin-ingest-health-${crypto.randomUUID()}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "ingested_files" }, () => load())
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, []);

  const stuck = files.filter(f => f.status === "parsing" && f.last_heartbeat_at && (Date.now() - new Date(f.last_heartbeat_at).getTime()) > 15 * 60 * 1000);
  const failed = files.filter(f => f.status === "failed");

  return (
    <div className="container mx-auto p-6 max-w-6xl">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-3xl font-bold">Ingest Health</h1>
          <p className="text-muted-foreground mt-1">Client file ingestion pipeline — markitdown sidecar + GHA bulk worker.</p>
        </div>
        <Button onClick={load} variant="outline" size="sm" disabled={loading}>
          <RefreshCw className={`h-4 w-4 mr-2 ${loading ? "animate-spin" : ""}`} />
          Refresh
        </Button>
      </div>

      {(stuck.length > 0 || failed.length > 0) && (
        <div className="mb-6 p-4 border border-amber-500/40 bg-amber-500/10 rounded-md">
          <div className="flex items-center gap-2 font-medium text-amber-700 dark:text-amber-400">
            <AlertTriangle className="h-4 w-4" />
            {stuck.length} parsing &gt;15min · {failed.length} failed
          </div>
        </div>
      )}

      <div className="grid grid-cols-2 md:grid-cols-6 gap-3 mb-6">
        {counts.map(c => (
          <div key={c.status} className="border rounded-md p-3">
            <div className="text-xs text-muted-foreground">{c.status}</div>
            <div className="text-2xl font-semibold">{c.count}</div>
          </div>
        ))}
      </div>

      <div className="border rounded-md overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-muted/50">
            <tr className="text-left">
              <th className="p-2">File</th>
              <th className="p-2">Status</th>
              <th className="p-2">Parser</th>
              <th className="p-2">Source</th>
              <th className="p-2">Size</th>
              <th className="p-2">Engagement</th>
              <th className="p-2">When</th>
            </tr>
          </thead>
          <tbody>
            {files.length === 0 && (
              <tr><td colSpan={7} className="p-4 text-center text-muted-foreground">No files ingested yet.</td></tr>
            )}
            {files.map(f => (
              <tr key={f.id} className="border-t">
                <td className="p-2">
                  <div className="font-medium">{f.filename}</div>
                  <div className="text-xs text-muted-foreground">{f.mime}{f.cad_fm ? " · CAD/FM" : ""}</div>
                  {f.failure_reason && <div className="text-xs text-destructive mt-1">{f.failure_reason}</div>}
                </td>
                <td className="p-2"><StatusBadge status={f.status} /></td>
                <td className="p-2 text-xs">{f.parser ?? "—"}</td>
                <td className="p-2 text-xs">{f.source}</td>
                <td className="p-2 text-xs">{fmtBytes(f.size_bytes)}</td>
                <td className="p-2 text-xs font-mono">{f.engagement_id?.slice(0, 8) ?? "—"}</td>
                <td className="p-2 text-xs text-muted-foreground">{new Date(f.created_at).toLocaleString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="mt-6 text-xs text-muted-foreground">
        <p>v1 scope: CAD/FM files (DWG, RVT, IFC, etc.) are stored + indexed metadata-only; geometry adapters reserved for W9.2.</p>
        <p>Sidecar host + adapter set are tracked as separate discussion_actions. See <code>docs/features/ingestion.md</code>.</p>
      </div>
    </div>
  );
}
