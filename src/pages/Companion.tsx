import { useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { toast } from "@/hooks/use-toast";
import {
  Plus, Send, Trash2, Settings as SettingsIcon, Sparkles, Cloud, Cpu, Zap,
  ArrowUpRightSquare, MessageSquareText, Sun, Wand2,
} from "lucide-react";

type Thread = {
  id: string;
  title: string;
  agent_kind: "general" | "morning_review" | "planning";
  model: string | null;
  created_at: string;
  updated_at: string;
  archived_at: string | null;
};
type Msg = {
  id: string;
  thread_id: string;
  role: "user" | "assistant" | "system";
  content: string;
  model: string | null;
  latency_ms: number | null;
  escalated_action_id: string | null;
  rag_chunk_ids: any;
  created_at: string;
};

type CompanionSettings = {
  ollama_base_url: string;
  ollama_model: string;
  cloud_model: string;
  use_cloud: boolean;
  rag_enabled: boolean;
  rag_top_k: number;
};

const SETTINGS_KEY = "awip.companion.settings.v1";

function loadSettings(): CompanionSettings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (raw) return { ...defaults(), ...JSON.parse(raw) };
  } catch { /* ignore */ }
  return defaults();
}
function defaults(): CompanionSettings {
  return {
    ollama_base_url: "http://localhost:11434",
    ollama_model: "qwen2.5:14b-instruct",
    cloud_model: "google/gemini-2.5-flash",
    use_cloud: false,
    rag_enabled: true,
    rag_top_k: 6,
  };
}
function saveSettings(s: CompanionSettings) {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(s));
}

const SYSTEM_PROMPT = `You are the AWIP Companion: a thoughtful local AI assistant that helps the operator (Andy) think through AWIP — an operator console + contract API. You are NOT the coding agent (Lovable does that). You're the discussion partner.

Your job:
- Discuss morning reviews, roadmap decisions, ideas, trade-offs.
- Reason carefully about AWIP's architecture: React + Vite + Tailwind + Lovable Cloud (Supabase). Single edge function awip-api. Capabilities, OKRs, Night Agent, overnight runners.
- When the operator decides on action items, suggest they "Promote → action" so Lovable picks them up.
- Be concise. Use markdown. Ask one focused follow-up question at a time.
- If RAG context is provided below, ground your answers in it; cite paths/headings inline.

You do NOT execute code, edit files, or run migrations. You discuss and propose.`;

export default function Companion() {
  const [threads, setThreads] = useState<Thread[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [streaming, setStreaming] = useState("");
  const [settings, setSettings] = useState<CompanionSettings>(loadSettings);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [healthOk, setHealthOk] = useState<boolean | null>(null);
  const scrollerRef = useRef<HTMLDivElement>(null);

  const active = useMemo(() => threads.find((t) => t.id === activeId) ?? null, [threads, activeId]);

  // Persist settings
  useEffect(() => { saveSettings(settings); }, [settings]);

  // Probe Ollama health
  useEffect(() => {
    let cancelled = false;
    if (settings.use_cloud) { setHealthOk(null); return; }
    (async () => {
      try {
        const r = await fetch(`${settings.ollama_base_url}/api/tags`, { signal: AbortSignal.timeout(2000) });
        if (!cancelled) setHealthOk(r.ok);
      } catch { if (!cancelled) setHealthOk(false); }
    })();
    return () => { cancelled = true; };
  }, [settings.ollama_base_url, settings.use_cloud]);

  // Load threads
  const loadThreads = async () => {
    const { data, error } = await supabase
      .from("companion_threads")
      .select("*")
      .is("archived_at", null)
      .order("updated_at", { ascending: false })
      .limit(50);
    if (error) { toast({ title: "Failed to load threads", description: error.message, variant: "destructive" }); return; }
    setThreads((data ?? []) as Thread[]);
    if (!activeId && data && data.length > 0) setActiveId(data[0].id);
  };
  useEffect(() => { loadThreads(); }, []);

  // Load messages for active thread + realtime
  useEffect(() => {
    if (!activeId) { setMessages([]); return; }
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from("companion_messages")
        .select("*").eq("thread_id", activeId).order("created_at", { ascending: true });
      if (!cancelled) setMessages((data ?? []) as Msg[]);
    })();
    const ch = supabase.channel(`companion-${activeId}`)
      .on("postgres_changes",
        { event: "INSERT", schema: "public", table: "companion_messages", filter: `thread_id=eq.${activeId}` },
        (p) => {
          const m = p.new as Msg;
          setMessages((prev) => prev.some((x) => x.id === m.id) ? prev : [...prev, m]);
        })
      .subscribe();
    return () => { cancelled = true; supabase.removeChannel(ch); };
  }, [activeId]);

  useEffect(() => {
    scrollerRef.current?.scrollTo({ top: scrollerRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, streaming]);

  const createThread = async (kind: Thread["agent_kind"], title: string, seedMessages?: { role: "system"|"user"|"assistant"; content: string }[]) => {
    const { data: u } = await supabase.auth.getUser();
    if (!u.user) { toast({ title: "Not signed in", variant: "destructive" }); return null; }
    const { data, error } = await supabase.from("companion_threads")
      .insert({
        title, agent_kind: kind,
        model: settings.use_cloud ? settings.cloud_model : settings.ollama_model,
        created_by: u.user.id,
      }).select("*").single();
    if (error || !data) { toast({ title: "Couldn't create thread", description: error?.message, variant: "destructive" }); return null; }
    setThreads((prev) => [data as Thread, ...prev]);
    setActiveId(data.id);
    if (seedMessages?.length) {
      await supabase.from("companion_messages").insert(seedMessages.map((m) => ({
        thread_id: data.id, role: m.role, content: m.content,
      })));
    }
    return data as Thread;
  };

  const newGeneralThread = () => createThread("general", "New conversation");

  const startMorningReview = async () => {
    // Seed with latest daily plan + morning review snapshot
    const today = new Date().toISOString().slice(0, 10);
    const [{ data: plan }, { data: review }] = await Promise.all([
      supabase.from("daily_plans").select("for_date, focus, plan_md, risks, recommendations").order("for_date", { ascending: false }).limit(1).maybeSingle(),
      supabase.from("morning_reviews").select("review_date, kpis, stuck_jobs, top_actions, open_findings").order("review_date", { ascending: false }).limit(1).maybeSingle(),
    ]);
    const seed = [
      "## Today's plan & morning review snapshot",
      plan ? `**Plan for ${plan.for_date}** — focus: ${plan.focus ?? "(none)"}\n\n${plan.plan_md ?? ""}` : "_No daily plan yet today._",
      "",
      review ? `**Morning review ${review.review_date}**\n\n- Stuck jobs: ${(review.stuck_jobs as any[])?.length ?? 0}\n- Top actions: ${(review.top_actions as any[])?.length ?? 0}\n- Open findings: ${(review.open_findings as any[])?.length ?? 0}` : "_No morning review yet._",
      "",
      "Walk me through the priorities. What should I focus on first? What blockers do you see?",
    ].join("\n");
    await createThread("morning_review", `Morning review — ${today}`, [
      { role: "system", content: "Seed context:\n\n" + seed },
    ]);
  };

  const deleteThread = async (id: string) => {
    if (!confirm("Delete this conversation? This cannot be undone.")) return;
    const { error } = await supabase.from("companion_threads").delete().eq("id", id);
    if (error) { toast({ title: "Delete failed", description: error.message, variant: "destructive" }); return; }
    setThreads((prev) => prev.filter((t) => t.id !== id));
    if (activeId === id) setActiveId(threads.find((t) => t.id !== id)?.id ?? null);
  };

  // RAG fetch (online)
  const fetchRagContext = async (q: string): Promise<{ blob: string; ids: string[] }> => {
    if (!settings.rag_enabled) return { blob: "", ids: [] };
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/awip-rag/search`;
      const r = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${session?.access_token}` },
        body: JSON.stringify({ q, limit: settings.rag_top_k }),
      });
      if (!r.ok) return { blob: "", ids: [] };
      const j = await r.json();
      const results = (j?.results ?? []) as Array<{ chunk_id: string; path: string; title: string; heading: string | null; content: string }>;
      if (!results.length) return { blob: "", ids: [] };
      const blob = "## AWIP knowledge (top matches)\n\n" + results.map((r, i) =>
        `### [${i + 1}] ${r.path}${r.heading ? ` — ${r.heading}` : ""}\n${r.content}`
      ).join("\n\n");
      return { blob, ids: results.map((r) => r.chunk_id) };
    } catch { return { blob: "", ids: [] }; }
  };

  // Send a message — streams from Ollama (local) or AI Gateway (cloud)
  const sendMessage = async () => {
    if (!input.trim() || !active || sending) return;
    const userText = input.trim();
    setInput("");
    setSending(true);
    setStreaming("");

    const t0 = performance.now();
    let ragIds: string[] = [];
    let ragBlob = "";
    try {
      // 1. Persist user message (realtime will echo it)
      const { data: u } = await supabase.from("companion_messages").insert({
        thread_id: active.id, role: "user", content: userText,
      }).select("*").single();
      if (u) setMessages((prev) => prev.some((x) => x.id === u.id) ? prev : [...prev, u as Msg]);

      // 2. RAG
      const rag = await fetchRagContext(userText);
      ragIds = rag.ids;
      ragBlob = rag.blob;

      // 3. Build messages
      const history = [...messages, u as Msg].filter(Boolean).slice(-20);
      const llmMessages = [
        { role: "system", content: SYSTEM_PROMPT },
        ...(ragBlob ? [{ role: "system" as const, content: ragBlob }] : []),
        ...history.map((m) => ({ role: m.role as "user" | "assistant" | "system", content: m.content })),
      ];

      // 4. Call LLM (stream)
      const useCloud = settings.use_cloud || healthOk === false;
      const model = useCloud ? settings.cloud_model : settings.ollama_model;
      let acc = "";

      if (useCloud) {
        // Cloud: Lovable AI Gateway (needs an edge function for the API key — we use copilot-noop-llm? no, we need real LLM)
        // For now, route cloud through finding-discuss-copilot pattern: we'll call the gateway via a simple proxy.
        // Use the existing awip-api or a tiny call? We'll fall back to a non-streaming call via the existing
        // discussion-extract-actions style — but for simplicity, hit gateway via edge proxy:
        const { data: { session } } = await supabase.auth.getSession();
        const r = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/copilot-noop-llm`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${session?.access_token}` },
          body: JSON.stringify({ stream: false, messages: llmMessages, model }),
        });
        // copilot-noop-llm returns empty — we need a real cloud LLM endpoint.
        // For now: if cloud requested, error out with a hint.
        toast({
          title: "Cloud routing not wired yet",
          description: "Phase 1 streams from local Ollama only. Toggle 'Use cloud' off, or wait for Phase 1.5.",
          variant: "destructive",
        });
        setSending(false);
        return;
      }

      // Ollama streaming via OpenAI-compatible endpoint
      const resp = await fetch(`${settings.ollama_base_url}/v1/chat/completions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model, messages: llmMessages, stream: true }),
      });
      if (!resp.ok || !resp.body) {
        const txt = await resp.text().catch(() => "");
        throw new Error(`Ollama ${resp.status}: ${txt.slice(0, 200)}`);
      }
      const reader = resp.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let nl: number;
        while ((nl = buffer.indexOf("\n")) !== -1) {
          let line = buffer.slice(0, nl);
          buffer = buffer.slice(nl + 1);
          if (line.endsWith("\r")) line = line.slice(0, -1);
          if (!line.startsWith("data: ")) continue;
          const data = line.slice(6).trim();
          if (data === "[DONE]") continue;
          try {
            const p = JSON.parse(data);
            const delta = p?.choices?.[0]?.delta?.content;
            if (typeof delta === "string") { acc += delta; setStreaming(acc); }
          } catch { /* partial */ }
        }
      }

      const latency = Math.round(performance.now() - t0);
      // 5. Persist assistant message
      const { data: a } = await supabase.from("companion_messages").insert({
        thread_id: active.id, role: "assistant", content: acc,
        model, latency_ms: latency, rag_chunk_ids: ragIds,
      }).select("*").single();
      if (a) setMessages((prev) => prev.some((x) => x.id === a.id) ? prev : [...prev, a as Msg]);
      // bump thread updated_at
      await supabase.from("companion_threads").update({ updated_at: new Date().toISOString() }).eq("id", active.id);
      setStreaming("");
    } catch (e) {
      toast({
        title: "Companion error",
        description: e instanceof Error ? e.message : String(e),
        variant: "destructive",
      });
    } finally {
      setSending(false);
    }
  };

  const promoteMessage = async (m: Msg) => {
    if (!active) return;
    const { data: u } = await supabase.auth.getUser();
    const { data, error } = await supabase.from("discussion_actions").insert({
      subject_type: "companion_thread",
      subject_id: active.id,
      title: m.content.slice(0, 200).replace(/\n+/g, " "),
      details: m.content.length > 200 ? m.content : null,
      priority: "med",
      source: "manual",
      night_eligible: true,
      owner: "lovable",
      created_by: u.user?.id ?? null,
    }).select("id").single();
    if (error) { toast({ title: "Promote failed", description: error.message, variant: "destructive" }); return; }
    if (data) {
      await supabase.from("companion_messages").update({ escalated_action_id: data.id }).eq("id", m.id);
      setMessages((prev) => prev.map((x) => x.id === m.id ? { ...x, escalated_action_id: data.id } : x));
    }
    toast({ title: "Promoted to action", description: "Lovable will see this on the Jobs board." });
  };

  const extractActions = async () => {
    if (!active) return;
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const r = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/companion-extract-actions`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${session?.access_token}` },
        body: JSON.stringify({ thread_id: active.id }),
      });
      if (!r.ok) {
        const e = await r.json().catch(() => ({}));
        throw new Error(e?.error ?? `HTTP ${r.status}`);
      }
      const j = await r.json();
      const proposals = (j?.proposals ?? []) as Array<{ title: string; details: string | null; priority: string; confidence: number | null }>;
      if (!proposals.length) { toast({ title: "No actions found", description: "The model didn't see anything actionable yet." }); return; }
      const { data: u } = await supabase.auth.getUser();
      const { error } = await supabase.from("discussion_actions").insert(proposals.map((p) => ({
        subject_type: "companion_thread",
        subject_id: active.id,
        title: p.title,
        details: p.details,
        priority: p.priority,
        source: "extracted",
        extracted_confidence: p.confidence,
        night_eligible: true,
        owner: "lovable",
        created_by: u.user?.id ?? null,
      })));
      if (error) throw error;
      toast({ title: `Extracted ${proposals.length} action(s)`, description: "Saved to Jobs board for Lovable." });
    } catch (e) {
      toast({ title: "Extract failed", description: e instanceof Error ? e.message : String(e), variant: "destructive" });
    }
  };

  return (
    <div className="flex h-[calc(100vh-4rem)] flex-col">
      {/* Header */}
      <div className="flex items-center justify-between border-b px-4 py-3">
        <div className="flex items-center gap-3">
          <Sparkles className="h-5 w-5 text-primary" />
          <div>
            <h1 className="text-lg font-semibold">Companion</h1>
            <p className="text-xs text-muted-foreground">Local-LLM discussion layer · talks to your Mac · escalates to Lovable</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant={settings.use_cloud ? "secondary" : healthOk === true ? "default" : healthOk === false ? "destructive" : "outline"} className="gap-1">
            {settings.use_cloud ? <Cloud className="h-3 w-3" /> : <Cpu className="h-3 w-3" />}
            {settings.use_cloud ? `Cloud · ${settings.cloud_model}` : `Ollama · ${healthOk === true ? "online" : healthOk === false ? "offline" : "checking…"}`}
          </Badge>
          <Dialog open={settingsOpen} onOpenChange={setSettingsOpen}>
            <DialogTrigger asChild>
              <Button variant="outline" size="sm"><SettingsIcon className="h-4 w-4 mr-1" />Settings</Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader><DialogTitle>Companion settings</DialogTitle></DialogHeader>
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <div>
                    <Label>Use cloud model</Label>
                    <p className="text-xs text-muted-foreground">Off = local Ollama; on = Lovable AI Gateway (costs money)</p>
                  </div>
                  <Switch checked={settings.use_cloud} onCheckedChange={(v) => setSettings((s) => ({ ...s, use_cloud: v }))} />
                </div>
                <div className="space-y-1">
                  <Label>Ollama base URL</Label>
                  <Input value={settings.ollama_base_url} onChange={(e) => setSettings((s) => ({ ...s, ollama_base_url: e.target.value }))} />
                  <p className="text-xs text-muted-foreground">Run on your Mac: <code className="text-[10px]">launchctl setenv OLLAMA_ORIGINS "https://*.lovable.app,http://localhost:*"</code> then restart Ollama.</p>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <Label>Local model</Label>
                    <Input value={settings.ollama_model} onChange={(e) => setSettings((s) => ({ ...s, ollama_model: e.target.value }))} placeholder="qwen2.5:14b-instruct" />
                  </div>
                  <div className="space-y-1">
                    <Label>Cloud model</Label>
                    <Select value={settings.cloud_model} onValueChange={(v) => setSettings((s) => ({ ...s, cloud_model: v }))}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="google/gemini-2.5-flash-lite">gemini-2.5-flash-lite (cheapest)</SelectItem>
                        <SelectItem value="google/gemini-2.5-flash">gemini-2.5-flash</SelectItem>
                        <SelectItem value="google/gemini-2.5-pro">gemini-2.5-pro</SelectItem>
                        <SelectItem value="openai/gpt-5-mini">gpt-5-mini</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <div className="flex items-center justify-between">
                  <div>
                    <Label>RAG context</Label>
                    <p className="text-xs text-muted-foreground">Inject top-k AWIP doc chunks per turn</p>
                  </div>
                  <Switch checked={settings.rag_enabled} onCheckedChange={(v) => setSettings((s) => ({ ...s, rag_enabled: v }))} />
                </div>
              </div>
              <DialogFooter>
                <Button onClick={() => setSettingsOpen(false)}>Done</Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      <div className="flex flex-1 overflow-hidden">
        {/* Threads sidebar */}
        <aside className="w-72 border-r overflow-y-auto p-2 space-y-1">
          <div className="flex gap-1 mb-2">
            <Button size="sm" variant="outline" className="flex-1" onClick={newGeneralThread}>
              <Plus className="h-3.5 w-3.5 mr-1" />New
            </Button>
            <Button size="sm" variant="outline" onClick={startMorningReview} title="Discuss today's plan">
              <Sun className="h-3.5 w-3.5" />
            </Button>
          </div>
          {threads.length === 0 && (
            <p className="text-xs text-muted-foreground px-2 py-4 text-center">No conversations yet. Start one above.</p>
          )}
          {threads.map((t) => (
            <div
              key={t.id}
              onClick={() => setActiveId(t.id)}
              className={`group flex items-start gap-1 rounded px-2 py-1.5 cursor-pointer text-sm hover:bg-muted ${activeId === t.id ? "bg-muted" : ""}`}
            >
              {t.agent_kind === "morning_review" ? <Sun className="h-3.5 w-3.5 mt-0.5 text-amber-500 shrink-0" /> : <MessageSquareText className="h-3.5 w-3.5 mt-0.5 text-muted-foreground shrink-0" />}
              <div className="flex-1 min-w-0">
                <div className="truncate">{t.title}</div>
                <div className="text-[10px] text-muted-foreground">{new Date(t.updated_at).toLocaleString()}</div>
              </div>
              <button
                onClick={(e) => { e.stopPropagation(); deleteThread(t.id); }}
                className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive"
                aria-label="Delete"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}
        </aside>

        {/* Chat */}
        <main className="flex-1 flex flex-col overflow-hidden">
          {!active ? (
            <div className="flex-1 flex items-center justify-center text-sm text-muted-foreground">
              Select or start a conversation.
            </div>
          ) : (
            <>
              <div className="flex items-center justify-between border-b px-4 py-2">
                <div className="flex items-center gap-2">
                  <Badge variant="outline" className="text-[10px] uppercase">{active.agent_kind.replace("_", " ")}</Badge>
                  <span className="text-sm font-medium truncate">{active.title}</span>
                </div>
                <div className="flex gap-1">
                  <Button size="sm" variant="outline" onClick={extractActions}>
                    <Wand2 className="h-3.5 w-3.5 mr-1" />Extract actions
                  </Button>
                </div>
              </div>

              <div ref={scrollerRef} className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
                {messages.length === 0 && !streaming && (
                  <p className="text-sm text-muted-foreground text-center mt-8">
                    Type below to start the conversation. RAG and AWIP context will be injected automatically.
                  </p>
                )}
                {messages.map((m) => (
                  <div key={m.id} className={`group rounded-lg p-3 text-sm ${m.role === "user" ? "bg-primary/5 ml-12" : m.role === "system" ? "bg-muted/40 italic text-xs" : "mr-12"}`}>
                    <div className="flex items-center gap-2 mb-1">
                      <Badge variant="outline" className="text-[9px] uppercase">{m.role}</Badge>
                      {m.model && <span className="text-[10px] text-muted-foreground">{m.model}</span>}
                      {m.latency_ms != null && <span className="text-[10px] text-muted-foreground">{m.latency_ms}ms</span>}
                      {Array.isArray(m.rag_chunk_ids) && m.rag_chunk_ids.length > 0 && (
                        <Badge variant="secondary" className="text-[9px]">RAG×{m.rag_chunk_ids.length}</Badge>
                      )}
                      {m.escalated_action_id && (
                        <Badge variant="default" className="text-[9px] gap-0.5"><Zap className="h-2.5 w-2.5" />promoted</Badge>
                      )}
                      <span className="ml-auto text-[10px] text-muted-foreground">{new Date(m.created_at).toLocaleTimeString()}</span>
                      {m.role === "assistant" && !m.escalated_action_id && (
                        <button
                          onClick={() => promoteMessage(m)}
                          className="opacity-0 group-hover:opacity-100 text-[10px] inline-flex items-center gap-0.5 text-primary hover:underline"
                          title="Promote this message to a Lovable action"
                        >
                          <ArrowUpRightSquare className="h-3 w-3" />Promote
                        </button>
                      )}
                    </div>
                    <div className="whitespace-pre-wrap break-words">{m.content}</div>
                  </div>
                ))}
                {streaming && (
                  <div className="rounded-lg p-3 text-sm mr-12 border border-dashed">
                    <div className="flex items-center gap-2 mb-1">
                      <Badge variant="outline" className="text-[9px] uppercase">assistant</Badge>
                      <span className="text-[10px] text-muted-foreground animate-pulse">streaming…</span>
                    </div>
                    <div className="whitespace-pre-wrap break-words">{streaming}</div>
                  </div>
                )}
              </div>

              <div className="border-t p-3">
                <div className="flex gap-2">
                  <Textarea
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    placeholder={settings.use_cloud ? "Ask the cloud companion…" : "Ask the local companion…"}
                    rows={2}
                    className="resize-none"
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); sendMessage(); }
                    }}
                  />
                  <Button onClick={sendMessage} disabled={sending || !input.trim()}>
                    <Send className="h-4 w-4" />
                  </Button>
                </div>
                <p className="text-[10px] text-muted-foreground mt-1">⌘/Ctrl+Enter to send · RAG {settings.rag_enabled ? "on" : "off"} · model {settings.use_cloud ? settings.cloud_model : settings.ollama_model}</p>
              </div>
            </>
          )}
        </main>
      </div>
    </div>
  );
}
