import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Moon, Loader2, Check, AlertTriangle, X } from "lucide-react";
import { format } from "date-fns";

interface RunRow {
  id: string;
  status: string;
  requested_at: string;
  started_at: string | null;
  finished_at: string | null;
  scheduled_for: string;
  model: string | null;
  result: any;
  error: string | null;
}

interface Props {
  phaseId: string;
}

const variantFor = (status: string): "default" | "secondary" | "outline" | "destructive" => {
  switch (status) {
    case "running": return "secondary";
    case "done": return "default";
    case "failed": return "destructive";
    default: return "outline";
  }
};

const iconFor = (status: string) => {
  switch (status) {
    case "running": return <Loader2 className="h-2.5 w-2.5 animate-spin" />;
    case "done": return <Check className="h-2.5 w-2.5" />;
    case "failed": return <AlertTriangle className="h-2.5 w-2.5" />;
    case "cancelled": return <X className="h-2.5 w-2.5" />;
    default: return <Moon className="h-2.5 w-2.5" />;
  }
};

export function OvernightRunBadge({ phaseId }: Props) {
  const [latest, setLatest] = useState<RunRow | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let active = true;
    const load = async () => {
      const { data } = await supabase
        .from("roadmap_phase_overnight_runs")
        .select("id, status, requested_at, started_at, finished_at, scheduled_for, model, result, error")
        .eq("phase_id", phaseId)
        .order("requested_at", { ascending: false })
        .limit(1);
      if (!active) return;
      setLatest((data?.[0] as RunRow | undefined) ?? null);
      setLoaded(true);
    };
    load();
    const ch = supabase
      .channel(`overnight-badge-${phaseId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "roadmap_phase_overnight_runs", filter: `phase_id=eq.${phaseId}` },
        load,
      )
      .subscribe();
    return () => { active = false; supabase.removeChannel(ch); };
  }, [phaseId]);

  if (!loaded || !latest) return null;

  const cost = typeof latest.result?.cost_usd === "number" ? latest.result.cost_usd : null;
  const promptTok = latest.result?.prompt_tokens ?? null;
  const completionTok = latest.result?.completion_tokens ?? null;

  return (
    <TooltipProvider delayDuration={150}>
      <Tooltip>
        <TooltipTrigger asChild>
          <Badge variant={variantFor(latest.status)} className="gap-1 text-[10px] h-5 px-1.5 font-normal">
            {iconFor(latest.status)}
            <span>overnight · {latest.status}</span>
          </Badge>
        </TooltipTrigger>
        <TooltipContent side="bottom" className="max-w-xs text-xs space-y-1">
          <div className="font-mono text-[10px] uppercase text-muted-foreground">overnight run</div>
          <div>
            scheduled <span className="font-mono">{latest.scheduled_for}</span>
            {latest.model && <span className="ml-1 font-mono text-muted-foreground">· {latest.model}</span>}
          </div>
          {latest.started_at && (
            <div className="text-muted-foreground">started {format(new Date(latest.started_at), "PPp")}</div>
          )}
          {latest.finished_at && (
            <div className="text-muted-foreground">finished {format(new Date(latest.finished_at), "PPp")}</div>
          )}
          {latest.status === "done" && cost != null && (
            <div className="border-t pt-1 text-[10px] text-muted-foreground">
              ${cost.toFixed(6)} · {promptTok ?? 0}/{completionTok ?? 0} tok
            </div>
          )}
          {latest.status === "failed" && latest.error && (
            <div className="text-destructive break-words">{latest.error}</div>
          )}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
