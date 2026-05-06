import { useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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

export const TurnTracker = ({ nextUpTaskId }: { nextUpTaskId: string | null }) => {
  const [startedAt, setStartedAt] = useState<number | null>(() => {
    const v = localStorage.getItem(STORAGE_KEY);
    return v ? parseInt(v, 10) : null;
  });
  const [now, setNow] = useState(Date.now());
  const [showForm, setShowForm] = useState(false);
  const [tokensIn, setTokensIn] = useState("");
  const [tokensOut, setTokensOut] = useState("");
  const [model, setModel] = useState("");
  const [summary, setSummary] = useState("");
  const [issues, setIssues] = useState("");
  const [fixes, setFixes] = useState("");
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

  const stop = () => {
    if (!startedAt) return;
    endedRef.current = Date.now();
    setShowForm(true);
  };

  const cancel = () => {
    localStorage.removeItem(STORAGE_KEY);
    setStartedAt(null);
    setShowForm(false);
    endedRef.current = null;
    setTokensIn(""); setTokensOut(""); setModel(""); setSummary(""); setIssues(""); setFixes("");
  };

  const submit = async () => {
    if (!startedAt) return;
    const ended = endedRef.current ?? Date.now();
    if (!nextUpTaskId) {
      toast({ title: "No active task", description: "Set a phase to active and add a todo task.", variant: "destructive" });
      return;
    }
    const tIn = tokensIn ? parseInt(tokensIn, 10) : null;
    const tOut = tokensOut ? parseInt(tokensOut, 10) : null;
    const tTotal = (tIn ?? 0) + (tOut ?? 0) || null;
    const { data: u } = await supabase.auth.getUser();
    const { error } = await supabase.from("roadmap_work_log").insert({
      task_id: nextUpTaskId,
      started_at: new Date(startedAt).toISOString(),
      ended_at: new Date(ended).toISOString(),
      duration_ms: ended - startedAt,
      tokens_in: tIn, tokens_out: tOut, tokens_total: tTotal,
      model: model || null,
      summary: summary || null,
      issues: issues || null,
      fixes: fixes || null,
      author: u.user?.email ?? "operator",
      source: "lovable_agent",
    });
    if (error) {
      toast({ title: "Log failed", description: error.message, variant: "destructive" });
      return;
    }
    toast({ title: "Turn logged", description: `${fmt(ended - startedAt)}${tTotal ? ` · ${tTotal.toLocaleString()} tokens` : ""}` });
    cancel();
  };

  if (showForm && startedAt) {
    const ended = endedRef.current ?? Date.now();
    return (
      <div className="rounded-md border border-border bg-card p-3 w-[320px] space-y-2 shadow-md">
        <div className="flex items-center gap-2">
          <Sparkles className="h-3.5 w-3.5 text-primary" />
          <div className="text-xs font-medium">Log AI turn · {fmt(ended - startedAt)}</div>
        </div>
        <div className="grid grid-cols-2 gap-1.5">
          <Input className="h-7 text-xs" placeholder="tokens in" type="number" value={tokensIn} onChange={(e) => setTokensIn(e.target.value)} />
          <Input className="h-7 text-xs" placeholder="tokens out" type="number" value={tokensOut} onChange={(e) => setTokensOut(e.target.value)} />
        </div>
        <Input className="h-7 text-xs" placeholder="model (e.g. claude-sonnet-4.5)" value={model} onChange={(e) => setModel(e.target.value)} />
        <Textarea className="text-xs min-h-[40px]" placeholder="Summary of what was done" value={summary} onChange={(e) => setSummary(e.target.value)} />
        <div className="grid grid-cols-2 gap-1.5">
          <Textarea className="text-xs min-h-[40px]" placeholder="Issues" value={issues} onChange={(e) => setIssues(e.target.value)} />
          <Textarea className="text-xs min-h-[40px]" placeholder="Fixes" value={fixes} onChange={(e) => setFixes(e.target.value)} />
        </div>
        <div className="flex gap-1">
          <Button size="sm" className="h-7 text-xs flex-1" onClick={submit}>Save</Button>
          <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={cancel}>Discard</Button>
        </div>
      </div>
    );
  }

  if (startedAt) {
    return (
      <button
        onClick={stop}
        className="rounded-md border border-primary/40 bg-primary/10 hover:bg-primary/20 px-3 py-2 transition flex items-center gap-2"
        title="Stop and log this turn"
      >
        <Square className="h-3.5 w-3.5 text-primary" />
        <div className="text-left">
          <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Recording turn</div>
          <div className="text-sm font-mono tabular-nums">{fmt(now - startedAt)}</div>
        </div>
      </button>
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
