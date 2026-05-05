import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";

type LogRow = {
  id: string;
  created_at: string;
  route: string;
  method: string;
  actor: string | null;
  idempotency_key: string | null;
  idempotent_replay: boolean;
  status_code: number;
  duration_ms: number | null;
  tenant_id: string | null;
  request_summary: Record<string, unknown>;
  response_summary: Record<string, unknown>;
  error: string | null;
};

const ApiLogs = () => {
  const [rows, setRows] = useState<LogRow[]>([]);
  const [filter, setFilter] = useState<string>("all");
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    let q = supabase
      .from("api_call_logs")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(200);
    if (filter === "capabilities") q = q.eq("route", "/capabilities");
    if (filter === "ingest") q = q.eq("route", "/okr/ingest");
    const { data } = await q;
    setRows((data as LogRow[]) ?? []);
    setLoading(false);
  };

  useEffect(() => { load(); }, [filter]);

  const statusColor = (s: number) =>
    s >= 500 ? "destructive" : s >= 400 ? "secondary" : "default";

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">API call logs</h1>
          <p className="text-sm text-muted-foreground">
            Every call to the AWIP contract API, including Discovery AI traffic.
          </p>
        </div>
        <div className="flex gap-2">
          {[
            ["all", "All"],
            ["capabilities", "/capabilities"],
            ["ingest", "/okr/ingest"],
          ].map(([k, label]) => (
            <button
              key={k}
              onClick={() => setFilter(k)}
              className={`px-3 py-1.5 rounded-md text-sm border ${
                filter === k ? "bg-secondary border-border" : "border-border text-muted-foreground"
              }`}
            >
              {label}
            </button>
          ))}
          <button
            onClick={load}
            className="px-3 py-1.5 rounded-md text-sm border border-border"
          >
            Refresh
          </button>
        </div>
      </div>

      {loading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">No calls yet.</p>
      ) : (
        <div className="border border-border rounded-md divide-y divide-border">
          {rows.map((r) => (
            <div key={r.id} className="p-3 text-sm grid grid-cols-12 gap-3 items-start">
              <div className="col-span-2 text-muted-foreground font-mono text-xs">
                {new Date(r.created_at).toLocaleString()}
              </div>
              <div className="col-span-1 font-mono">{r.method}</div>
              <div className="col-span-2 font-mono">{r.route}</div>
              <div className="col-span-1">
                <Badge variant={statusColor(r.status_code) as any}>{r.status_code}</Badge>
              </div>
              <div className="col-span-1 text-muted-foreground">{r.duration_ms ?? "—"}ms</div>
              <div className="col-span-2 truncate" title={r.actor ?? ""}>
                {r.actor ?? <span className="text-muted-foreground">—</span>}
              </div>
              <div className="col-span-3 font-mono text-xs">
                {r.idempotency_key ? (
                  <div className="flex items-center gap-1">
                    <span className="truncate" title={r.idempotency_key}>
                      {r.idempotency_key.slice(0, 8)}…
                    </span>
                    {r.idempotent_replay && <Badge variant="outline">replay</Badge>}
                  </div>
                ) : (
                  <span className="text-muted-foreground">—</span>
                )}
              </div>
              {(Object.keys(r.response_summary || {}).length > 0 || r.error) && (
                <div className="col-span-12 mt-1 text-xs text-muted-foreground font-mono bg-muted/40 rounded p-2 overflow-x-auto">
                  {r.error ? (
                    <span className="text-destructive">error: {r.error}</span>
                  ) : (
                    JSON.stringify(r.response_summary)
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default ApiLogs;
