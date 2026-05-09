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
  ArrowUpRightSquare, MessageSquareText, Sun, Wand2, Search, X, ListTree, RefreshCw,
} from "lucide-react";

// Build a list of loopback variants to probe. macOS Ollama often listens on
// IPv6 only, so a browser hitting `localhost` (which can resolve to 127.0.0.1)
// may get ERR_CONNECTION_REFUSED while `127.0.0.1` works (or vice versa).
function loopbackVariants(baseUrl: string): string[] {
  const clean = baseUrl.replace(/\/$/, "");
  try {
    const u = new URL(clean);
    const host = u.hostname;
    const isLoopback = host === "localhost" || host === "127.0.0.1" || host === "[::1]" || host === "::1";
    if (!isLoopback) return [clean];
    const port = u.port || "11434";
    const proto = u.protocol || "http:";
    const seen = new Set<string>();
    const out: string[] = [];
    for (const h of ["localhost", "127.0.0.1", "[::1]"]) {
      const v = `${proto}//${h}:${port}`;
      if (!seen.has(v)) { seen.add(v); out.push(v); }
    }
    // Make the user's chosen variant first
    const chosen = `${proto}//${host}:${port}`;
    out.sort((a) => (a === chosen ? -1 : 0));
    return out;
  } catch { return [clean]; }
}

export type OllamaErrorKind = "refused" | "cors" | "timeout" | "http" | "unreachable" | "unknown";
export function classifyOllamaError(e: unknown): { kind: OllamaErrorKind; message: string } {
  const msg = (e as any)?.message ?? String(e);
  const lower = String(msg).toLowerCase();
  if (lower.includes("aborted") || lower.includes("timeout")) return { kind: "timeout", message: msg };
  if (lower.includes("failed to fetch") || lower.includes("networkerror")) {
    // Browsers collapse refused/CORS/private-network into a generic "Failed to fetch".
    return { kind: "unreachable", message: msg };
  }
  if (lower.startsWith("http ")) return { kind: "http", message: msg };
  return { kind: "unknown", message: msg };
}

async function fetchOllamaModelsAt(baseUrl: string, timeoutMs = 4000): Promise<string[]> {
  const r = await fetch(`${baseUrl.replace(/\/$/, "")}/api/tags`, { signal: AbortSignal.timeout(timeoutMs) });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const j = await r.json();
  return (j?.models ?? []).map((m: any) => m?.name).filter(Boolean);
}

// Resolve to the first reachable loopback variant. Returns models + working URL.
export async function resolveAndFetchOllama(baseUrl: string, timeoutMs = 4000): Promise<{ models: string[]; baseUrl: string }> {
  const variants = loopbackVariants(baseUrl);
  let lastErr: unknown = new Error("no variants");
  for (const v of variants) {
    try {
      const models = await fetchOllamaModelsAt(v, timeoutMs);
      return { models, baseUrl: v };
    } catch (e) { lastErr = e; }
  }
  throw lastErr;
}

// Back-compat: existing callers expect just the model list.
async function fetchOllamaModels(baseUrl: string, timeoutMs = 4000): Promise<string[]> {
  const { models } = await resolveAndFetchOllama(baseUrl, timeoutMs);
  return models;
}

function useOllamaModels(baseUrl: string, enabled: boolean) {
  const [models, setModels] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [errorKind, setErrorKind] = useState<OllamaErrorKind | null>(null);
  const [resolvedBaseUrl, setResolvedBaseUrl] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!enabled || !baseUrl) return;
    let cancelled = false;
    setLoading(true); setError(null); setErrorKind(null);
    const t = setTimeout(() => {
      resolveAndFetchOllama(baseUrl)
        .then(({ models, baseUrl: rb }) => { if (!cancelled) { setModels(models); setResolvedBaseUrl(rb); } })
        .catch((e) => {
          if (cancelled) return;
          const c = classifyOllamaError(e);
          setError(c.message); setErrorKind(c.kind); setModels([]); setResolvedBaseUrl(null);
        })
        .finally(() => { if (!cancelled) setLoading(false); });
    }, 300);
    return () => { cancelled = true; clearTimeout(t); };
  }, [baseUrl, enabled, tick]);
  return { models, loading, error, errorKind, resolvedBaseUrl, refetch: () => setTick((n) => n + 1) };
}

function LocalModelPicker({
  baseUrl, value, onChange, enabled, onResolved,
}: { baseUrl: string; value: string; onChange: (v: string) => void; enabled: boolean; onResolved?: (url: string | null) => void }) {
  const { models, loading, error, errorKind, resolvedBaseUrl, refetch } = useOllamaModels(baseUrl, enabled);
  useEffect(() => { onResolved?.(resolvedBaseUrl); }, [resolvedBaseUrl, onResolved]);
  const hasList = models.length > 0;
  const inList = hasList && models.includes(value);
  const hint = (() => {
    if (loading) return "Detecting installed models…";
    if (!error) return hasList ? null : "No models detected — type a name";
    if (errorKind === "unreachable") {
      const tryAlt = baseUrl.includes("localhost") ? "127.0.0.1" : "localhost";
      return `Browser can't reach Ollama at ${baseUrl}. Try http://${tryAlt}:11434, or check OLLAMA_ORIGINS allows this preview.`;
    }
    if (errorKind === "timeout") return "Ollama didn't respond in time — is it running?";
    if (errorKind === "http") return `Ollama responded with ${error} — check the base URL path.`;
    return `Couldn't reach Ollama (${error}) — type a model name`;
  })();
  if (!hasList) {
    return (
      <div className="space-y-1">
        <div className="flex gap-2">
          <Input value={value} onChange={(e) => onChange(e.target.value)} placeholder="qwen2.5:14b-instruct" />
          <Button type="button" variant="outline" size="icon" onClick={refetch} disabled={loading} title="Refresh">
            <RefreshCw className={`h-3 w-3 ${loading ? "animate-spin" : ""}`} />
          </Button>
        </div>
        {hint && <p className="text-[10px] text-muted-foreground">{hint}</p>}
      </div>
    );
  }
  return (
    <div className="flex gap-2">
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger><SelectValue /></SelectTrigger>
        <SelectContent>
          {!inList && value && (
            <SelectItem value={value} disabled>{value} (not installed)</SelectItem>
          )}
          {models.map((m) => (<SelectItem key={m} value={m}>{m}</SelectItem>))}
        </SelectContent>
      </Select>
      <Button type="button" variant="outline" size="icon" onClick={refetch} disabled={loading} title="Refresh installed models">
        <RefreshCw className={`h-3 w-3 ${loading ? "animate-spin" : ""}`} />
      </Button>
    </div>
  );
}

import { InstallPwaButton } from "@/components/companion/InstallPwaButton";

function pickClosestModel(target: string, available: string[]): string | null {
  if (!available.length) return null;
  const t = target.toLowerCase();
  const tBase = t.split(":")[0];
  const tFamily = tBase.replace(/[^a-z]/g, "");
  // 1) same base name (different tag) e.g. gemma4:27b vs gemma4:31b
  const sameBase = available.filter((m) => m.toLowerCase().split(":")[0] === tBase);
  if (sameBase.length) return sameBase[0];
  // 2) same family (letters only) e.g. gemma4 vs gemma3
  const sameFamily = available.filter((m) => m.toLowerCase().split(":")[0].replace(/[^a-z]/g, "") === tFamily);
  if (sameFamily.length) return sameFamily[0];
  // 3) longest common prefix length scoring
  const score = (m: string) => {
    const a = m.toLowerCase();
    let i = 0;
    while (i < a.length && i < t.length && a[i] === t[i]) i++;
    return i;
  };
  return [...available].sort((a, b) => score(b) - score(a))[0];
}

function TestOllamaButton({
  baseUrl, model, onPickModel,
}: { baseUrl: string; model: string; onPickModel: (m: string) => void }) {
  const [status, setStatus] = useState<"idle" | "testing" | "ok" | "error">("idle");
  const [detail, setDetail] = useState<string>("");
  const [suggestion, setSuggestion] = useState<string | null>(null);
  const [available, setAvailable] = useState<string[]>([]);
  async function run() {
    setStatus("testing"); setDetail(""); setSuggestion(null);
    const t0 = performance.now();
    try {
      const models = await fetchOllamaModels(baseUrl);
      const ms = Math.round(performance.now() - t0);
      const has = models.includes(model);
      setAvailable(models);
      setStatus("ok");
      if (has) {
        setDetail(`${models.length} model${models.length === 1 ? "" : "s"} in ${ms}ms · "${model}" ✓ installed`);
      } else {
        const closest = pickClosestModel(model, models);
        setSuggestion(closest);
        setDetail(`${models.length} model${models.length === 1 ? "" : "s"} in ${ms}ms · "${model}" ✗ not installed (have: ${models.slice(0, 4).join(", ")}${models.length > 4 ? "…" : ""})`);
      }
    } catch (e: any) {
      setStatus("error");
      setDetail(e?.message || String(e));
    }
  }
  return (
    <div className="space-y-1">
      <Button type="button" variant="outline" size="sm" onClick={run} disabled={status === "testing"}>
        <Zap className="h-3 w-3 mr-1" />
        {status === "testing" ? "Testing…" : "Test Ollama connection"}
      </Button>
      {status !== "idle" && (
        <p className={`text-xs ${status === "ok" ? (suggestion ? "text-amber-500" : "text-emerald-500") : status === "error" ? "text-destructive" : "text-muted-foreground"}`}>
          {status === "ok" ? (suggestion ? "Mismatch · " : "Connected · ") : status === "error" ? "Failed · " : ""}{detail}
        </p>
      )}
      {suggestion && (
        <div className="flex items-center gap-2 flex-wrap pt-1">
          <span className="text-xs text-muted-foreground">Closest installed:</span>
          <Button type="button" size="sm" variant="secondary" onClick={() => { onPickModel(suggestion); setSuggestion(null); setDetail(`Switched to "${suggestion}" ✓`); }}>
            Use "{suggestion}"
          </Button>
          {available.length > 1 && (
            <Select onValueChange={(v) => { onPickModel(v); setSuggestion(null); setDetail(`Switched to "${v}" ✓`); }}>
              <SelectTrigger className="h-8 w-[200px] text-xs"><SelectValue placeholder="…or pick another" /></SelectTrigger>
              <SelectContent>
                {available.map((m) => (<SelectItem key={m} value={m}>{m}</SelectItem>))}
              </SelectContent>
            </Select>
          )}
        </div>
      )}
    </div>
  );
}

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
    // Gemma 4 31B (~20 GB on disk) fits the M4 Mac mini 24 GB and is the best
    // local model available. iPhone/iPad can't reach Ollama directly — use the
    // 'Use cloud' toggle on those devices, or a Tailscale URL to the Mac.
    ollama_model: "gemma4:31b",
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
  const [resolvedOllamaUrl, setResolvedOllamaUrl] = useState<string | null>(null);
  const scrollerRef = useRef<HTMLDivElement>(null);

  // Filters / search
  const [search, setSearch] = useState("");
  const [filterKind, setFilterKind] = useState<"all" | Thread["agent_kind"]>("all");
  const [filterRange, setFilterRange] = useState<"all" | "today" | "7d" | "30d">("all");
  const [filterEscalated, setFilterEscalated] = useState(false);
  const [threadStats, setThreadStats] = useState<Record<string, { msgs: number; escalated: number }>>({});
  const [searchHits, setSearchHits] = useState<Set<string> | null>(null);
  const debounceRef = useRef<number | null>(null);

  const active = useMemo(() => threads.find((t) => t.id === activeId) ?? null, [threads, activeId]);

  // Persist settings
  useEffect(() => { saveSettings(settings); }, [settings]);

  // Probe Ollama health (uses loopback variant resolution)
  useEffect(() => {
    let cancelled = false;
    if (settings.use_cloud) { setHealthOk(null); setResolvedOllamaUrl(null); return; }
    (async () => {
      try {
        const { baseUrl } = await resolveAndFetchOllama(settings.ollama_base_url, 2500);
        if (!cancelled) { setHealthOk(true); setResolvedOllamaUrl(baseUrl); }
      } catch { if (!cancelled) { setHealthOk(false); setResolvedOllamaUrl(null); } }
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
    const rows = (data ?? []) as Thread[];
    setThreads(rows);
    if (!activeId && rows.length > 0) setActiveId(rows[0].id);
    // Per-thread stats: message + escalation counts (single query)
    if (rows.length > 0) {
      const ids = rows.map((t) => t.id);
      const { data: msgRows } = await supabase
        .from("companion_messages")
        .select("thread_id, escalated_action_id")
        .in("thread_id", ids);
      const next: Record<string, { msgs: number; escalated: number }> = {};
      for (const r of msgRows ?? []) {
        const k = (r as any).thread_id as string;
        if (!next[k]) next[k] = { msgs: 0, escalated: 0 };
        next[k].msgs += 1;
        if ((r as any).escalated_action_id) next[k].escalated += 1;
      }
      setThreadStats(next);
    } else {
      setThreadStats({});
    }
  };
  useEffect(() => { loadThreads(); }, []);

  // Debounced full-text search across user's own messages
  useEffect(() => {
    const q = search.trim();
    if (debounceRef.current) window.clearTimeout(debounceRef.current);
    if (!q) { setSearchHits(null); return; }
    debounceRef.current = window.setTimeout(async () => {
      const { data } = await supabase
        .from("companion_messages")
        .select("thread_id")
        .ilike("content", `%${q}%`)
        .limit(500);
      setSearchHits(new Set((data ?? []).map((r: any) => r.thread_id as string)));
    }, 250);
  }, [search]);

  const visibleThreads = useMemo(() => {
    const q = search.trim().toLowerCase();
    const now = Date.now();
    const cutoff =
      filterRange === "today" ? new Date(new Date().setHours(0, 0, 0, 0)).getTime() :
      filterRange === "7d" ? now - 7 * 86_400_000 :
      filterRange === "30d" ? now - 30 * 86_400_000 : 0;
    return threads.filter((t) => {
      if (filterKind !== "all" && t.agent_kind !== filterKind) return false;
      if (cutoff && new Date(t.updated_at).getTime() < cutoff) return false;
      if (filterEscalated && (threadStats[t.id]?.escalated ?? 0) === 0) return false;
      if (q) {
        const titleHit = t.title.toLowerCase().includes(q);
        const contentHit = searchHits?.has(t.id) ?? false;
        if (!titleHit && !contentHit) return false;
      }
      return true;
    });
  }, [threads, filterKind, filterRange, filterEscalated, threadStats, search, searchHits]);

  const filtersActive = filterKind !== "all" || filterRange !== "all" || filterEscalated || search.trim() !== "";
  const clearFilters = () => { setSearch(""); setFilterKind("all"); setFilterRange("all"); setFilterEscalated(false); };


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

      // 4. Call LLM (stream) — cloud via edge proxy, local via Ollama directly
      const useCloud = settings.use_cloud || healthOk === false;
      const model = useCloud ? settings.cloud_model : settings.ollama_model;
      let acc = "";

      let resp: Response;
      if (useCloud) {
        const { data: { session } } = await supabase.auth.getSession();
        if (!session?.access_token) throw new Error("Not signed in — cannot use cloud model.");
        const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/companion-cloud-chat`;
        resp = await fetch(url, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${session.access_token}`,
          },
          body: JSON.stringify({ model, messages: llmMessages }),
        });
      } else {
        const localBase = resolvedOllamaUrl ?? settings.ollama_base_url;
        resp = await fetch(`${localBase}/v1/chat/completions`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ model, messages: llmMessages, stream: true }),
        });
      }

      if (!resp.ok || !resp.body) {
        const txt = await resp.text().catch(() => "");
        if (useCloud && resp.status === 429) {
          throw new Error("Cloud rate limit hit (429). Wait a moment or switch to local Ollama.");
        }
        if (useCloud && resp.status === 402) {
          throw new Error("Cloud credits exhausted (402). Add credits in Workspace → Usage, or switch to local Ollama.");
        }
        throw new Error(`${useCloud ? "Cloud" : "Ollama"} ${resp.status}: ${txt.slice(0, 200)}`);
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
          <InstallPwaButton />
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
                  <p className="text-xs text-muted-foreground">
                    On your Mac, allow this preview origin then restart Ollama:<br />
                    <code className="text-[10px] break-all">launchctl setenv OLLAMA_ORIGINS "https://*.lovable.app,https://*.lovableproject.com,http://localhost:*"</code>
                    <br />
                    Tip: if your Ollama listens on IPv6 only, prefer <code>http://127.0.0.1:11434</code> here — the app also auto-tries 127.0.0.1 / localhost / [::1] as fallbacks.
                    {resolvedOllamaUrl && resolvedOllamaUrl !== settings.ollama_base_url.replace(/\/$/, "") && (
                      <> <br />Reachable via <code>{resolvedOllamaUrl}</code> — using that for chat.</>
                    )}
                  </p>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <Label>Local model</Label>
                    <LocalModelPicker
                      baseUrl={settings.ollama_base_url}
                      value={settings.ollama_model}
                      onChange={(v) => setSettings((s) => ({ ...s, ollama_model: v }))}
                      enabled={!settings.use_cloud}
                      onResolved={setResolvedOllamaUrl}
                    />
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
                <TestOllamaButton baseUrl={settings.ollama_base_url} model={settings.ollama_model} onPickModel={(m) => setSettings((s) => ({ ...s, ollama_model: m }))} />
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

          {/* Search */}
          <div className="relative mb-1">
            <Search className="h-3.5 w-3.5 absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search title or messages…"
              className="h-8 pl-7 pr-7 text-xs"
            />
            {search && (
              <button
                onClick={() => setSearch("")}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                aria-label="Clear search"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>

          {/* Filters */}
          <div className="grid grid-cols-2 gap-1 mb-1">
            <Select value={filterKind} onValueChange={(v) => setFilterKind(v as typeof filterKind)}>
              <SelectTrigger className="h-7 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All kinds</SelectItem>
                <SelectItem value="general">General</SelectItem>
                <SelectItem value="morning_review">Morning review</SelectItem>
                <SelectItem value="planning">Planning</SelectItem>
              </SelectContent>
            </Select>
            <Select value={filterRange} onValueChange={(v) => setFilterRange(v as typeof filterRange)}>
              <SelectTrigger className="h-7 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All time</SelectItem>
                <SelectItem value="today">Today</SelectItem>
                <SelectItem value="7d">Last 7 days</SelectItem>
                <SelectItem value="30d">Last 30 days</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-center justify-between px-1 mb-2">
            <button
              onClick={() => setFilterEscalated((v) => !v)}
              className={`flex items-center gap-1 text-[11px] rounded px-1.5 py-0.5 border ${filterEscalated ? "bg-primary/10 border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground"}`}
              title="Show only threads with promoted actions"
            >
              <ArrowUpRightSquare className="h-3 w-3" />
              Escalated only
            </button>
            {filtersActive && (
              <button onClick={clearFilters} className="text-[11px] text-muted-foreground hover:text-foreground">Clear</button>
            )}
          </div>

          {threads.length === 0 ? (
            <p className="text-xs text-muted-foreground px-2 py-4 text-center">No conversations yet. Start one above.</p>
          ) : visibleThreads.length === 0 ? (
            <p className="text-xs text-muted-foreground px-2 py-4 text-center">
              No matches.{" "}
              <button onClick={clearFilters} className="underline">Clear filters</button>
            </p>
          ) : (
            <div className="text-[10px] text-muted-foreground px-2 pb-1">
              {visibleThreads.length} of {threads.length}
            </div>
          )}
          {visibleThreads.map((t) => {
            const stats = threadStats[t.id];
            return (
              <div
                key={t.id}
                onClick={() => setActiveId(t.id)}
                className={`group flex items-start gap-1 rounded px-2 py-1.5 cursor-pointer text-sm hover:bg-muted ${activeId === t.id ? "bg-muted" : ""}`}
              >
                {t.agent_kind === "morning_review"
                  ? <Sun className="h-3.5 w-3.5 mt-0.5 text-amber-500 shrink-0" />
                  : t.agent_kind === "planning"
                    ? <ListTree className="h-3.5 w-3.5 mt-0.5 text-blue-500 shrink-0" />
                    : <MessageSquareText className="h-3.5 w-3.5 mt-0.5 text-muted-foreground shrink-0" />}
                <div className="flex-1 min-w-0">
                  <div className="truncate">{t.title}</div>
                  <div className="text-[10px] text-muted-foreground flex items-center gap-1.5">
                    <span>{new Date(t.updated_at).toLocaleDateString()}</span>
                    {stats?.msgs ? <span>· {stats.msgs} msg</span> : null}
                    {stats?.escalated ? (
                      <span className="inline-flex items-center gap-0.5 text-primary">
                        · <ArrowUpRightSquare className="h-2.5 w-2.5" />{stats.escalated}
                      </span>
                    ) : null}
                  </div>
                </div>
                <button
                  onClick={(e) => { e.stopPropagation(); deleteThread(t.id); }}
                  className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive"
                  aria-label="Delete"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            );
          })}
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
