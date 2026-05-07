import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { toast } from "@/hooks/use-toast";
import { MessageSquareText, RefreshCw, Trash2, Sparkles, AlertTriangle, Loader2, ShieldAlert, GraduationCap, X, Check } from "lucide-react";
import { cn } from "@/lib/utils";
import { scanLesson, describeIssues } from "@/lib/lessonSafety";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

type LessonScope = "global" | "notebook" | "approvals" | "voice_style";
type LessonDraft = { text: string; scope: LessonScope };
const SCOPES: LessonScope[] = ["global", "notebook", "approvals", "voice_style"];

type Transcript = {
  id: string;
  agent_slug: string | null;
  model: string | null;
  started_at: string;
  ended_at: string | null;
  turn_count: number;
  summary: string | null;
  analyzed_at: string | null;
};

type Turn = {
  id: string;
  ord: number;
  role: "user" | "assistant" | "tool" | "system";
  content: string;
  model: string | null;
  latency_ms: number | null;
  created_at: string;
};

type Analysis = {
  diverged_at_ord: number | null;
  divergence_summary?: string;
  likely_causes?: string[];
  suggested_lessons?: string[];
};

const callApi = async (path: string, init?: RequestInit) => {
  const { data: { session } } = await supabase.auth.getSession();
  const token = session?.access_token;
  const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/awip-api${path}`;
  const res = await fetch(url, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      ...(init?.headers ?? {}),
    },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body?.error ?? `HTTP ${res.status}`);
  return body;
};

const Transcripts = () => {
  const [list, setList] = useState<Transcript[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [transcript, setTranscript] = useState<Transcript | null>(null);
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [analysing, setAnalysing] = useState(false);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [drafts, setDrafts] = useState<Record<string, LessonDraft>>({});
  const [savingTurnId, setSavingTurnId] = useState<string | null>(null);

  const startDraft = (turn: Turn) => {
    const seed = turn.content.trim().slice(0, 300);
    setDrafts(d => ({ ...d, [turn.id]: { text: `Learn from this: ${seed}`, scope: "global" } }));
  };
  const updateDraft = (id: string, patch: Partial<LessonDraft>) =>
    setDrafts(d => ({ ...d, [id]: { ...d[id], ...patch } }));
  const cancelDraft = (id: string) =>
    setDrafts(d => { const n = { ...d }; delete n[id]; return n; });

  const saveDraft = async (turnId: string) => {
    const draft = drafts[turnId];
    if (!draft) return;
    const text = draft.text.trim();
    if (!text) { toast({ title: "Lesson is empty", variant: "destructive" }); return; }
    if (text.length > 500) { toast({ title: "Lesson must be ≤ 500 chars", variant: "destructive" }); return; }
    const issues = scanLesson(text);
    if (issues.length > 0) {
      toast({ title: "Blocked: sensitive data", description: `Remove ${describeIssues(issues)}.`, variant: "destructive" });
      return;
    }
    setSavingTurnId(turnId);
    try {
      await callApi("/lessons", {
        method: "POST",
        body: JSON.stringify({ lesson: text, scope: draft.scope, source: "manual", active: true }),
      });
      toast({ title: "Lesson saved" });
      cancelDraft(turnId);
    } catch (e: any) {
      toast({ title: "Save failed", description: e.message, variant: "destructive" });
    } finally { setSavingTurnId(null); }
  };


  const refresh = async () => {
    setLoading(true);
    try {
      const r = await callApi("/transcripts?limit=100");
      setList(r.transcripts ?? []);
    } catch (e: any) {
      toast({ title: "Failed to load", description: e.message, variant: "destructive" });
    } finally { setLoading(false); }
  };

  useEffect(() => { refresh(); }, []);

  const open = async (id: string) => {
    setSelectedId(id);
    setLoadingDetail(true);
    setAnalysis(null);
    try {
      const r = await callApi(`/transcripts/${id}`);
      setTranscript(r.transcript);
      setTurns(r.turns ?? []);
      if (r.transcript?.analysis) setAnalysis(r.transcript.analysis as Analysis);
    } catch (e: any) {
      toast({ title: "Open failed", description: e.message, variant: "destructive" });
    } finally { setLoadingDetail(false); }
  };

  const analyse = async () => {
    if (!selectedId) return;
    setAnalysing(true);
    try {
      const r = await callApi(`/transcripts/${selectedId}/analyze`, { method: "POST" });
      setAnalysis(r.analysis as Analysis);
      toast({ title: "Analysis ready" });
      refresh();
    } catch (e: any) {
      toast({ title: "Analysis failed", description: e.message, variant: "destructive" });
    } finally { setAnalysing(false); }
  };

  const remove = async (id: string) => {
    if (!confirm("Delete this transcript?")) return;
    try {
      await callApi(`/transcripts/${id}`, { method: "DELETE" });
      if (selectedId === id) { setSelectedId(null); setTurns([]); setTranscript(null); setAnalysis(null); }
      refresh();
    } catch (e: any) {
      toast({ title: "Delete failed", description: e.message, variant: "destructive" });
    }
  };

  const saveLesson = async (lesson: string) => {
    const issues = scanLesson(lesson);
    if (issues.length > 0) {
      toast({
        title: "Blocked: sensitive data detected",
        description: `Remove ${describeIssues(issues)} before saving this lesson.`,
        variant: "destructive",
      });
      return;
    }
    try {
      await callApi("/lessons", {
        method: "POST",
        body: JSON.stringify({ lesson, scope: "global", source: "manual", active: true }),
      });
      toast({ title: "Lesson saved" });
    } catch (e: any) {
      toast({ title: "Save failed", description: e.message, variant: "destructive" });
    }
  };

  const divergedOrd = analysis?.diverged_at_ord ?? null;

  const fmt = (s: string) => new Date(s).toLocaleString();

  return (
    <div className="p-6 space-y-4 max-w-7xl mx-auto">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold flex items-center gap-2">
            <MessageSquareText className="h-6 w-6" /> Copilot Transcripts
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Inspect past voice sessions. Run an analysis to find where the conversation diverged and the likely causes.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={refresh} disabled={loading}>
          <RefreshCw className={cn("h-4 w-4 mr-2", loading && "animate-spin")} /> Refresh
        </Button>
      </header>

      <div className="grid grid-cols-12 gap-4">
        {/* List */}
        <Card className="col-span-12 lg:col-span-4">
          <CardHeader><CardTitle className="text-base">Sessions</CardTitle></CardHeader>
          <CardContent className="p-0">
            <ScrollArea className="h-[70vh]">
              {list.length === 0 && !loading && (
                <p className="text-sm text-muted-foreground p-6 text-center">No sessions yet.</p>
              )}
              <div className="divide-y">
                {list.map(t => (
                  <button
                    key={t.id}
                    onClick={() => open(t.id)}
                    className={cn(
                      "w-full text-left px-4 py-3 hover:bg-muted/50 transition",
                      selectedId === t.id && "bg-muted"
                    )}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-sm font-medium">{fmt(t.started_at)}</span>
                      <Badge variant="outline" className="text-xs">{t.turn_count} turns</Badge>
                    </div>
                    <div className="flex items-center gap-2 mt-1 flex-wrap">
                      {t.model && <Badge variant="secondary" className="text-xs">{t.model}</Badge>}
                      {t.agent_slug && <Badge variant="outline" className="text-xs">{t.agent_slug}</Badge>}
                      {t.analyzed_at && <Badge className="text-xs"><Sparkles className="h-3 w-3 mr-1" />analysed</Badge>}
                    </div>
                    {t.summary && (
                      <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{t.summary}</p>
                    )}
                  </button>
                ))}
              </div>
            </ScrollArea>
          </CardContent>
        </Card>

        {/* Detail */}
        <div className="col-span-12 lg:col-span-8 space-y-4">
          {!selectedId && (
            <Card><CardContent className="py-16 text-center text-sm text-muted-foreground">
              Select a session to inspect.
            </CardContent></Card>
          )}

          {selectedId && (
            <>
              <Card>
                <CardHeader className="flex flex-row items-center justify-between">
                  <div>
                    <CardTitle className="text-base">Divergence analysis</CardTitle>
                    {transcript?.analyzed_at && (
                      <p className="text-xs text-muted-foreground mt-1">Last analysed {fmt(transcript.analyzed_at)}</p>
                    )}
                  </div>
                  <div className="flex gap-2">
                    <Button size="sm" onClick={analyse} disabled={analysing || loadingDetail}>
                      {analysing ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Sparkles className="h-4 w-4 mr-2" />}
                      {analysis ? "Re-analyse" : "Analyse"}
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => remove(selectedId)}>
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </CardHeader>
                <CardContent className="space-y-3">
                  {!analysis && (
                    <p className="text-sm text-muted-foreground">No analysis yet. Click Analyse to find the divergence point and likely causes.</p>
                  )}
                  {analysis && (
                    <>
                      {divergedOrd ? (
                        <div className="flex items-start gap-2 p-3 rounded-md border border-destructive/40 bg-destructive/5">
                          <AlertTriangle className="h-4 w-4 text-destructive mt-0.5" />
                          <div>
                            <p className="text-sm font-medium">Diverged at turn #{divergedOrd}</p>
                            <p className="text-sm text-muted-foreground">{analysis.divergence_summary}</p>
                          </div>
                        </div>
                      ) : (
                        <p className="text-sm text-muted-foreground">{analysis.divergence_summary ?? "No divergence detected."}</p>
                      )}
                      {!!analysis.likely_causes?.length && (
                        <div>
                          <p className="text-xs font-medium uppercase text-muted-foreground mb-1">Likely causes</p>
                          <ul className="text-sm list-disc pl-5 space-y-1">
                            {analysis.likely_causes.map((c, i) => <li key={i}>{c}</li>)}
                          </ul>
                        </div>
                      )}
                      {!!analysis.suggested_lessons?.length && (
                        <div>
                          <p className="text-xs font-medium uppercase text-muted-foreground mb-1">Suggested lessons</p>
                          <div className="space-y-2">
                            {analysis.suggested_lessons.map((l, i) => {
                              const issues = scanLesson(l);
                              const unsafe = issues.length > 0;
                              return (
                                <div key={i} className={cn("flex items-start justify-between gap-2 p-2 border rounded-md", unsafe && "border-destructive/50 bg-destructive/5")}>
                                  <div className="flex-1 space-y-1">
                                    <p className="text-sm">{l}</p>
                                    {unsafe && (
                                      <p className="text-xs text-destructive flex items-center gap-1">
                                        <ShieldAlert className="h-3 w-3" />
                                        Blocked: contains {describeIssues(issues)}
                                      </p>
                                    )}
                                  </div>
                                  <Button size="sm" variant="outline" disabled={unsafe} onClick={() => saveLesson(l)}>
                                    {unsafe ? "Unsafe" : "Save lesson"}
                                  </Button>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      )}
                    </>
                  )}
                </CardContent>
              </Card>

              <Card>
                <CardHeader><CardTitle className="text-base">Conversation</CardTitle></CardHeader>
                <CardContent>
                  <ScrollArea className="h-[50vh] pr-3">
                    <div className="space-y-2">
                      {turns.map(t => {
                        const isDiv = divergedOrd === t.ord;
                        return (
                          <div
                            key={t.id}
                            className={cn(
                              "rounded-md border p-3",
                              t.role === "user" ? "bg-muted/30" : "bg-background",
                              isDiv && "ring-2 ring-destructive border-destructive"
                            )}
                          >
                            <div className="flex items-center gap-2 mb-1">
                              <Badge variant="outline" className="text-xs">#{t.ord}</Badge>
                              <Badge variant={t.role === "assistant" ? "default" : "secondary"} className="text-xs">
                                {t.role}
                              </Badge>
                              {t.latency_ms != null && (
                                <span className="text-xs text-muted-foreground">{t.latency_ms}ms</span>
                              )}
                              {isDiv && <Badge variant="destructive" className="text-xs">divergence</Badge>}
                            </div>
                            <p className="text-sm whitespace-pre-wrap">{t.content}</p>
                          </div>
                        );
                      })}
                      {turns.length === 0 && !loadingDetail && (
                        <p className="text-sm text-muted-foreground py-8 text-center">No turns recorded.</p>
                      )}
                    </div>
                  </ScrollArea>
                </CardContent>
              </Card>
            </>
          )}
        </div>
      </div>
    </div>
  );
};

export default Transcripts;
