// Banner surfacing open sentinel findings for the local Ollama worker queue.
// Shows ai_jobs_stuck (>10min no heartbeat) and ai_workers_offline (>15min
// missing while queue non-empty) at the top of /admin/ai-jobs so operators
// don't have to bounce to /roadmap to notice queue rot.
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { AlertTriangle, ArrowUpRight } from "lucide-react";
import { Link } from "react-router-dom";

type Finding = {
  id: string;
  kind: string;
  severity: "info" | "low" | "medium" | "high" | "critical";
  summary: string;
  last_seen_at: string;
  payload: Record<string, any> | null;
};

const KINDS = ["ai_jobs_stuck", "ai_workers_offline"] as const;

const sevColor: Record<string, string> = {
  critical: "bg-destructive text-destructive-foreground",
  high: "bg-destructive/80 text-destructive-foreground",
  medium: "bg-amber-500 text-white",
  low: "bg-muted text-muted-foreground",
  info: "bg-muted text-muted-foreground",
};

export function AiJobsSentinelAlerts() {
  const [findings, setFindings] = useState<Finding[]>([]);

  const load = async () => {
    const { data } = await supabase
      .from("sentinel_findings")
      .select("id,kind,severity,summary,last_seen_at,payload")
      .eq("status", "open")
      .in("kind", KINDS as unknown as string[])
      .order("last_seen_at", { ascending: false });
    setFindings((data as Finding[]) ?? []);
  };

  useEffect(() => {
    load();
    const ch = supabase
      .channel(`ai-jobs-sentinel:${crypto.randomUUID()}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "sentinel_findings" },
        () => load(),
      )
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
  }, []);

  if (findings.length === 0) return null;

  return (
    <Alert variant="destructive">
      <AlertTriangle className="h-4 w-4" />
      <AlertTitle className="flex items-center justify-between gap-2">
        <span>Worker queue alerts ({findings.length})</span>
        <Button asChild size="sm" variant="ghost" className="h-7">
          <Link to="/roadmap#sentinel-status-strip">
            Open Sentinel <ArrowUpRight className="h-3 w-3 ml-1" />
          </Link>
        </Button>
      </AlertTitle>
      <AlertDescription>
        <ul className="space-y-1 mt-1">
          {findings.map((f) => (
            <li key={f.id} className="flex items-start gap-2 text-sm">
              <Badge className={sevColor[f.severity]}>{f.severity}</Badge>
              <span className="flex-1">{f.summary}</span>
              <span className="text-xs text-muted-foreground whitespace-nowrap">
                {new Date(f.last_seen_at).toLocaleTimeString()}
              </span>
            </li>
          ))}
        </ul>
      </AlertDescription>
    </Alert>
  );
}
