import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Loader2, PlayCircle, ChevronDown, ChevronRight, AlertTriangle, FileText } from "lucide-react";
import { toast } from "@/hooks/use-toast";

type Review = {
  id: string;
  source_repo: string;
  source_path: string;
  review_date: string | null;
  reviewer: string | null;
  scope: string | null;
  summary: string | null;
  fetched_at: string;
  processed_at: string | null;
  process_status: string;
  process_error: string | null;
  report_html_path: string | null;
};


type Finding = {
  id: string;
  review_id: string;
  ext_id: string | null;
  title: string;
  severity: string;
  area: string | null;
  recommendation: string | null;
  evidence: string | null;
  actionable: boolean;
  discussion_action_id: string | null;
  sentinel_finding_id: string | null;
};

const sevTone = (s: string) =>
  s === "critical" || s === "high"
    ? "bg-destructive/10 text-destructive border-destructive/30"
    : s === "medium"
    ? "bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-500/30"
    : "bg-muted text-muted-foreground border-border";

const ago = (iso: string | null) => {
  if (!iso) return "—";
  const d = Date.now() - new Date(iso).getTime();
  const m = Math.floor(d / 60_000);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
};

export default function Reviews() {
  const [reviews, setReviews] = useState<Review[]>([]);
  const [findings, setFindings] = useState<Record<string, Finding[]>>({});
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [running, setRunning] = useState(false);
  const channelName = useMemo(() => `reviews_page:${crypto.randomUUID()}`, []);

  const load = async () => {
    const { data: r } = await supabase
      .from("awip_reviews" as any)
      .select(
        "id,source_repo,source_path,review_date,reviewer,scope,summary,fetched_at,processed_at,process_status,process_error,report_html_path"
      )
      .order("fetched_at", { ascending: false })
      .limit(50);
    setReviews(((r ?? []) as unknown) as Review[]);
  };


  const loadFindings = async (reviewId: string) => {
    if (findings[reviewId]) return;
    const { data } = await supabase
      .from("awip_review_findings" as any)
      .select(
        "id,review_id,ext_id,title,severity,area,recommendation,evidence,actionable,discussion_action_id,sentinel_finding_id"
      )
      .eq("review_id", reviewId)
      .order("severity");
    setFindings((prev) => ({ ...prev, [reviewId]: ((data ?? []) as unknown) as Finding[] }));
  };

  useEffect(() => {
    load();
    const ch = supabase
      .channel(channelName)
      .on("postgres_changes", { event: "*", schema: "public", table: "awip_reviews" }, load)
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [channelName]);

  const toggle = (id: string) => {
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else { next.add(id); loadFindings(id); }
      return next;
    });
  };

  const pull = async () => {
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

  return (
    <div className="container max-w-4xl py-6 space-y-4">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold flex items-center gap-2">
            <FileText className="h-5 w-5" /> External Weekly Reviews
          </h1>
          <p className="text-xs text-muted-foreground">
            Pulled Mondays 05:30 UTC from <code>cjaisingh/verdent-ideas-spark/docs/reviews</code>.
            Each finding becomes a discussion action; high/critical also open a sentinel finding and feed the Lessons Loop.
          </p>
        </div>
        <Button size="sm" onClick={pull} disabled={running}>
          {running ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : <PlayCircle className="h-3 w-3 mr-1" />}
          Pull now
        </Button>
      </header>

      {reviews.length === 0 && (
        <div className="text-sm text-muted-foreground italic">No reviews pulled yet.</div>
      )}

      <ul className="space-y-2">
        {reviews.map((r) => {
          const isOpen = open.has(r.id);
          const fs = findings[r.id] ?? [];
          return (
            <li key={r.id} className="rounded-md border border-border bg-card">
              <button
                type="button"
                onClick={() => toggle(r.id)}
                className="w-full flex items-center gap-2 p-3 text-left hover:bg-muted/30"
              >
                {isOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                <span className="font-mono text-xs">{r.review_date ?? "undated"}</span>
                {r.reviewer && <span className="text-xs text-muted-foreground">· {r.reviewer}</span>}
                {r.scope && <span className="text-xs text-muted-foreground">· {r.scope}</span>}
                {r.process_status === "error" && (
                  <span className="text-xs text-destructive flex items-center gap-1">
                    <AlertTriangle className="h-3 w-3" /> error
                  </span>
                )}
                <span className="ml-auto text-[10px] text-muted-foreground font-mono">{ago(r.fetched_at)}</span>
              </button>
              {isOpen && (
                <div className="border-t border-border p-3 space-y-2">
                  {r.summary && <p className="text-sm">{r.summary}</p>}
                  <div className="text-[10px] text-muted-foreground font-mono">
                    {r.source_repo}/{r.source_path}
                  </div>
                  {r.report_html_path && (
                    <div className="flex gap-3">
                      <button
                        type="button"
                        className="text-xs underline text-foreground/80 hover:text-foreground"
                        onClick={async () => {
                          const { data, error } = await supabase.storage
                            .from("audit-reports")
                            .createSignedUrl(r.report_html_path!, 300);
                          if (error || !data?.signedUrl) {
                            toast({ title: "Could not sign URL", description: error?.message, variant: "destructive" });
                            return;
                          }
                          window.open(data.signedUrl, "_blank", "noopener");
                        }}
                      >
                        Open HTML report
                      </button>
                      <button
                        type="button"
                        className="text-xs underline text-foreground/80 hover:text-foreground"
                        onClick={async () => {
                          const path = r.report_html_path!;
                          const { data, error } = await supabase.storage
                            .from("audit-reports")
                            .download(path);
                          if (error || !data) {
                            toast({ title: "Download failed", description: error?.message, variant: "destructive" });
                            return;
                          }
                          const url = URL.createObjectURL(data);
                          const a = document.createElement("a");
                          a.href = url;
                          a.download = path.split("/").pop() ?? `review-${r.id}.html`;
                          document.body.appendChild(a);
                          a.click();
                          a.remove();
                          URL.revokeObjectURL(url);
                        }}
                      >
                        Download
                      </button>
                    </div>
                  )}
                  {r.process_error && (
                    <div className="text-xs text-destructive">{r.process_error}</div>
                  )}

                  {fs.length === 0 ? (
                    <div className="text-xs text-muted-foreground italic">No findings.</div>
                  ) : (
                    <ul className="divide-y divide-border">
                      {fs.map((f) => (
                        <li key={f.id} className="py-2 space-y-1">
                          <div className="flex items-center gap-2">
                            <span className={`text-[10px] font-mono px-1.5 py-0.5 rounded border ${sevTone(f.severity)}`}>
                              {f.severity}
                            </span>
                            {f.area && <span className="text-[10px] text-muted-foreground">{f.area}</span>}
                            <span className="text-sm">{f.title}</span>
                          </div>
                          {f.recommendation && (
                            <div className="text-xs text-foreground/80 pl-1">→ {f.recommendation}</div>
                          )}
                          <div className="flex gap-3 text-[10px] text-muted-foreground pl-1">
                            {f.discussion_action_id && (
                              <Link to={`/companion`} className="hover:text-foreground underline">
                                discussion action
                              </Link>
                            )}
                            {f.sentinel_finding_id && (
                              <span>sentinel opened</span>
                            )}
                            {!f.actionable && <span>info-only</span>}
                          </div>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
