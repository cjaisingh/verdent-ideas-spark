import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

type Row = {
  owning_module: string;
  cap_count: number;
  last_heartbeat_at: string | null;
  age_h: number | null;
};

function freshness(ageH: number | null): { label: string; variant: "default" | "destructive" | "secondary" } {
  if (ageH === null) return { label: "no heartbeat", variant: "destructive" };
  if (ageH < 24) return { label: "fresh", variant: "default" };
  if (ageH < 72) return { label: "stale", variant: "secondary" };
  return { label: "silent", variant: "destructive" };
}

export default function AdminModules() {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const { data: caps } = await supabase
        .from("capabilities")
        .select("owning_module")
        .not("owning_module", "is", null);

      const counts = new Map<string, number>();
      for (const c of (caps ?? []) as { owning_module: string | null }[]) {
        if (!c.owning_module) continue;
        counts.set(c.owning_module, (counts.get(c.owning_module) ?? 0) + 1);
      }
      const modules = Array.from(counts.keys());

      const lastSeen = new Map<string, string>();
      if (modules.length) {
        const { data: hbs } = await supabase
          .from("module_heartbeats")
          .select("owning_module, created_at")
          .in("owning_module", modules)
          .order("created_at", { ascending: false })
          .limit(1000);
        for (const h of (hbs ?? []) as { owning_module: string; created_at: string }[]) {
          if (!lastSeen.has(h.owning_module)) lastSeen.set(h.owning_module, h.created_at);
        }
      }

      const now = Date.now();
      const out: Row[] = modules.map((m) => {
        const last = lastSeen.get(m) ?? null;
        const ageH = last ? Math.round((now - new Date(last).getTime()) / 3_600_000) : null;
        return { owning_module: m, cap_count: counts.get(m) ?? 0, last_heartbeat_at: last, age_h: ageH };
      }).sort((a, b) => a.owning_module.localeCompare(b.owning_module));

      setRows(out);
      setLoading(false);
    })();
  }, []);

  return (
    <div className="container mx-auto py-8 space-y-6">
      <div>
        <h1 className="text-3xl font-bold">Modules</h1>
        <p className="text-muted-foreground mt-1">
          Live registry of modules that own at least one capability. Each module is expected to send
          a heartbeat to <code>/modules/heartbeat</code> at least once every 24h. Findings of kind
          <code> module_silent_24h</code> open when this contract is breached.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Owning modules ({rows.length})</CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <p className="text-muted-foreground">Loading…</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Module</TableHead>
                  <TableHead>Capabilities</TableHead>
                  <TableHead>Last heartbeat</TableHead>
                  <TableHead>Age</TableHead>
                  <TableHead>Freshness</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => {
                  const f = freshness(r.age_h);
                  return (
                    <TableRow key={r.owning_module}>
                      <TableCell className="font-mono">{r.owning_module}</TableCell>
                      <TableCell>{r.cap_count}</TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {r.last_heartbeat_at ? new Date(r.last_heartbeat_at).toLocaleString() : "—"}
                      </TableCell>
                      <TableCell>{r.age_h === null ? "—" : `${r.age_h}h`}</TableCell>
                      <TableCell><Badge variant={f.variant}>{f.label}</Badge></TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
