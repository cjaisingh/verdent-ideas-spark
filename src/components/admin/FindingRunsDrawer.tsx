// Side drawer that shows the automation_runs rows that triggered a sentinel
// finding. Opened from the "view runs" link on a finding. Each row is
// expandable and shows status, message, and full detail payload.
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  AlertTriangle,
  ArrowUpRight,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Loader2,
} from "lucide-react";

type Run = {
  id: string;
  job: string;
  status: string;
  status_code: number | null;
  message: string | null;
  duration_ms: number | null;
  trigger: string;
  detail: Record<string, unknown> | null;
  created_at: string;
};

const isOk = (r: Run) => r.status === "ok" && (r.status_code ?? 0) < 400;

function rel(iso: string) {
  const m = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

export type FindingRunsDrawerProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  job: string | null;
  runIds: string[];
  findingSummary?: string;
  findingKind?: string;
};

export function FindingRunsDrawer({
  open,
  onOpenChange,
  job,
  runIds,
  findingSummary,
  findingKind,
}: FindingRunsDrawerProps) {
  const [runs, setRuns] = useState<Run[]>([]);
  const [loading, setLoading] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!open || runIds.length === 0) {
      setRuns([]);
      setExpanded(new Set());
      return;
    }
    let cancelled = false;
    (async () => {
      setLoading(true);
      const { data, error } = await supabase
        .from("automation_runs" as any)
        .select("id,job,status,status_code,message,duration_ms,trigger,detail,created_at")
        .in("id", runIds)
        .order("created_at", { ascending: false });
      if (cancelled) return;
      if (error) {
        setRuns([]);
      } else {
        setRuns(((data ?? []) as unknown) as Run[]);
        // Auto-expand first error so users see the message immediately.
        const firstErr = ((data ?? []) as Run[]).find((r) => !isOk(r));
        if (firstErr) setExpanded(new Set([firstErr.id]));
      }
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [open, runIds]);

  const toggle = (id: string) =>
    setExpanded((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const focusParam = runIds.slice(0, 25).join(",");
  const fullPageHref = job
    ? `/admin/cron-health/${job}${focusParam ? `?focus=${focusParam}` : ""}`
    : null;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full sm:max-w-2xl overflow-y-auto">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            Triggering runs
            {job && (
              <Badge variant="outline" className="font-mono text-[10px]">
                {job}
              </Badge>
            )}
          </SheetTitle>
          <SheetDescription>
            {findingSummary ?? "Automation runs that caused this finding."}
            {findingKind && (
              <span className="block mt-1 font-mono text-[10px] uppercase tracking-wide">
                {findingKind}
              </span>
            )}
          </SheetDescription>
        </SheetHeader>

        <div className="mt-4 space-y-3">
          {fullPageHref && (
            <div className="flex justify-end">
              <Button asChild variant="outline" size="sm" className="h-7 text-xs">
                <Link to={fullPageHref} onClick={() => onOpenChange(false)}>
                  Open in cron health
                  <ArrowUpRight className="h-3 w-3 ml-1" />
                </Link>
              </Button>
            </div>
          )}

          {loading ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground py-6">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading runs…
            </div>
          ) : runs.length === 0 ? (
            <div className="text-sm text-muted-foreground py-6">
              No matching automation_runs rows. They may have been purged by retention.
            </div>
          ) : (
            <ul className="space-y-2">
              {runs.map((r) => {
                const ok = isOk(r);
                const isExpanded = expanded.has(r.id);
                return (
                  <li
                    key={r.id}
                    className={`rounded border ${
                      ok ? "border-border" : "border-destructive/30 bg-destructive/5"
                    }`}
                  >
                    <button
                      onClick={() => toggle(r.id)}
                      className="w-full text-left p-3 flex items-start gap-2 hover:bg-accent/40"
                    >
                      <div className="mt-0.5">
                        {isExpanded ? (
                          <ChevronDown className="h-4 w-4" />
                        ) : (
                          <ChevronRight className="h-4 w-4" />
                        )}
                      </div>
                      <div className="mt-0.5 shrink-0">
                        {ok ? (
                          <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                        ) : (
                          <AlertTriangle className="h-4 w-4 text-destructive" />
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          {ok ? (
                            <Badge className="bg-emerald-600 text-white">ok</Badge>
                          ) : (
                            <Badge variant="destructive">
                              {r.status_code ?? r.status}
                            </Badge>
                          )}
                          <Badge variant="outline" className="text-[10px]">
                            {r.trigger}
                          </Badge>
                          <span className="text-xs text-muted-foreground font-mono">
                            {new Date(r.created_at).toLocaleString()} · {rel(r.created_at)}
                          </span>
                          {r.duration_ms != null && (
                            <span className="text-xs text-muted-foreground font-mono">
                              {r.duration_ms}ms
                            </span>
                          )}
                        </div>
                        {r.message && (
                          <div
                            className={`text-xs mt-1 break-words ${
                              ok ? "text-muted-foreground" : "text-destructive"
                            } ${isExpanded ? "" : "line-clamp-2"}`}
                          >
                            {r.message}
                          </div>
                        )}
                      </div>
                    </button>
                    {isExpanded && (
                      <div className="px-3 pb-3 pl-11 space-y-2">
                        {r.message && (
                          <div>
                            <div className="text-[10px] uppercase text-muted-foreground mb-1">
                              Message
                            </div>
                            <pre className="text-xs bg-muted p-2 rounded whitespace-pre-wrap break-words">
                              {r.message}
                            </pre>
                          </div>
                        )}
                        {r.detail && Object.keys(r.detail).length > 0 && (
                          <div>
                            <div className="text-[10px] uppercase text-muted-foreground mb-1">
                              Detail
                            </div>
                            <pre className="text-xs bg-muted p-2 rounded overflow-x-auto">
                              {JSON.stringify(r.detail, null, 2)}
                            </pre>
                          </div>
                        )}
                        <div className="text-[10px] text-muted-foreground font-mono">
                          run_id: {r.id}
                        </div>
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
