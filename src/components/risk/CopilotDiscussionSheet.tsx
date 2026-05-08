import { useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";
import { Mic, MicOff, Send, CheckCircle2, Sparkles } from "lucide-react";
import { toast } from "@/hooks/use-toast";

type Msg = {
  id: string;
  role: "user" | "copilot" | "system";
  source: "voice" | "text" | "system";
  body: string;
  model: string | null;
  created_at: string;
};

type Props = {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  findingId: string;
  findingTitle: string;
  severity: string;
  onDecisionRecorded?: () => void;
};

const OUTCOMES = [
  { value: "accept_risk", label: "Accept risk" },
  { value: "mitigate", label: "Mitigate" },
  { value: "convert_to_task", label: "Convert to task" },
  { value: "dismiss", label: "Dismiss" },
] as const;

export function CopilotDiscussionSheet({
  open, onOpenChange, findingId, findingTitle, severity, onDecisionRecorded,
}: Props) {
  const [discussionId, setDiscussionId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [streaming, setStreaming] = useState("");
  const [recording, setRecording] = useState(false);
  const [partial, setPartial] = useState("");
  const [outcome, setOutcome] = useState<string>("");
  const [decisionSummary, setDecisionSummary] = useState("");
  const [savingDecision, setSavingDecision] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);
  const mediaRef = useRef<MediaRecorder | null>(null);
  const scrollerRef = useRef<HTMLDivElement>(null);

  // Open or resume a copilot discussion when the sheet opens
  useEffect(() => {
    if (!open) return;
    (async () => {
      const { data: existing } = await supabase
        .from("roadmap_finding_discussions")
        .select("id")
        .eq("finding_id", findingId)
        .eq("mode", "copilot")
        .is("ended_at", null)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      let id = existing?.id;
      if (!id) {
        const { data: u } = await supabase.auth.getUser();
        const { data: created, error } = await supabase
          .from("roadmap_finding_discussions")
          .insert({ finding_id: findingId, mode: "copilot", started_by_user_id: u.user?.id ?? null })
          .select("id")
          .single();
        if (error || !created) {
          toast({ title: "Could not start discussion", description: error?.message, variant: "destructive" });
          return;
        }
        id = created.id;
        await supabase.from("roadmap_review_findings")
          .update({ discussion_status: "copilot_open" }).eq("id", findingId);
      }
      setDiscussionId(id);

      const { data: msgs } = await supabase
        .from("roadmap_finding_discussion_messages")
        .select("*").eq("discussion_id", id).order("created_at", { ascending: true });
      setMessages((msgs ?? []) as Msg[]);
    })();
  }, [open, findingId]);

  // Realtime: append new messages
  useEffect(() => {
    if (!discussionId) return;
    const ch = supabase
      .channel(`disc-${discussionId}`)
      .on("postgres_changes",
        { event: "INSERT", schema: "public", table: "roadmap_finding_discussion_messages", filter: `discussion_id=eq.${discussionId}` },
        (payload) => {
          const m = payload.new as Msg;
          setMessages((prev) => prev.some((x) => x.id === m.id) ? prev : [...prev, m]);
          if (m.role === "copilot") setStreaming("");
        })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [discussionId]);

  useEffect(() => {
    scrollerRef.current?.scrollTo({ top: scrollerRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, streaming, partial]);

  const sendMessage = async (text: string, source: "text" | "voice") => {
    if (!discussionId || !text.trim() || sending) return;
    setSending(true);
    setStreaming("");
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/finding-discuss-copilot`;
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
        if (resp.status === 429) toast({ title: "Rate limited", description: "Try again shortly.", variant: "destructive" });
        else if (resp.status === 402) toast({ title: "AI credits exhausted", description: "Add credits in workspace settings.", variant: "destructive" });
        else toast({ title: "Copilot error", description: e?.error ?? `HTTP ${resp.status}`, variant: "destructive" });
        setSending(false);
        return;
      }
      // Optimistic user echo (will be replaced by realtime row when it lands)
      const optimistic: Msg = {
        id: `tmp-${Date.now()}`, role: "user", source, body: text, model: null, created_at: new Date().toISOString(),
      };
      setMessages((prev) => [...prev, optimistic]);
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
      toast({ title: "Copilot error", description: e instanceof Error ? e.message : String(e), variant: "destructive" });
    } finally {
      setSending(false);
    }
  };

  const mintToken = async (): Promise<string | null> => {
    const { data: { session } } = await supabase.auth.getSession();
    const resp = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/deepgram-realtime-token`, {
      method: "POST",
      headers: { Authorization: `Bearer ${session?.access_token}` },
    });
    const body = await resp.text();
    console.log("[mic] token response", { status: resp.status, body });
    if (!resp.ok) {
      const retriable = resp.status === 502 || resp.status === 401 || resp.status === 504;
      const err: any = new Error(`token mint HTTP ${resp.status}`);
      err.status = resp.status;
      err.retriable = retriable;
      err.body = body;
      throw err;
    }
    try { return JSON.parse(body).key ?? null; } catch { return null; }
  };

  const openSocket = (key: string): Promise<WebSocket> => new Promise((resolve, reject) => {
    const ws = new WebSocket(
      `wss://api.deepgram.com/v1/listen?model=nova-3&smart_format=true&interim_results=true&endpointing=600`,
      ["bearer", key],
    );
    let settled = false;
    ws.onopen = () => { if (!settled) { settled = true; resolve(ws); } };
    ws.onclose = (ev) => {
      if (!settled) {
        settled = true;
        const retriable = ev.code === 1006 || ev.code === 1008 || ev.code === 4001 || ev.code === 4008;
        const err: any = new Error(`ws closed before open (code ${ev.code})`);
        err.code = ev.code;
        err.reason = ev.reason;
        err.retriable = retriable;
        reject(err);
      }
    };
    ws.onerror = (e) => console.error("[mic] ws error during open", e);
  });

  const startVoice = async () => {
    if (recording) return;
    let stream: MediaStream | null = null;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });

      const tryOnce = async (): Promise<WebSocket> => {
        console.log("[mic] minting token");
        const key = await mintToken();
        if (!key) throw new Error("no key returned");
        console.log("[mic] opening websocket");
        return await openSocket(key);
      };

      let ws: WebSocket;
      try {
        ws = await tryOnce();
      } catch (e: any) {
        if (e?.retriable) {
          console.warn("[mic] first attempt failed, retrying once", { err: e.message, status: e.status, code: e.code });
          toast({ title: "Reconnecting mic…", description: "Retrying after first failure" });
          await new Promise((r) => setTimeout(r, 400));
          ws = await tryOnce();
        } else {
          throw e;
        }
      }

      wsRef.current = ws;
      let finalText = "";

      console.log("[mic] ws open");
      const mr = new MediaRecorder(stream, { mimeType: "audio/webm" });
      mediaRef.current = mr;
      mr.ondataavailable = (ev) => {
        if (ev.data.size > 0 && ws.readyState === WebSocket.OPEN) ws.send(ev.data);
      };
      mr.start(250);
      setRecording(true);

      ws.onmessage = (ev) => {
        try {
          const msg = JSON.parse(ev.data);
          if (msg.type === "Error" || msg.error) console.error("[mic] ws message error", msg);
          const alt = msg?.channel?.alternatives?.[0];
          const text = alt?.transcript ?? "";
          if (!text) return;
          if (msg.is_final) {
            finalText += (finalText ? " " : "") + text;
            setPartial(finalText);
          } else {
            setPartial(finalText ? `${finalText} ${text}` : text);
          }
        } catch (e) { console.warn("[mic] ws message parse failed", e, ev.data); }
      };
      ws.onerror = (e) => {
        console.error("[mic] ws error event", e);
        toast({ title: "Mic stream error", description: "See console for details", variant: "destructive" });
      };
      ws.onclose = async (ev) => {
        console.log("[mic] ws close", { code: ev.code, reason: ev.reason, wasClean: ev.wasClean });
        if (!ev.wasClean && ev.code !== 1000) {
          toast({
            title: "Mic disconnected",
            description: `WS close ${ev.code}${ev.reason ? `: ${ev.reason}` : ""}`,
            variant: "destructive",
          });
        }
        setRecording(false);
        const said = finalText.trim();
        setPartial("");
        finalText = "";
        if (said) await sendMessage(said, "voice");
      };
    } catch (e: any) {
      console.error("[mic] startVoice failed", e);
      try { stream?.getTracks().forEach((t) => t.stop()); } catch {/**/}
      const detail = e?.status
        ? `HTTP ${e.status}${e.body ? ` — ${e.body}` : ""}`
        : e?.code
        ? `WS ${e.code}${e.reason ? `: ${e.reason}` : ""}`
        : e instanceof Error ? e.message : String(e);
      toast({ title: "Mic unavailable", description: detail, variant: "destructive" });
    }
  };

  const stopVoice = () => {
    try { mediaRef.current?.stop(); mediaRef.current?.stream.getTracks().forEach((t) => t.stop()); } catch {/**/}
    try { wsRef.current?.close(); } catch {/**/}
  };

  const recordDecision = async () => {
    if (!outcome) { toast({ title: "Pick an outcome first" }); return; }
    setSavingDecision(true);
    try {
      const { data: u } = await supabase.auth.getUser();
      const { error } = await supabase.from("roadmap_review_findings").update({
        decision_outcome: outcome,
        decision_summary: decisionSummary || null,
        decision_recorded_at: new Date().toISOString(),
        decision_recorded_by: u.user?.id ?? null,
        discussion_status: "resolved",
      }).eq("id", findingId);
      if (error) throw error;
      if (discussionId) {
        await supabase.from("roadmap_finding_discussion_messages").insert({
          discussion_id: discussionId,
          role: "system",
          source: "system",
          body: `Decision recorded: ${outcome}${decisionSummary ? ` — ${decisionSummary}` : ""}`,
        });
        await supabase.from("roadmap_finding_discussions")
          .update({ ended_at: new Date().toISOString() }).eq("id", discussionId);
      }
      toast({ title: "Decision recorded", description: outcome });
      onDecisionRecorded?.();
      onOpenChange(false);
    } catch (e) {
      toast({ title: "Could not save decision", description: e instanceof Error ? e.message : String(e), variant: "destructive" });
    } finally {
      setSavingDecision(false);
    }
  };

  const transcript = useMemo(() => messages, [messages]);

  return (
    <Sheet open={open} onOpenChange={(o) => { if (!o) stopVoice(); onOpenChange(o); }}>
      <SheetContent side="right" className="w-full sm:max-w-2xl flex flex-col">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            <Sparkles className="h-4 w-4" /> Discuss with Copilot
            <Badge variant="outline" className="text-[10px] uppercase">{severity}</Badge>
            {recording && <Badge variant="destructive" className="text-[10px] animate-pulse">REC</Badge>}
          </SheetTitle>
          <SheetDescription className="text-xs line-clamp-2">{findingTitle}</SheetDescription>
        </SheetHeader>

        <div ref={scrollerRef} className="flex-1 overflow-y-auto space-y-3 py-3 pr-1">
          {transcript.length === 0 && !streaming && (
            <p className="text-xs text-muted-foreground">No messages yet. Type or hit the mic to start.</p>
          )}
          {transcript.map((m) => (
            <div key={m.id} className={`rounded-md border p-2 text-sm ${m.role === "copilot" ? "bg-muted/40" : m.role === "system" ? "bg-accent/30 italic text-xs" : ""}`}>
              <div className="flex items-center gap-2 mb-1">
                <Badge variant="outline" className="text-[9px] uppercase">{m.role}</Badge>
                <Badge variant="outline" className="text-[9px]">{m.source}</Badge>
                <span className="text-[10px] text-muted-foreground">{new Date(m.created_at).toLocaleTimeString()}</span>
              </div>
              <div className="whitespace-pre-wrap">{m.body}</div>
            </div>
          ))}
          {streaming && (
            <div className="rounded-md border p-2 text-sm bg-muted/40">
              <div className="flex items-center gap-2 mb-1">
                <Badge variant="outline" className="text-[9px] uppercase">copilot</Badge>
                <span className="text-[10px] text-muted-foreground">streaming…</span>
              </div>
              <div className="whitespace-pre-wrap">{streaming}</div>
            </div>
          )}
          {partial && (
            <div className="rounded-md border border-dashed p-2 text-sm text-muted-foreground">
              <span className="text-[10px] uppercase mr-2">live mic</span>{partial}
            </div>
          )}
        </div>

        <div className="border-t pt-3 space-y-2">
          <div className="flex items-end gap-2">
            <Textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Type a message…"
              rows={2}
              className="resize-none"
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); sendMessage(input, "text"); }
              }}
            />
            <div className="flex flex-col gap-2">
              <Button size="icon" variant={recording ? "destructive" : "outline"} onClick={recording ? stopVoice : startVoice} title={recording ? "Stop mic" : "Start mic"}>
                {recording ? <MicOff className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
              </Button>
              <Button size="icon" onClick={() => sendMessage(input, "text")} disabled={sending || !input.trim()} title="Send (⌘/Ctrl+Enter)">
                <Send className="h-4 w-4" />
              </Button>
            </div>
          </div>

          <div className="rounded-md border p-3 space-y-2">
            <div className="flex items-center gap-2 text-sm font-medium">
              <CheckCircle2 className="h-4 w-4" /> Record decision
            </div>
            <RadioGroup value={outcome} onValueChange={setOutcome} className="grid grid-cols-2 gap-1 text-xs">
              {OUTCOMES.map((o) => (
                <div key={o.value} className="flex items-center gap-2">
                  <RadioGroupItem id={`oc-${o.value}`} value={o.value} />
                  <Label htmlFor={`oc-${o.value}`} className="cursor-pointer">{o.label}</Label>
                </div>
              ))}
            </RadioGroup>
            <Textarea
              value={decisionSummary} onChange={(e) => setDecisionSummary(e.target.value)}
              placeholder="Optional one-line rationale" rows={2} className="resize-none text-xs"
            />
            <Button size="sm" onClick={recordDecision} disabled={!outcome || savingDecision} className="w-full">
              {savingDecision ? "Saving…" : "Record decision & close"}
            </Button>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
