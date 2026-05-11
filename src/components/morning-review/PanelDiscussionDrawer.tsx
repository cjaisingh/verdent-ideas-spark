import { useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Send, Sparkles, Wrench, X, AlertTriangle, Loader2 } from "lucide-react";
import { toast } from "sonner";
import type { useMorningReviewTriage } from "@/hooks/useMorningReviewTriage";

type Msg = {
  id: string;
  role: "user" | "assistant" | "system";
  body: string;
  model: string | null;
  created_at: string;
};

type Props = {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  reviewId: string | null;
  reviewDate: string | null;
  panelRef: string | null;
  panelTitle: string | null;
  panelData?: unknown;
  triage: ReturnType<typeof useMorningReviewTriage>;
};

export default function PanelDiscussionDrawer({
  open, onOpenChange, reviewId, reviewDate, panelRef, panelTitle, panelData, triage,
}: Props) {
  const [discussionId, setDiscussionId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [streaming, setStreaming] = useState("");
  const [resolving, setResolving] = useState(false);
  const scrollerRef = useRef<HTMLDivElement>(null);

  // Open/resume discussion when sheet opens
  useEffect(() => {
    if (!open || !reviewId || !panelRef) return;
    let cancelled = false;
    (async () => {
      setMessages([]);
      setStreaming("");
      const { data: existing } = await supabase
        .from("morning_review_discussions")
        .select("id")
        .eq("review_id", reviewId)
        .eq("panel_ref", panelRef)
        .is("closed_at", null)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      let id = existing?.id as string | undefined;
      if (!id) {
        const { data: u } = await supabase.auth.getUser();
        const { data: created, error } = await supabase
          .from("morning_review_discussions")
          .insert({
            review_id: reviewId,
            panel_ref: panelRef,
            panel_title: panelTitle,
            created_by: u.user?.id ?? null,
          })
          .select("id")
          .single();
        if (error || !created) {
          toast.error(error?.message ?? "could not start discussion");
          return;
        }
        id = created.id;
      }
      if (cancelled) return;
      setDiscussionId(id);

      const { data: msgs } = await supabase
        .from("morning_review_discussion_messages")
        .select("*")
        .eq("discussion_id", id)
        .order("created_at", { ascending: true });
      if (!cancelled) setMessages((msgs ?? []) as Msg[]);
    })();
    return () => { cancelled = true; };
  }, [open, reviewId, panelRef, panelTitle]);

  // Realtime new messages
  useEffect(() => {
    if (!discussionId) return;
    const ch = supabase
      .channel(`mr-disc-${discussionId}-${Math.random().toString(36).slice(2, 8)}`)
      .on("postgres_changes",
        { event: "INSERT", schema: "public", table: "morning_review_discussion_messages", filter: `discussion_id=eq.${discussionId}` },
        (payload) => {
          const m = payload.new as Msg;
          setMessages((prev) => prev.some((x) => x.id === m.id) ? prev : [...prev, m]);
          if (m.role === "assistant") setStreaming("");
        })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [discussionId]);

  useEffect(() => {
    scrollerRef.current?.scrollTo({ top: scrollerRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, streaming]);

  const sendMessage = async () => {
    const text = input.trim();
    if (!text || !discussionId || sending) return;
    setSending(true);
    setStreaming("");
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/morning-review-discuss`;
      const resp = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session?.access_token}`,
        },
        body: JSON.stringify({ discussion_id: discussionId, user_message: text }),
      });
      if (!resp.ok || !resp.body) {
        const e = await resp.json().catch(() => ({}));
        if (resp.status === 429) toast.error("Rate limited — try again shortly.");
        else if (resp.status === 402) toast.error("AI credits exhausted.");
        else toast.error(e?.error ?? `HTTP ${resp.status}`);
        setSending(false);
        return;
      }
      // Optimistic user echo
      setMessages((prev) => [...prev, {
        id: `tmp-${Date.now()}`, role: "user", body: text, model: null, created_at: new Date().toISOString(),
      }]);
      setInput("");

      const reader = resp.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let acc = "";
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
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setSending(false);
    }
  };

  const [cancelOpen, setCancelOpen] = useState(false);
  const [cancelReason, setCancelReason] = useState("");

  const callResolve = async (action: "fix" | "cancel" | "escalate", payload: Record<string, unknown> = {}) => {
    if (!discussionId) return;
    setResolving(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/morning-review-resolve`;
      const resp = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session?.access_token}`,
        },
        body: JSON.stringify({ discussion_id: discussionId, action, ...payload }),
      });
      const j = await resp.json().catch(() => ({}));
      if (!resp.ok) {
        toast.error(j?.error ?? `HTTP ${resp.status}`);
        return;
      }
      if (action === "fix" || action === "escalate") {
        const label = action === "escalate" ? "Escalated" : "Queued";
        toast.success(`${label} as job #${j.short_num}`, {
          action: { label: "Open", onClick: () => window.open(`/jobs?focus=${j.short_num}`, "_self") },
        });
      } else {
        toast.success("Cancelled");
      }
      onOpenChange(false);
      setCancelOpen(false);
      setCancelReason("");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setResolving(false);
    }
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full sm:max-w-2xl flex flex-col p-0">
        <SheetHeader className="px-6 pt-6 pb-3 border-b">
          <SheetTitle className="flex items-center gap-2 flex-wrap">
            <Sparkles className="h-4 w-4" /> Discuss panel
            <Badge variant="outline" className="text-[10px]">{panelRef}</Badge>
          </SheetTitle>
          <SheetDescription className="text-xs line-clamp-2">
            {panelTitle} · {reviewDate}
          </SheetDescription>
        </SheetHeader>

        <div ref={scrollerRef} className="flex-1 overflow-y-auto px-6 py-4 space-y-3">
          {panelData != null && (
            <details className="text-xs rounded border bg-muted/30 px-3 py-2">
              <summary className="cursor-pointer text-muted-foreground">Panel data ({Array.isArray(panelData) ? `${panelData.length} item${panelData.length === 1 ? "" : "s"}` : "object"})</summary>
              <pre className="mt-2 overflow-x-auto text-[11px] max-h-48">{JSON.stringify(panelData, null, 2)}</pre>
            </details>
          )}

          {messages.length === 0 && !streaming && (
            <p className="text-xs text-muted-foreground">
              Ask a clarifying question, propose a fix, or jump straight to one of the four resolutions below.
            </p>
          )}
          {messages.map((m) => (
            <div
              key={m.id}
              className={`rounded-md border p-2 text-sm ${
                m.role === "assistant" ? "bg-muted/40"
                : m.role === "system" ? "bg-accent/30 italic text-xs" : ""
              }`}
            >
              <div className="flex items-center gap-2 mb-1">
                <Badge variant="outline" className="text-[9px] uppercase">{m.role}</Badge>
                <span className="text-[10px] text-muted-foreground">
                  {new Date(m.created_at).toLocaleTimeString()}
                </span>
                {m.model && <span className="text-[10px] text-muted-foreground">{m.model}</span>}
              </div>
              <div className="whitespace-pre-wrap">{m.body}</div>
            </div>
          ))}
          {streaming && (
            <div className="rounded-md border p-2 text-sm bg-muted/40">
              <div className="flex items-center gap-2 mb-1">
                <Badge variant="outline" className="text-[9px] uppercase">assistant</Badge>
                <span className="text-[10px] text-muted-foreground">streaming…</span>
              </div>
              <div className="whitespace-pre-wrap">{streaming}</div>
            </div>
          )}
        </div>

        <div className="border-t px-6 py-3 space-y-3 bg-background">
          <div className="flex gap-2">
            <Textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Ask anything about this panel…"
              rows={2}
              className="resize-none text-sm"
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); sendMessage(); }
              }}
            />
            <Button onClick={sendMessage} disabled={!input.trim() || sending || !discussionId} size="icon" className="self-end">
              {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            </Button>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            <Button size="sm" variant="outline" disabled={resolving} onClick={() => resolve("mirrored", "revisit")}>
              <ArrowUpRight className="h-3 w-3 mr-1" /> Mirror
            </Button>
            <Button size="sm" variant="outline" disabled={resolving} onClick={() => resolve("deferred", "revisit")}>
              <Clock className="h-3 w-3 mr-1" /> Defer
            </Button>
            <Button size="sm" variant="outline" disabled={resolving} onClick={() => resolve("done", "done")}>
              <CheckCircle2 className="h-3 w-3 mr-1" /> Done
            </Button>
            <Button size="sm" variant="outline" disabled={resolving} onClick={() => resolve("skipped", "skip")}>
              <MinusCircle className="h-3 w-3 mr-1" /> Skip
            </Button>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
