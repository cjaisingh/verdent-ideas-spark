import { useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Mic, MicOff } from "lucide-react";
import { toast } from "@/hooks/use-toast";

/**
 * Reusable Deepgram realtime mic button.
 * - Mints a short-lived token via the `deepgram-realtime-token` edge function
 * - Streams mic audio over WS to Deepgram nova-3
 * - Calls `onPartial` with interim text and `onFinal` with the full utterance
 *   when recording stops (so the parent can append it to its composer).
 *
 * Pattern lifted from src/components/risk/CopilotDiscussionSheet.tsx.
 */
export function VoiceDictateButton({
  onPartial,
  onFinal,
  disabled,
}: {
  onPartial?: (text: string) => void;
  onFinal: (text: string) => void;
  disabled?: boolean;
}) {
  const [recording, setRecording] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);
  const mediaRef = useRef<MediaRecorder | null>(null);

  const mintToken = async (): Promise<string | null> => {
    const { data: { session } } = await supabase.auth.getSession();
    const resp = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/deepgram-realtime-token`, {
      method: "POST",
      headers: { Authorization: `Bearer ${session?.access_token}` },
    });
    const body = await resp.text();
    if (!resp.ok) {
      let parsed: any = {};
      try { parsed = JSON.parse(body); } catch {/**/}
      const nonRetriable = new Set(["DG_KEY_FORBIDDEN", "DG_KEY_UNAUTHORIZED", "AUTH_NOT_OPERATOR", "CONFIG_MISSING_KEY"]);
      const retriable =
        !nonRetriable.has(parsed?.code) &&
        (resp.status === 502 || resp.status === 504 || parsed?.code === "DG_RATE_LIMITED");
      const err: any = new Error(`token mint HTTP ${resp.status}${parsed?.code ? ` [${parsed.code}]` : ""}`);
      err.status = resp.status; err.code = parsed?.code; err.hint = parsed?.hint;
      err.retriable = retriable; err.body = body;
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
        err.code = ev.code; err.reason = ev.reason; err.retriable = retriable;
        reject(err);
      }
    };
  });

  const start = async () => {
    if (recording) return;
    let stream: MediaStream | null = null;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });

      const tryOnce = async () => {
        const key = await mintToken();
        if (!key) throw new Error("no key returned");
        return await openSocket(key);
      };

      let ws: WebSocket;
      try { ws = await tryOnce(); }
      catch (e: any) {
        if (e?.retriable) {
          await new Promise((r) => setTimeout(r, 400));
          ws = await tryOnce();
        } else throw e;
      }
      wsRef.current = ws;

      let finalText = "";
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
          const alt = msg?.channel?.alternatives?.[0];
          const text = alt?.transcript ?? "";
          if (!text) return;
          if (msg.is_final) {
            finalText += (finalText ? " " : "") + text;
            onPartial?.(finalText);
          } else {
            onPartial?.(finalText ? `${finalText} ${text}` : text);
          }
        } catch {/**/}
      };
      ws.onclose = (ev) => {
        if (!ev.wasClean && ev.code !== 1000) {
          toast({ title: "Mic disconnected", description: `WS close ${ev.code}${ev.reason ? `: ${ev.reason}` : ""}`, variant: "destructive" });
        }
        setRecording(false);
        const said = finalText.trim();
        onPartial?.("");
        if (said) onFinal(said);
        try { stream?.getTracks().forEach((t) => t.stop()); } catch {/**/}
      };
    } catch (e: any) {
      try { stream?.getTracks().forEach((t) => t.stop()); } catch {/**/}
      const detail = e?.status
        ? `[${e.code ?? "HTTP_" + e.status}] ${e.hint ?? e.body ?? e.message}`
        : typeof e?.code === "number"
          ? `WS ${e.code}${e.reason ? `: ${e.reason}` : ""}`
          : e instanceof Error ? e.message : String(e);
      toast({ title: "Mic unavailable", description: detail, variant: "destructive" });
      setRecording(false);
    }
  };

  const stop = () => {
    try { mediaRef.current?.stop(); mediaRef.current?.stream.getTracks().forEach((t) => t.stop()); } catch {/**/}
    try { wsRef.current?.close(); } catch {/**/}
  };

  return (
    <Button
      type="button"
      variant={recording ? "destructive" : "outline"}
      size="icon"
      onClick={recording ? stop : start}
      disabled={disabled}
      title={recording ? "Stop recording" : "Dictate (Deepgram)"}
    >
      {recording ? (
        <span className="relative inline-flex">
          <MicOff className="h-4 w-4" />
          <Badge variant="destructive" className="absolute -top-2 -right-3 text-[8px] px-1 py-0 animate-pulse">REC</Badge>
        </span>
      ) : (
        <Mic className="h-4 w-4" />
      )}
    </Button>
  );
}
