import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { Loader2, RefreshCcw, Moon, Check, X } from "lucide-react";

type Rec = {
  id: string;
  generated_at: string;
  scheduled_for: string;
  phase_id: string;
  phase_key: string;
  score: number;
  reasons: string[];
  blockers: string[];
  status: "open" | "queued" | "dismissed" | "expired";
};

type Phase = { id: string; key: string; title: string };

const tomorrowUtc = () => new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);

export default function OvernightCandidatesCard() {
  const [recs, setRecs] = useState<Rec[]>([]);
  const [phases, setPhases] = useState<Record<string, Phase>>({});
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [acting, setActing] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    const target = tomorrowUtc();
    const { data: rows } = await supabase
      .from("overnight_recommendations")
      .select("*")
      .eq("scheduled_for", target)
      .order("score", { ascending: false });
    const list = (rows ?? []) as Rec[];
    setRecs(list);
    if (list.length > 0) {
      const ids = Array.from(new Set(list.map((r) => r.phase_id)));
      const { data: ps } = await supabase
        .from("roadmap_phases")
        .select("id, key, title")
        .in("id", ids);
      const map: Record<string, Phase> = {};
      for (const p of (ps ?? []) as Phase[]) map[p.id] = p;
      setPhases(map);
    }
    setLoading(false);
  };

  useEffect(() => {
    load();
    const ch = supabase
      .channel("overnight-recs-card")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "overnight_recommendations" },
        load,
      )
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
  }, []);

  const refreshNow = async () => {
    setRefreshing(true);
    try {
      const { error } = await supabase.functions.invoke("overnight-recommender", { body: {} });
      if (error) throw error;
      toast.success("Recommendations refreshed.");
      await load();
    } catch (e: any) {
      toast.error(e.message ?? "Refresh failed");
    } finally {
      setRefreshing(false);
    }
  };

  const queue = async (rec: Rec) => {
    setActing(rec.id);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("not signed in");
      const { error: insErr } = await supabase
        .from("roadmap_phase_overnight_runs")
        .insert({
          phase_id: rec.phase_id,
          phase_key: rec.phase_key,
          requested_by: user.id,
          scheduled_for: rec.scheduled_for,
          status: "queued",
        });
      if (insErr) throw insErr;
      const { error: updErr } = await supabase
        .from("overnight_recommendations")
        .update({ status: "queued", acted_at: new Date().toISOString(), acted_by: user.id })
        .eq("id", rec.id);
      if (updErr) throw updErr;
      toast.success(`Queued ${rec.phase_key} for tonight.`);
    } catch (e: any) {
      toast.error(e.message ?? "Queue failed");
    } finally {
      setActing(null);
    }
  };

  const dismiss = async (rec: Rec) => {
    setActing(rec.id);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      const { error } = await supabase
        .from("overnight_recommendations")
        .update({ status: "dismissed", acted_at: new Date().toISOString(), acted_by: user?.id ?? null })
        .eq("id", rec.id);
      if (error) throw error;
    } catch (e: any) {
      toast.error(e.message ?? "Dismiss failed");
    } finally {
      setActing(null);
    }
  };

  const open = recs.filter((r) => r.status === "open");
  const lastGenerated = recs[0]?.generated_at;

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0">
        <div>
          <CardTitle className="flex items-center gap-2 text-base">
            <Moon className="h-4 w-4" /> Overnight candidates
            <Badge variant="outline" className="text-[10px]">{tomorrowUtc()}</Badge>
          </CardTitle>
          <p className="text-xs text-muted-foreground mt-1">
            Phases the system suggests running overnight. You decide.
            {lastGenerated && (
              <span> · last refreshed {new Date(lastGenerated).toLocaleString()}</span>
            )}
          </p>
        </div>
        <Button size="sm" variant="outline" onClick={refreshNow} disabled={refreshing}>
          {refreshing ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : <RefreshCcw className="h-3 w-3 mr-1" />}
          Refresh
        </Button>
      </CardHeader>
      <CardContent className="space-y-2">
        {loading ? (
          <div className="text-sm text-muted-foreground flex items-center gap-2 py-4">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading…
          </div>
        ) : open.length === 0 ? (
          <p className="text-sm text-muted-foreground py-2">
            No overnight candidates tonight. Recommender runs at 21:30 UTC.
          </p>
        ) : (
          open.map((rec) => {
            const phase = phases[rec.phase_id];
            return (
              <div
                key={rec.id}
                className="flex items-start justify-between gap-3 border border-border/60 rounded p-3"
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-mono text-xs text-muted-foreground">{rec.phase_key}</span>
                    <span className="font-medium text-sm">{phase?.title ?? "—"}</span>
                    <Badge variant="secondary" className="text-[10px]">score {rec.score}</Badge>
                  </div>
                  {rec.reasons?.length > 0 && (
                    <div className="text-xs text-muted-foreground mt-1">
                      {rec.reasons.join(" · ")}
                    </div>
                  )}
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <Button
                    size="sm"
                    onClick={() => queue(rec)}
                    disabled={acting === rec.id}
                  >
                    <Check className="h-3 w-3 mr-1" /> Queue
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => dismiss(rec)}
                    disabled={acting === rec.id}
                  >
                    <X className="h-3 w-3" />
                  </Button>
                </div>
              </div>
            );
          })
        )}
      </CardContent>
    </Card>
  );
}
