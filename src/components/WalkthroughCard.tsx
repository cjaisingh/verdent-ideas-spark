import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Loader2, PlayCircle, AlertTriangle, CheckCircle2, ExternalLink } from "lucide-react";
import { Link } from "react-router-dom";
import { toast } from "@/hooks/use-toast";

type Run = {
  id: string;
  status: string;
  started_at: string;
  finished_at: string | null;
  total: number;
  passed: number;
  failed: number;
  skipped: number;
  duration_ms: number | null;
};

const ago = (iso: string | null) => {
  if (!iso) return "never";
  const d = Date.now() - new Date(iso).getTime();
  const m = Math.floor(d / 60_000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
};

export const WalkthroughCard = () => {
  const [runs, setRuns] = useState<Run[]>([]);
  const [running, setRunning] = useState(false);
  const channelName = useMemo(() => `walkthrough_card:${crypto.randomUUID()}`, []);

  const load = async () => {
    const { data } = await supabase
      .from("walkthrough_runs" as any)
      .select("id,status,started_at,finished_at,total,passed,failed,skipped,duration_ms")
      .order("started_at", { ascending: false })
      .limit(10);
    setRuns(((data ?? []) as unknown) as Run[]);
  };

  useEffect(() => {
    load();
    const ch = supabase
      .channel(channelName)
      .on("postgres_changes", { event: "*", schema: "public", table: "walkthrough_runs" }, load)
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [channelName]);

  const runNow = async () => {
    setRunning(true);
    const { data, error } = await supabase.functions.invoke("app-walkthrough", { body: {} });
    setRunning(false);
    if (error) {
      toast({ title: "Walkthrough failed", description: error.message, variant: "destructive" });
      return;
    }
    const summary = data as { passed: number; failed: number; total: number };
    toast({
      title: "Walkthrough complete",
      description: `${summary.passed}/${summary.total} passed · ${summary.failed} failed`,
    });
    load();
  };

  const last = runs[0];
  const tone =
    !last ? "border-border bg-muted/30 text-muted-foreground"
    : last.status === "ok" ? "border-emerald-500/40 bg-emerald-500/5 text-emerald-700 dark:text-emerald-400"
    : last.status === "partial" ? "border-amber-500/40 bg-amber-500/5 text-amber-700 dark:text-amber-400"
    : "border-destructive/40 bg-destructive/5 text-destructive";

  return (
    <section className="rounded-md border border-border bg-card p-3 space-y-2">
      <header className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-sm font-medium">
          <CheckCircle2 className="h-4 w-4" /> App walkthrough
        </div>
        <div className="flex items-center gap-2">
          <Link to="/walkthrough" className="text-[10px] text-muted-foreground hover:text-foreground inline-flex items-center gap-1">
            history <ExternalLink className="h-3 w-3" />
          </Link>
          <Button size="sm" variant="outline" onClick={runNow} disabled={running}
            className="h-6 px-2 text-[10px]">
            {running ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : <PlayCircle className="h-3 w-3 mr-1" />}
            Run now
          </Button>
        </div>
      </header>
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
        nightly 02:15 UTC · route probes + capability self-tests
      </div>
      {last ? (
        <div className={`text-[11px] rounded border px-2 py-1.5 ${tone} space-y-0.5`}>
          <div className="flex items-center gap-1.5 font-mono text-[10px]">
            {last.status === "ok" ? <CheckCircle2 className="h-3 w-3" /> : <AlertTriangle className="h-3 w-3" />}
            <span className="uppercase">{last.status}</span>
            <span>· {last.passed}/{last.total} passed</span>
            {last.failed > 0 && <span>· {last.failed} failed</span>}
            {last.skipped > 0 && <span>· {last.skipped} skipped</span>}
            <span className="ml-auto opacity-70">{ago(last.started_at)}</span>
          </div>
          {last.duration_ms != null && (
            <div className="opacity-70">{(last.duration_ms / 1000).toFixed(1)}s</div>
          )}
        </div>
      ) : (
        <div className="text-[11px] text-muted-foreground italic">No runs yet — click Run now to test.</div>
      )}
    </section>
  );
};
