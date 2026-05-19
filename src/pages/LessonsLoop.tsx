import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "sonner";
import { Loader2, RefreshCcw, BookOpen, ArrowLeft, Sparkles, MessageSquare, Bot } from "lucide-react";
import { EnqueueDraftDialog, type DraftKind } from "@/components/admin/EnqueueDraftDialog";

type Lesson = {
  id: string;
  category: string;
  severity: string;
  title: string;
  recommendation: string;
  evidence: unknown[];
  status: "proposed" | "applied" | "deferred" | "rejected" | "reopened";
  cadence: "daily" | "weekly";
  source: "discussion" | "chat" | "triage" | "event" | "automation" | "review" | "mixed" | null;
  occurrences: number;
  created_at: string;
  updated_at: string;
  source_window_start: string | null;
  source_window_end: string | null;
};

const STATUSES = ["proposed", "applied", "deferred", "rejected"] as const;
const SOURCES = ["discussion", "chat", "triage", "event", "automation", "review", "mixed"] as const;
const CLIENT_SOURCES = new Set(["chat", "triage", "discussion"]);

const sevColor: Record<string, string> = {
  critical: "bg-destructive text-destructive-foreground",
  high: "bg-destructive/80 text-destructive-foreground",
  medium: "bg-amber-500 text-white",
  low: "bg-muted text-muted-foreground",
};

const sourceColor: Record<string, string> = {
  chat: "bg-blue-500/20 text-blue-700 dark:text-blue-300",
  triage: "bg-purple-500/20 text-purple-700 dark:text-purple-300",
  discussion: "bg-emerald-500/20 text-emerald-700 dark:text-emerald-300",
  event: "bg-orange-500/20 text-orange-700 dark:text-orange-300",
  automation: "bg-muted text-muted-foreground",
  review: "bg-cyan-500/20 text-cyan-700 dark:text-cyan-300",
  mixed: "bg-pink-500/20 text-pink-700 dark:text-pink-300",
};

export default function LessonsLoop() {
  const [rows, setRows] = useState<Lesson[]>([]);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState<null | "daily" | "weekly">(null);
  const [tab, setTab] = useState<typeof STATUSES[number]>("proposed");
  const [search, setSearch] = useState("");
  const [sourceFilter, setSourceFilter] = useState<"all" | "client" | typeof SOURCES[number]>("all");
  const [cadenceFilter, setCadenceFilter] = useState<"all" | "daily" | "weekly">("all");
  const [draftDialog, setDraftDialog] = useState<{ kind: DraftKind; initial?: Record<string, unknown> } | null>(null);

  const load = async () => {
    setLoading(true);
    const { data } = await supabase.from("lessons")
      .select("*").order("created_at", { ascending: false }).limit(300);
    setRows((data as Lesson[]) ?? []);
    setLoading(false);
  };

  useEffect(() => {
    load();
    const ch = supabase.channel(`lessons-loop-${crypto.randomUUID()}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "lessons" }, load)
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, []);

  const filtered = useMemo(() => {
    const q = search.toLowerCase().trim();
    return rows.filter((r) => r.status === tab)
      .filter((r) => {
        if (sourceFilter === "all") return true;
        if (sourceFilter === "client") return r.source && CLIENT_SOURCES.has(r.source);
        return r.source === sourceFilter;
      })
      .filter((r) => cadenceFilter === "all" || r.cadence === cadenceFilter)
      .filter((r) => !q || r.title.toLowerCase().includes(q) || r.recommendation.toLowerCase().includes(q) || r.category.toLowerCase().includes(q));
  }, [rows, tab, search, sourceFilter, cadenceFilter]);

  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const r of rows) c[r.status] = (c[r.status] ?? 0) + 1;
    return c;
  }, [rows]);

  const sourceCounts = useMemo(() => {
    const c: Record<string, number> = { all: 0, client: 0, unknown: 0 };
    for (const r of rows.filter((r) => r.status === tab)) {
      c.all++;
      if (r.source && CLIENT_SOURCES.has(r.source)) c.client++;
      if (r.source) c[r.source] = (c[r.source] ?? 0) + 1;
      else c.unknown++;
    }
    return c;
  }, [rows, tab]);

  const runSynthesis = async (mode: "daily" | "weekly") => {
    setRunning(mode);
    try {
      const fn = mode === "daily" ? "lessons-daily-synth" : "lessons-synthesize";
      const { data, error } = await supabase.functions.invoke(fn, { body: {} });
      if (error) throw error;
      toast.success(`${mode} synth: +${data?.inserted ?? 0} / ~${data?.updated ?? 0}${data?.promoted ? ` / ↑${data.promoted}` : ""}`);
      load();
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "failed");
    }
    finally { setRunning(null); }
  };

  const updateStatus = async (l: Lesson, status: Lesson["status"]) => {
    const patch: { status: Lesson["status"]; applied_at?: string } = { status };
    if (status === "applied") { patch.applied_at = new Date().toISOString(); }
    const { error } = await supabase.from("lessons").update(patch).eq("id", l.id);
    if (error) { toast.error(error.message); return; }
    await supabase.from("lesson_events").insert({
      lesson_id: l.id, event_type: `status:${status}`,
      actor_label: "operator", payload: { from: l.status, to: status },
    });
    toast.success(`Marked ${status}`);
    load();
  };

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-semibold flex items-center gap-2"><BookOpen className="h-5 w-5" /> Lessons Loop</h1>
          <p className="text-sm text-muted-foreground">
            Daily 05:30 UTC across discussions, chats, triage + events. Weekly Sun 05:00 UTC promotes recurring daily lessons.
          </p>
        </div>
        <div className="flex gap-2 flex-wrap">
          <Button asChild variant="outline" size="sm">
            <Link to="/morning-review"><ArrowLeft className="h-4 w-4 mr-1" /> Morning Review</Link>
          </Button>
          <Button onClick={() => runSynthesis("daily")} disabled={running !== null} size="sm" variant="secondary">
            {running === "daily" ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Sparkles className="h-4 w-4 mr-1" />}
            Run daily now
          </Button>
          <Button onClick={() => runSynthesis("weekly")} disabled={running !== null} size="sm">
            {running === "weekly" ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <RefreshCcw className="h-4 w-4 mr-1" />}
            Run weekly roll-up
          </Button>
          <Button
            onClick={() => setDraftDialog({ kind: "draft_lesson_synthesis" })}
            size="sm"
            variant="outline"
          >
            <Bot className="h-4 w-4 mr-1" /> Draft with local LLM
          </Button>
        </div>
      </div>

      <Tabs value={tab} onValueChange={(v) => setTab(v as typeof STATUSES[number])}>
        <TabsList>
          {STATUSES.map((s) => (
            <TabsTrigger key={s} value={s}>{s} ({counts[s] ?? 0})</TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      <Card>
        <CardContent className="py-3 space-y-3">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs text-muted-foreground mr-1">Source:</span>
            <Button size="sm" variant={sourceFilter === "all" ? "default" : "outline"} onClick={() => setSourceFilter("all")}>
              All <Badge variant="secondary" className="ml-1.5">{sourceCounts.all ?? 0}</Badge>
            </Button>
            <Button
              size="sm"
              variant={sourceFilter === "client" ? "default" : "outline"}
              onClick={() => setSourceFilter("client")}
              className={sourceFilter === "client" ? "" : "border-blue-500/40"}
            >
              <MessageSquare className="h-3 w-3 mr-1" />
              Client signals <Badge variant="secondary" className="ml-1.5">{sourceCounts.client ?? 0}</Badge>
            </Button>
            {SOURCES.map((s) => (
              <Button
                key={s}
                size="sm"
                variant={sourceFilter === s ? "default" : "outline"}
                onClick={() => setSourceFilter(s)}
              >
                {s} <Badge variant="secondary" className="ml-1.5">{sourceCounts[s] ?? 0}</Badge>
              </Button>
            ))}
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs text-muted-foreground mr-1">Cadence:</span>
            {(["all", "daily", "weekly"] as const).map((c) => (
              <Button key={c} size="sm" variant={cadenceFilter === c ? "default" : "outline"} onClick={() => setCadenceFilter(c)}>
                {c}
              </Button>
            ))}
            <Input
              placeholder="Search title, category, recommendation…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="max-w-xs ml-auto"
            />
          </div>
        </CardContent>
      </Card>

      {loading ? (
        <div className="text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin inline mr-2" />Loading…</div>
      ) : filtered.length === 0 ? (
        <Card><CardContent className="py-8 text-sm text-muted-foreground text-center">No {tab} lessons match these filters.</CardContent></Card>
      ) : (
        <div className="grid gap-3">
          {filtered.map((l) => (
            <Card key={l.id}>
              <CardHeader className="pb-2">
                <div className="flex items-start justify-between gap-3 flex-wrap">
                  <CardTitle className="text-base">{l.title}</CardTitle>
                  <div className="flex gap-1.5 items-center flex-wrap">
                    <Badge className={sevColor[l.severity] ?? "bg-muted"}>{l.severity}</Badge>
                    <Badge variant="outline">{l.category}</Badge>
                    {l.source && (
                      <Badge className={sourceColor[l.source] ?? "bg-muted"} variant="secondary">
                        {l.source}
                      </Badge>
                    )}
                    <Badge variant="outline" className="text-xs">{l.cadence}</Badge>
                    {l.occurrences > 1 && (
                      <Badge variant="secondary" className="text-xs">×{l.occurrences}</Badge>
                    )}
                  </div>
                </div>
              </CardHeader>
              <CardContent className="space-y-3 text-sm">
                <p>{l.recommendation}</p>
                {Array.isArray(l.evidence) && l.evidence.length > 0 && (
                  <details className="text-xs">
                    <summary className="cursor-pointer text-muted-foreground">{l.evidence.length} evidence ref(s)</summary>
                    <pre className="bg-muted/40 p-2 rounded mt-2 overflow-x-auto">{JSON.stringify(l.evidence, null, 2)}</pre>
                  </details>
                )}
                {tab === "proposed" && (
                  <div className="flex gap-2">
                    <Button size="sm" onClick={() => updateStatus(l, "applied")}>Apply</Button>
                    <Button size="sm" variant="outline" onClick={() => updateStatus(l, "deferred")}>Defer</Button>
                    <Button size="sm" variant="ghost" onClick={() => updateStatus(l, "rejected")}>Reject</Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() =>
                        setDraftDialog({
                          kind: "draft_lesson_synthesis",
                          initial: {
                            candidate_id: l.id,
                            title_hint: l.title,
                            category: l.category,
                            evidence: Array.isArray(l.evidence) && l.evidence.length > 0
                              ? l.evidence.map((e) => ({
                                  source: typeof e === "object" && e && "source" in e ? String((e as { source: unknown }).source) : "lesson",
                                  snippet: typeof e === "object" && e ? JSON.stringify(e) : String(e),
                                }))
                              : [{ source: "lesson", snippet: l.recommendation }],
                          },
                        })
                      }
                    >
                      <Bot className="h-4 w-4 mr-1" /> Draft
                    </Button>
                  </div>
                )}
                {tab !== "proposed" && (
                  <div className="flex gap-2">
                    <Button size="sm" variant="outline" onClick={() => updateStatus(l, "proposed")}>Reopen</Button>
                  </div>
                )}
                <div className="text-xs text-muted-foreground">
                  Created {new Date(l.created_at).toLocaleString()}
                  {l.source_window_start && ` · window ${l.source_window_start.slice(0, 10)} → ${l.source_window_end?.slice(0, 10)}`}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {draftDialog && (
        <EnqueueDraftDialog
          open={!!draftDialog}
          onOpenChange={(o) => { if (!o) setDraftDialog(null); }}
          kind={draftDialog.kind}
          initial={draftDialog.initial}
        />
      )}
    </div>
  );
}
