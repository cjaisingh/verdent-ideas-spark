import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Loader2, PlayCircle, AlertTriangle, ExternalLink, FileText } from "lucide-react";
import { Link } from "react-router-dom";
import { toast } from "@/hooks/use-toast";

type Review = {
  id: string;
  review_date: string | null;
  reviewer: string | null;
  summary: string | null;
  fetched_at: string;
  process_status: string;
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

export const ReviewsCard = () => {
  const [reviews, setReviews] = useState<Review[]>([]);
  const [running, setRunning] = useState(false);
  const channelName = useMemo(() => `reviews_card:${crypto.randomUUID()}`, []);

  const load = async () => {
    const { data } = await supabase
      .from("awip_reviews" as any)
      .select("id,review_date,reviewer,summary,fetched_at,process_status")
      .order("fetched_at", { ascending: false })
      .limit(5);
    setReviews(((data ?? []) as unknown) as Review[]);
  };

  useEffect(() => {
    load();
    const ch = supabase
      .channel(channelName)
      .on("postgres_changes", { event: "*", schema: "public", table: "awip_reviews" }, load)
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [channelName]);

  const runNow = async () => {
    setRunning(true);
    const { data, error } = await supabase.functions.invoke("awip-reviews-pull/pull", { body: {} });
    setRunning(false);
    if (error) {
      toast({ title: "Pull failed", description: error.message, variant: "destructive" });
      return;
    }
    const s = data as { new_files: number; findings_created: number; actions_created: number; sentinel_opened: number };
    toast({
      title: "Reviews pulled",
      description: `${s.new_files} new · ${s.findings_created} findings · ${s.actions_created} actions · ${s.sentinel_opened} sentinel`,
    });
    load();
  };

  const last = reviews[0];

  return (
    <section className="rounded-md border border-border bg-card p-3 space-y-2">
      <header className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-sm font-medium">
          <FileText className="h-4 w-4" /> External Weekly Reviews
        </div>
        <div className="flex items-center gap-2">
          <Link to="/reviews" className="text-[10px] text-muted-foreground hover:text-foreground inline-flex items-center gap-1">
            history <ExternalLink className="h-3 w-3" />
          </Link>
          <Button size="sm" variant="outline" onClick={runNow} disabled={running}
            className="h-6 px-2 text-[10px]">
            {running ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : <PlayCircle className="h-3 w-3 mr-1" />}
            Pull now
          </Button>
        </div>
      </header>
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
        Mon 05:30 UTC · GitHub docs/reviews → actions + sentinel + RAG
      </div>
      {last ? (
        <div className="text-[11px] rounded border border-border bg-muted/30 px-2 py-1.5 space-y-0.5">
          <div className="flex items-center gap-1.5 font-mono text-[10px]">
            {last.process_status === "error"
              ? <AlertTriangle className="h-3 w-3 text-destructive" />
              : <FileText className="h-3 w-3 opacity-60" />}
            <span className="uppercase">{last.process_status}</span>
            <span>· {last.review_date ?? "—"}</span>
            {last.reviewer && <span>· {last.reviewer}</span>}
            <span className="ml-auto opacity-70">{ago(last.fetched_at)}</span>
          </div>
          {last.summary && <div className="opacity-80 line-clamp-2">{last.summary}</div>}
        </div>
      ) : (
        <div className="text-[11px] text-muted-foreground italic">No reviews pulled yet.</div>
      )}
    </section>
  );
};
