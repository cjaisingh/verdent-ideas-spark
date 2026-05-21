import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

type Row = {
  id: string;
  surface_kind: string;
  surface_id: string;
  expected_cadence_minutes: number | null;
  watcher_kinds: string[] | null;
  owner: string | null;
  declared_in: string | null;
  notes: string | null;
};

type Activity = { surface_id: string; last_seen: string | null };

function pill(status: "ok" | "stale" | "missing-watcher" | "unknown") {
  const variants: Record<string, "default" | "destructive" | "secondary" | "outline"> = {
    ok: "default",
    stale: "destructive",
    "missing-watcher": "destructive",
    unknown: "secondary",
  };
  return <Badge variant={variants[status]}>{status}</Badge>;
}

export default function AdminObservabilityRegistry() {
  const [rows, setRows] = useState<Row[]>([]);
  const [activity, setActivity] = useState<Record<string, string | null>>({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const { data: reg } = await supabase
        .from("observability_registry")
        .select("*")
        .order("surface_kind")
        .order("surface_id");
      setRows((reg ?? []) as Row[]);

      // last_seen for crons from automation_runs, for fns from edge_request_logs
      const cronIds = (reg ?? []).filter((r: Row) => r.surface_kind === "cron").map((r: Row) => r.surface_id);
      const fnIds = (reg ?? []).filter((r: Row) => r.surface_kind === "edge_fn" || r.surface_kind === "function").map((r: Row) => r.surface_id);
      const acc: Record<string, string | null> = {};

      if (cronIds.length) {
        const { data } = await supabase
          .from("automation_runs")
          .select("job, created_at")
          .in("job", cronIds)
          .order("created_at", { ascending: false })
          .limit(5000);
        (data ?? []).forEach((r: { job: string; created_at: string }) => {
          if (!acc[r.job]) acc[r.job] = r.created_at;
        });
      }
      if (fnIds.length) {
        const { data } = await supabase
          .from("edge_request_logs")
          .select("function_name, created_at")
          .in("function_name", fnIds)
          .order("created_at", { ascending: false })
          .limit(5000);
        (data ?? []).forEach((r: { function_name: string; created_at: string }) => {
          if (!acc[r.function_name]) acc[r.function_name] = r.created_at;
        });
      }
      setActivity(acc);
      setLoading(false);
    })();
  }, []);

  const enriched = useMemo(() => {
    return rows.map((r) => {
      const last = activity[r.surface_id] ?? null;
      const hasWatchers = (r.watcher_kinds?.length ?? 0) > 0;
      let status: "ok" | "stale" | "missing-watcher" | "unknown" = "unknown";
      if (!hasWatchers) status = "missing-watcher";
      else if (last && r.expected_cadence_minutes) {
        const ageMin = (Date.now() - new Date(last).getTime()) / 60_000;
        status = ageMin > r.expected_cadence_minutes * 3 ? "stale" : "ok";
      } else if (!last) status = "stale";
      return { ...r, last_seen: last, status };
    }).sort((a, b) => {
      const order = { "missing-watcher": 0, stale: 1, unknown: 2, ok: 3 } as const;
      if (order[a.status] !== order[b.status]) return order[a.status] - order[b.status];
      return (a.last_seen ?? "").localeCompare(b.last_seen ?? "");
    });
  }, [rows, activity]);

  const missingCount = enriched.filter((r) => r.status === "missing-watcher").length;
  const staleCount = enriched.filter((r) => r.status === "stale").length;
  const hasAlerts = missingCount + staleCount > 0;

  return (
    <div className="container mx-auto py-8 space-y-6">
      <div>
        <h1 className="text-3xl font-bold">Observability Registry</h1>
        <p className="text-muted-foreground mt-1">
          Read-only inventory of monitored surfaces. Declared in migrations under <code>observability_registry</code>.
        </p>
      </div>
      {hasAlerts && (
        <Card className="border-destructive bg-destructive/10">
          <CardContent className="py-4 flex items-center justify-between gap-4">
            <div className="text-sm">
              <span className="font-semibold text-destructive">Watcher gaps detected.</span>{" "}
              {missingCount > 0 && (
                <span>{missingCount} surface{missingCount === 1 ? "" : "s"} have <strong>no watcher</strong> (sentinel <code>observability_missing_watcher</code>, high). </span>
              )}
              {staleCount > 0 && (
                <span>{staleCount} surface{staleCount === 1 ? "" : "s"} are <strong>stale</strong> (sentinel <code>observability_stale_surface</code>, medium).</span>
              )}
            </div>
            <Badge variant="destructive">{missingCount + staleCount} open</Badge>
          </CardContent>
        </Card>
      )}
      <Card>
        <CardHeader>
          <CardTitle>{loading ? "Loading…" : `${enriched.length} surfaces`}</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Status</TableHead>
                <TableHead>Kind</TableHead>
                <TableHead>Surface</TableHead>
                <TableHead>Cadence (min)</TableHead>
                <TableHead>Watchers</TableHead>
                <TableHead>Owner</TableHead>
                <TableHead>Last seen</TableHead>
                <TableHead>Declared in</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {enriched.map((r) => (
                <TableRow key={r.id}>
                  <TableCell>{pill(r.status)}</TableCell>
                  <TableCell className="font-mono text-xs">{r.surface_kind}</TableCell>
                  <TableCell className="font-mono text-xs">{r.surface_id}</TableCell>
                  <TableCell>{r.expected_cadence_minutes ?? "—"}</TableCell>
                  <TableCell className="font-mono text-xs">{r.watcher_kinds?.join(", ") || "—"}</TableCell>
                  <TableCell>{r.owner ?? "—"}</TableCell>
                  <TableCell className="text-xs">{r.last_seen ? new Date(r.last_seen).toISOString().slice(0, 16).replace("T", " ") : "—"}</TableCell>
                  <TableCell className="text-xs">{r.declared_in ?? "—"}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
