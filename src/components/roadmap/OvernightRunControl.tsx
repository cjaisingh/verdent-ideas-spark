import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Switch } from "@/components/ui/switch";
import { Moon, Loader2, X, Sparkles, Repeat } from "lucide-react";
import { toast } from "@/hooks/use-toast";
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
  phaseKey: string;
}

const statusVariant: Record<string, "default" | "secondary" | "outline" | "destructive"> = {
  queued: "outline",
  running: "secondary",
  done: "default",
  failed: "destructive",
  cancelled: "outline",
};

export function OvernightRunControl({ phaseId, phaseKey }: Props) {
  const [latest, setLatest] = useState<RunRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [recurring, setRecurring] = useState(false);
  const [recurringSaving, setRecurringSaving] = useState(false);

  useEffect(() => {
    let active = true;
    const load = async () => {
      const [{ data: runs }, { data: phase }] = await Promise.all([
        supabase
          .from("roadmap_phase_overnight_runs")
          .select("id, status, requested_at, started_at, finished_at, scheduled_for, model, result, error")
          .eq("phase_id", phaseId)
          .order("requested_at", { ascending: false })
          .limit(1),
        supabase
          .from("roadmap_phases")
          .select("run_overnight")
          .eq("id", phaseId)
          .maybeSingle(),
      ]);
      if (!active) return;
      setLatest((runs?.[0] as RunRow | undefined) ?? null);
      setRecurring(!!(phase as any)?.run_overnight);
      setLoading(false);
    };
    load();
    const ch = supabase
      .channel(`overnight-${phaseId}-${Math.random().toString(36).slice(2, 10)}`)
      .on("postgres_changes",
        { event: "*", schema: "public", table: "roadmap_phase_overnight_runs", filter: `phase_id=eq.${phaseId}` },
        load)
      .on("postgres_changes",
        { event: "UPDATE", schema: "public", table: "roadmap_phases", filter: `id=eq.${phaseId}` },
        load)
      .subscribe();
    return () => { active = false; supabase.removeChannel(ch); };
  }, [phaseId]);

  const toggleRecurring = async (next: boolean) => {
    setRecurringSaving(true);
    const prev = recurring;
    setRecurring(next);
    try {
      const { error } = await supabase
        .from("roadmap_phases")
        .update({ run_overnight: next } as never)
        .eq("id", phaseId);
      if (error) throw error;
      toast({
        title: next ? "Will be queued every night" : "Auto-queue off",
        description: next
          ? "Auto-queued at 21:55 UTC each evening until shipped."
          : "Phase will no longer be queued automatically.",
      });
    } catch (e) {
      setRecurring(prev);
      toast({ title: "Update failed", description: e instanceof Error ? e.message : String(e), variant: "destructive" });
    } finally { setRecurringSaving(false); }
  };

  const queue = async () => {
    setBusy(true);
    try {
      const { data: u } = await supabase.auth.getUser();
      if (!u.user) throw new Error("not signed in");
      const today = new Date().toISOString().slice(0, 10);
      const { error } = await supabase.from("roadmap_phase_overnight_runs").insert({
        phase_id: phaseId,
        phase_key: phaseKey,
        requested_by: u.user.id,
        scheduled_for: today,
        status: "queued",
      });
      if (error) throw error;
      toast({ title: "Queued for tonight", description: `Will run between 22:00 and 06:00 UTC using gemini-2.5-flash-lite.` });
    } catch (e) {
      toast({ title: "Queue failed", description: e instanceof Error ? e.message : String(e), variant: "destructive" });
    } finally { setBusy(false); }
  };

  const cancel = async () => {
    if (!latest) return;
    setBusy(true);
    try {
      const { error } = await supabase.rpc("cancel_overnight_run", { _id: latest.id });
      if (error) throw error;
      toast({ title: "Cancelled" });
    } catch (e) {
      toast({ title: "Cancel failed", description: e instanceof Error ? e.message : String(e), variant: "destructive" });
    } finally { setBusy(false); }
  };

  if (loading) return null;

  const active = latest && (latest.status === "queued" || latest.status === "running");

  return (
    <div className="flex items-center gap-1.5">
      {!active && (
        <Button size="sm" variant="outline" onClick={queue} disabled={busy} className="h-7 gap-1.5 text-xs">
          {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Moon className="h-3 w-3" />}
          Run overnight
        </Button>
      )}
      {active && (
        <>
          <Badge variant={statusVariant[latest!.status]} className="gap-1 text-[10px]">
            {latest!.status === "running" && <Loader2 className="h-2.5 w-2.5 animate-spin" />}
            {latest!.status}
          </Badge>
          {latest!.status === "queued" && (
            <Button size="icon" variant="ghost" onClick={cancel} disabled={busy} className="h-6 w-6" aria-label="Cancel queued run">
              <X className="h-3 w-3" />
            </Button>
          )}
        </>
      )}
      {latest && !active && (
        <Popover>
          <PopoverTrigger asChild>
            <Button size="sm" variant="ghost" className="h-7 gap-1.5 text-xs text-muted-foreground">
              <Sparkles className="h-3 w-3" />
              {latest.status}
            </Button>
          </PopoverTrigger>
          <PopoverContent side="bottom" align="end" className="w-96 text-xs space-y-2">
            <div className="flex items-center justify-between">
              <span className="font-mono text-[10px] uppercase text-muted-foreground">overnight result</span>
              <Badge variant={statusVariant[latest.status]} className="text-[10px]">{latest.status}</Badge>
            </div>
            <div className="text-muted-foreground">
              {latest.finished_at ? format(new Date(latest.finished_at), "PPp") : "—"}
              {latest.model && <span className="ml-2 font-mono">· {latest.model}</span>}
            </div>
            {latest.status === "done" && latest.result && (
              <div className="space-y-2">
                {latest.result.summary && (
                  <p className="leading-relaxed text-foreground">{latest.result.summary}</p>
                )}
                {Array.isArray(latest.result.risks) && latest.result.risks.length > 0 && (
                  <div>
                    <p className="font-medium text-foreground">Risks</p>
                    <ul className="list-disc pl-4 text-muted-foreground">
                      {latest.result.risks.map((r: string, i: number) => <li key={i}>{r}</li>)}
                    </ul>
                  </div>
                )}
                {Array.isArray(latest.result.recommendations) && latest.result.recommendations.length > 0 && (
                  <div>
                    <p className="font-medium text-foreground">Recommendations</p>
                    <ul className="list-disc pl-4 text-muted-foreground">
                      {latest.result.recommendations.map((r: string, i: number) => <li key={i}>{r}</li>)}
                    </ul>
                  </div>
                )}
                {typeof latest.result.cost_usd === "number" && (
                  <div className="border-t pt-1 text-[10px] text-muted-foreground">
                    cost ${latest.result.cost_usd.toFixed(6)} · {latest.result.prompt_tokens ?? 0}/{latest.result.completion_tokens ?? 0} tok
                  </div>
                )}
              </div>
            )}
            {latest.status === "failed" && (
              <p className="text-destructive">{latest.error ?? "unknown error"}</p>
            )}
            <Button size="sm" variant="outline" onClick={queue} disabled={busy} className="w-full gap-1.5 text-xs">
              <Moon className="h-3 w-3" /> Run again tonight
            </Button>
          </PopoverContent>
        </Popover>
      )}
    </div>
  );
}
