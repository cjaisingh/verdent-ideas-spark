// Small W1 (Logger Agent) status panel for /plan.
// Shows whether the workstream is complete and the most recent
// alert dispatcher event recorded in public.alert_log.
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { CheckCircle2, Loader2, AlertCircle } from "lucide-react";

const W1_ID = "5be947f5-4db4-43bb-a575-3342531cc82f";

type AlertRow = {
  id: string;
  created_at: string;
  job: string;
  reason: string;
  message: string;
  delivered: boolean;
  status_code: number | null;
};

type WsRow = { status: string; updated_at: string };

export const W1StatusPanel = () => {
  const [ws, setWs] = useState<WsRow | null>(null);
  const [last, setLast] = useState<AlertRow | null>(null);
  const [count24h, setCount24h] = useState<number>(0);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    const since = new Date(Date.now() - 24 * 60 * 60_000).toISOString();
    const [w, l, c] = await Promise.all([
      supabase.from("plan_workstreams").select("status,updated_at").eq("id", W1_ID).maybeSingle(),
      supabase.from("alert_log")
        .select("id,created_at,job,reason,message,delivered,status_code")
        .order("created_at", { ascending: false }).limit(1).maybeSingle(),
      supabase.from("alert_log").select("id", { count: "exact", head: true }).gte("created_at", since),
    ]);
    setWs((w.data as WsRow | null) ?? null);
    setLast((l.data as AlertRow | null) ?? null);
    setCount24h(c.count ?? 0);
    setLoading(false);
  };

  useEffect(() => {
    load();
    const ch = supabase.channel("w1-status")
      .on("postgres_changes", { event: "*", schema: "public", table: "alert_log" }, load)
      .on("postgres_changes", { event: "*", schema: "public", table: "plan_workstreams", filter: `id=eq.${W1_ID}` }, load)
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, []);

  const done = ws?.status === "done";
  const StatusIcon = done ? CheckCircle2 : ws?.status === "blocked" ? AlertCircle : Loader2;
  const tone = done ? "text-emerald-500" : ws?.status === "blocked" ? "text-destructive" : "text-muted-foreground";

  return (
    <Card className="p-3 space-y-2">
      <div className="flex items-center gap-2">
        <StatusIcon className={`h-4 w-4 ${tone} ${!done && ws?.status !== "blocked" ? "animate-spin" : ""}`} />
        <h3 className="text-sm font-semibold">W1 · Logger Agent</h3>
        <Badge variant={done ? "default" : "secondary"} className="text-[10px] uppercase">
          {ws?.status ?? (loading ? "…" : "unknown")}
        </Badge>
        <span className="ml-auto text-[10px] text-muted-foreground">
          {count24h} alert{count24h === 1 ? "" : "s"} dispatched in 24h
        </span>
      </div>

      {last ? (
        <div className="text-xs space-y-0.5 border-l-2 border-border pl-2">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-mono text-[10px] text-muted-foreground">{new Date(last.created_at).toLocaleString()}</span>
            <Badge variant="outline" className="text-[9px]">{last.job}</Badge>
            <Badge variant="outline" className="text-[9px]">{last.reason}</Badge>
            <Badge variant={last.delivered ? "default" : "secondary"} className="text-[9px]">
              {last.delivered ? `delivered${last.status_code ? ` ${last.status_code}` : ""}` : "logged only"}
            </Badge>
          </div>
          <p className="text-muted-foreground line-clamp-2">{last.message}</p>
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">
          {loading ? "Loading…" : "No alert dispatcher events recorded yet — pipeline is wired but quiet."}
        </p>
      )}
    </Card>
  );
};
