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
  const out: { tokens_in: number | null; tokens_out: number | null; model: string | null } = {
    tokens_in: null, tokens_out: null, model: null,
  };
  if (!raw.trim()) return out;
  try {
    const j = JSON.parse(raw);
    const u = j.usage ?? j;
    out.tokens_in = u.prompt_tokens ?? u.input_tokens ?? u.tokens_in ?? null;
    out.tokens_out = u.completion_tokens ?? u.output_tokens ?? u.tokens_out ?? null;
    out.model = j.model ?? u.model ?? null;
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
    const tTotal = (parsed.tokens_in ?? 0) + (parsed.tokens_out ?? 0) || null;
    const { data: u } = await supabase.auth.getUser();
    const { error } = await supabase.from("roadmap_work_log").insert({
      task_id: nextUpTaskId,
      started_at: new Date(startedAt).toISOString(),
      ended_at: new Date(ended).toISOString(),
      duration_ms: ended - startedAt,
      tokens_in: parsed.tokens_in,
      tokens_out: parsed.tokens_out,
      tokens_total: tTotal,
      model: parsed.model,
      author: u.user?.email ?? "operator",
      source: "lovable_agent",
    });
    if (error) {
      toast({ title: "Log failed", description: error.message, variant: "destructive" });
      return;
    }
    toast({
      title: "Turn logged",
      description: `${fmt(ended - startedAt)}${tTotal ? ` · ${tTotal.toLocaleString()} tokens` : " · duration only"}`,
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
