import { useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/hooks/use-toast";
import { Play, Square, Sparkles } from "lucide-react";

const STORAGE_KEY = "roadmap.turn.startedAt";

const fmt = (ms: number) => {
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  return `${m}m ${s % 60}s`;
};

// Parse tokens/model from a pasted blob: JSON usage object, raw numbers,
// or text containing "prompt_tokens": N / "completion_tokens": N / model: "..."
const parseUsage = (raw: string) => {
  const out: { tokens_in: number | null; tokens_out: number | null; model: string | null; text: string } = {
    tokens_in: null, tokens_out: null, model: null, text: raw,
  };
  if (!raw.trim()) return out;
  try {
    const j = JSON.parse(raw);
    const u = j.usage ?? j;
    out.tokens_in = u.prompt_tokens ?? u.input_tokens ?? u.tokens_in ?? null;
    out.tokens_out = u.completion_tokens ?? u.output_tokens ?? u.tokens_out ?? null;
    out.model = j.model ?? u.model ?? null;
    // include any text content for issues/fixes extraction
    const content = j.choices?.[0]?.message?.content ?? j.output_text ?? j.text ?? '';
    if (content) out.text = String(content);
    return out;
  } catch { /* fall through to regex */ }
  const num = (re: RegExp) => {
    const m = raw.match(re); return m ? parseInt(m[1], 10) : null;
  };
  out.tokens_in = num(/(?:prompt|input)_tokens["\s:]+(\d+)/i);
  out.tokens_out = num(/(?:completion|output)_tokens["\s:]+(\d+)/i);
  const mm = raw.match(/model["\s:]+["']?([\w./-]+)/i);
  out.model = mm ? mm[1] : null;
  return out;
};

// Mirror of edge-function extractor — keeps client previews accurate.
const extractIssuesAndFixes = (raw: string): { issues: string | null; fixes: string | null } => {
  if (!raw) return { issues: null, fixes: null };
  const text = raw.replace(/\r\n/g, '\n');
  const grab = (labels: string[]): string | null => {
    const re = new RegExp(
      `(?:^|\\n)\\s*(?:#{1,6}\\s*|\\*\\*|__)?(?:${labels.join('|')})(?:\\*\\*|__)?\\s*[:\\-–]\\s*\\n?([\\s\\S]*?)(?=\\n\\s*(?:#{1,6}\\s|\\*\\*[A-Z]|[A-Z][A-Za-z ]{2,30}\\s*[:\\-–]\\s*\\n)|\\n\\s*\\n\\s*\\n|$)`,
      'i',
    );
    const m = text.match(re);
    if (!m) return null;
    return m[1].split('\n').map((l) => l.replace(/^\s*[-*•\d.]+\s*/, '').trim()).filter(Boolean).slice(0, 8).join('\n').trim() || null;
  };
  let issues = grab(['issues?', 'problems?', 'errors?', 'bugs?', 'blockers?', 'failures?']);
  let fixes = grab(['fixes?', 'fixed', 'resolutions?', 'resolved', 'solutions?', 'changes?\\s+made']);
  if (!fixes) { const m = text.match(/\b(?:fixed|resolved|patched)\s+([^.\n]{5,200})/i); if (m) fixes = m[0].trim(); }
  if (!issues) { const m = text.match(/\b(?:error|failed|exception|broke|crashed)[^.\n]{5,200}/i); if (m) issues = m[0].trim(); }
  return { issues, fixes };
};

export const TurnTracker = ({ nextUpTaskId }: { nextUpTaskId: string | null }) => {
  const [startedAt, setStartedAt] = useState<number | null>(() => {
    const v = localStorage.getItem(STORAGE_KEY);
    return v ? parseInt(v, 10) : null;
  });
  const [now, setNow] = useState(Date.now());
  const [showForm, setShowForm] = useState(false);
  const [usage, setUsage] = useState("");
  const endedRef = useRef<number | null>(null);

  useEffect(() => {
    if (!startedAt) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [startedAt]);

  const start = () => {
    const t = Date.now();
    localStorage.setItem(STORAGE_KEY, String(t));
    setStartedAt(t);
  };

  const reset = () => {
    localStorage.removeItem(STORAGE_KEY);
    setStartedAt(null);
    setShowForm(false);
    endedRef.current = null;
    setUsage("");
  };

  const log = async (withUsage: string) => {
    if (!startedAt) return;
    const ended = endedRef.current ?? Date.now();
    if (!nextUpTaskId) {
      toast({ title: "No active task", description: "Set a phase to active and add a todo task.", variant: "destructive" });
      return;
    }
    const parsed = parseUsage(withUsage);
    const { data: settings } = await supabase
      .from("roadmap_autolog_settings" as any)
      .select("*").eq("id", true).maybeSingle();
    const s: Record<string, boolean> = (settings as any) ?? {
      enabled: true, capture_tokens: true, capture_duration: true, capture_model: true,
      capture_response: true, capture_response_meta: true, extract_issues_fixes: true,
    };
    if (!s.enabled) {
      toast({ title: "Auto-log disabled", description: "Enable it in Auto-log settings to record this turn." });
      reset();
      return;
    }
    const tTotal = s.capture_tokens ? ((parsed.tokens_in ?? 0) + (parsed.tokens_out ?? 0) || null) : null;
    const { issues, fixes } = s.extract_issues_fixes
      ? extractIssuesAndFixes(parsed.text)
      : { issues: null, fixes: null };
    const { data: u } = await supabase.auth.getUser();
    const { error } = await supabase.from("roadmap_work_log").insert({
      task_id: nextUpTaskId,
      started_at: new Date(startedAt).toISOString(),
      ended_at: new Date(ended).toISOString(),
      duration_ms: s.capture_duration ? ended - startedAt : null,
      tokens_in: s.capture_tokens ? parsed.tokens_in : null,
      tokens_out: s.capture_tokens ? parsed.tokens_out : null,
      tokens_total: tTotal,
      model: s.capture_model ? parsed.model : null,
      issues,
      fixes,
      response_preview: s.capture_response && withUsage ? withUsage.slice(0, 2000) : null,
      response_meta: s.capture_response_meta && (issues || fixes) ? { issues_fixes_auto_extracted: true } : {},
      author: u.user?.email ?? "operator",
      source: "lovable_agent",
    });
    if (error) {
      toast({ title: "Log failed", description: error.message, variant: "destructive" });
      return;
    }
    const extras = [
      tTotal ? `${tTotal.toLocaleString()} tokens` : null,
      issues ? "issues✓" : null,
      fixes ? "fixes✓" : null,
    ].filter(Boolean).join(" · ");
    toast({
      title: "Turn logged",
      description: `${fmt(ended - startedAt)}${extras ? ` · ${extras}` : " · duration only"}`,
    });
    reset();
  };

  const stop = async () => {
    if (!startedAt) return;
    endedRef.current = Date.now();
    // Auto-log immediately with duration only.
    await log("");
  };

  const stopWithUsage = () => {
    if (!startedAt) return;
    endedRef.current = Date.now();
    setShowForm(true);
  };

  if (showForm && startedAt) {
    const ended = endedRef.current ?? Date.now();
    return (
      <div className="rounded-md border border-border bg-card p-3 w-[320px] space-y-2 shadow-md">
        <div className="flex items-center gap-2">
          <Sparkles className="h-3.5 w-3.5 text-primary" />
          <div className="text-xs font-medium">Attach usage · {fmt(ended - startedAt)}</div>
        </div>
        <Textarea
          className="text-xs min-h-[80px] font-mono"
          placeholder='Paste raw usage JSON or text. Auto-extracts prompt_tokens, completion_tokens, model.'
          value={usage}
          onChange={(e) => setUsage(e.target.value)}
          autoFocus
        />
        <div className="flex gap-1">
          <Button size="sm" className="h-7 text-xs flex-1" onClick={() => log(usage)}>Save</Button>
          <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={reset}>Discard</Button>
        </div>
      </div>
    );
  }

  if (startedAt) {
    return (
      <div className="flex items-center gap-1">
        <button
          onClick={stop}
          className="rounded-md border border-primary/40 bg-primary/10 hover:bg-primary/20 px-3 py-2 transition flex items-center gap-2"
          title="Stop and auto-log duration"
        >
          <Square className="h-3.5 w-3.5 text-primary" />
          <div className="text-left">
            <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Recording · auto-log</div>
            <div className="text-sm font-mono tabular-nums">{fmt(now - startedAt)}</div>
          </div>
        </button>
        <button
          onClick={stopWithUsage}
          className="rounded-md border border-border hover:bg-muted px-2 py-2 text-[10px] uppercase tracking-wide text-muted-foreground"
          title="Stop and paste token usage"
        >
          + usage
        </button>
      </div>
    );
  }

  return (
    <button
      onClick={start}
      className="rounded-md border border-border hover:bg-muted px-3 py-2 transition flex items-center gap-2"
      title="Start tracking an AI turn"
    >
      <Play className="h-3.5 w-3.5 text-muted-foreground" />
      <div className="text-left">
        <div className="text-[10px] uppercase tracking-wide text-muted-foreground">AI turn</div>
        <div className="text-sm">Start tracking</div>
      </div>
    </button>
  );
};
