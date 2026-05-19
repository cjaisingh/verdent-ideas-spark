import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";

type Row = {
  id: string;
  text: string | null;
  kind: string | null;
  kind_source: string | null;
  source: string | null;
  source_label: string | null;
  promoted_action_id: string | null;
  created_at: string;
};

const KIND_TONE: Record<string, string> = {
  idea: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
  research: "bg-sky-500/15 text-sky-700 dark:text-sky-300",
  suggestion: "bg-amber-500/15 text-amber-700 dark:text-amber-300",
  question: "bg-violet-500/15 text-violet-700 dark:text-violet-300",
  chat: "bg-muted text-muted-foreground",
};

export function OperatorInboxPanel() {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      const { data } = await supabase
        .from("v_operator_inbox_24h" as never)
        .select("*")
        .order("created_at", { ascending: false })
        .limit(10);
      if (!cancelled) {
        setRows((data ?? []) as Row[]);
        setLoading(false);
      }
    };
    load();
    const mountId = Math.random().toString(36).slice(2, 8);
    const ch = supabase
      .channel(`operator_inbox_panel_${mountId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "operator_messages" }, () => load())
      .subscribe();
    return () => {
      cancelled = true;
      supabase.removeChannel(ch);
    };
  }, []);

  const promoted = rows.filter((r) => r.promoted_action_id).length;
  const untriaged = rows.filter((r) => !r.kind).length;

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-base">Operator inbox (24h)</CardTitle>
        <Button asChild variant="ghost" size="sm">
          <Link to="/operator-inbox">Open inbox →</Link>
        </Button>
      </CardHeader>
      <CardContent className="space-y-2">
        <div className="flex gap-2 text-xs text-muted-foreground">
          <span>{rows.length} messages</span>
          <span>·</span>
          <span>{promoted} promoted</span>
          <span>·</span>
          <span>{untriaged} untriaged</span>
        </div>
        {loading ? (
          <div className="text-sm text-muted-foreground">Loading…</div>
        ) : rows.length === 0 ? (
          <div className="text-sm text-muted-foreground">No inbound messages in last 24h.</div>
        ) : (
          <div className="divide-y divide-border/40">
            {rows.map((r) => (
              <div key={r.id} className="flex items-start justify-between gap-3 py-2 text-sm">
                <div className="min-w-0 flex-1">
                  <div className="truncate">{r.text ?? <em className="text-muted-foreground">(no text)</em>}</div>
                  <div className="text-xs text-muted-foreground">
                    {r.source_label ?? r.source ?? "—"} · {new Date(r.created_at).toLocaleTimeString()}
                  </div>
                </div>
                <div className="flex flex-shrink-0 items-center gap-1">
                  {r.kind ? (
                    <Badge className={KIND_TONE[r.kind] ?? "bg-muted"}>{r.kind}</Badge>
                  ) : (
                    <Badge variant="outline">untriaged</Badge>
                  )}
                  {r.promoted_action_id ? <Badge variant="secondary">promoted</Badge> : null}
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export default OperatorInboxPanel;
