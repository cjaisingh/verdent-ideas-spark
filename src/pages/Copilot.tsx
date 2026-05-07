import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Mic, MicOff, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

type LogLine = { who: "you" | "copilot" | "system"; text: string; ts: number };

const PROJECT_ID = import.meta.env.VITE_SUPABASE_PROJECT_ID;
const WS_URL = `wss://${PROJECT_ID}.functions.supabase.co/copilot-voice`;

export default function Copilot() {
  const [active, setActive] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [agentState, setAgentState] = useState<"idle" | "listening" | "thinking" | "speaking">("idle");
  const [log, setLog] = useState<LogLine[]>([]);

  const wsRef = useRef<WebSocket | null>(null);
  const micCtxRef = useRef<AudioContext | null>(null);
  const playCtxRef = useRef<AudioContext | null>(null);
  const procRef = useRef<ScriptProcessorNode | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const playHeadRef = useRef<number>(0);

  const append = (line: LogLine) => setLog((l) => [...l.slice(-40), line]);

  const stop = () => {
    try { wsRef.current?.close(); } catch {}
    try { procRef.current?.disconnect(); } catch {}
    try { streamRef.current?.getTracks().forEach((t) => t.stop()); } catch {}
    try { micCtxRef.current?.close(); } catch {}
    try { playCtxRef.current?.close(); } catch {}
    wsRef.current = null;
    micCtxRef.current = null;
    playCtxRef.current = null;
    procRef.current = null;
    streamRef.current = null;
    playHeadRef.current = 0;
    setActive(false);
    setAgentState("idle");
  };

  const start = async () => {
    setConnecting(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const jwt = session?.access_token;
      if (!jwt) throw new Error("Not signed in");

      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { sampleRate: 16000, channelCount: 1, echoCancellation: true, noiseSuppression: true },
      });
      streamRef.current = stream;

      const micCtx = new AudioContext({ sampleRate: 16000 });
      micCtxRef.current = micCtx;
      const playCtx = new AudioContext({ sampleRate: 24000 });
      playCtxRef.current = playCtx;
      playHeadRef.current = playCtx.currentTime;

      const ws = new WebSocket(WS_URL);
      ws.binaryType = "arraybuffer";
      wsRef.current = ws;

      ws.onopen = () => {
        ws.send(JSON.stringify({ type: "auth", jwt }));
      };

      ws.onmessage = (ev) => {
        if (typeof ev.data === "string") {
          let m: any; try { m = JSON.parse(ev.data); } catch { return; }
          if (m.type === "ready") {
            append({ who: "system", text: "Connected. Speak any time.", ts: Date.now() });
            setAgentState("listening");
            setConnecting(false);
            // Start streaming mic.
            const src = micCtx.createMediaStreamSource(stream);
            const proc = micCtx.createScriptProcessor(4096, 1, 1);
            procRef.current = proc;
            proc.onaudioprocess = (e) => {
              if (ws.readyState !== WebSocket.OPEN) return;
              const f32 = e.inputBuffer.getChannelData(0);
              const i16 = new Int16Array(f32.length);
              for (let i = 0; i < f32.length; i++) {
                const s = Math.max(-1, Math.min(1, f32[i]));
                i16[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
              }
              ws.send(i16.buffer);
            };
            src.connect(proc);
            proc.connect(micCtx.destination);
            setActive(true);
          } else if (m.type === "ConversationText") {
            append({ who: m.role === "user" ? "you" : "copilot", text: m.content, ts: Date.now() });
          } else if (m.type === "UserStartedSpeaking") {
            setAgentState("listening");
            // Barge-in: drop queued playback.
            playHeadRef.current = playCtxRef.current!.currentTime;
          } else if (m.type === "AgentThinking") {
            setAgentState("thinking");
          } else if (m.type === "AgentStartedSpeaking") {
            setAgentState("speaking");
          } else if (m.type === "AgentAudioDone" || m.type === "AgentTurnComplete") {
            setAgentState("listening");
          } else if (m.type === "error") {
            toast.error(m.error || "Copilot error");
            stop();
          }
        } else {
          // Binary PCM 16-bit @ 24kHz from Deepgram → schedule playback.
          const ctx = playCtxRef.current!;
          const i16 = new Int16Array(ev.data as ArrayBuffer);
          const f32 = new Float32Array(i16.length);
          for (let i = 0; i < i16.length; i++) f32[i] = i16[i] / 0x8000;
          const buf = ctx.createBuffer(1, f32.length, 24000);
          buf.copyToChannel(f32, 0);
          const src = ctx.createBufferSource();
          src.buffer = buf;
          src.connect(ctx.destination);
          const startAt = Math.max(playHeadRef.current, ctx.currentTime);
          src.start(startAt);
          playHeadRef.current = startAt + buf.duration;
        }
      };

      ws.onerror = () => toast.error("Connection error");
      ws.onclose = () => stop();
    } catch (e: any) {
      toast.error(e.message || "Failed to start");
      setConnecting(false);
      stop();
    }
  };

  useEffect(() => () => stop(), []);

  const stateColor = {
    idle: "bg-muted",
    listening: "bg-emerald-500",
    thinking: "bg-amber-500",
    speaking: "bg-sky-500",
  }[agentState];

  return (
    <div className="space-y-6 max-w-3xl">
      <div>
        <h1 className="text-2xl font-semibold">Copilot</h1>
        <p className="text-sm text-muted-foreground">
          Hands-free voice console. Powered by Deepgram Voice Agent + AWIP tools.
        </p>
      </div>

      <Card className="p-8 flex flex-col items-center gap-6">
        <div className="relative">
          <div
            className={`size-32 rounded-full flex items-center justify-center transition-colors ${stateColor}`}
          >
            {connecting ? (
              <Loader2 className="size-12 animate-spin text-background" />
            ) : active ? (
              <Mic className="size-12 text-background" />
            ) : (
              <MicOff className="size-12 text-muted-foreground" />
            )}
          </div>
          {active && (
            <span className="absolute inset-0 rounded-full animate-ping opacity-30 bg-current" />
          )}
        </div>
        <div className="text-sm font-medium uppercase tracking-wide">
          {connecting ? "Connecting…" : active ? agentState : "Idle"}
        </div>
        {!active ? (
          <Button size="lg" onClick={start} disabled={connecting}>
            Start session
          </Button>
        ) : (
          <Button size="lg" variant="destructive" onClick={stop}>
            End session
          </Button>
        )}
      </Card>

      <Card className="p-4 max-h-[50vh] overflow-y-auto space-y-3">
        {log.length === 0 ? (
          <p className="text-sm text-muted-foreground">Conversation will appear here.</p>
        ) : (
          log.map((l, i) => (
            <div key={i} className="text-sm">
              <span
                className={
                  l.who === "you"
                    ? "font-semibold text-foreground"
                    : l.who === "copilot"
                    ? "font-semibold text-primary"
                    : "font-medium text-muted-foreground"
                }
              >
                {l.who === "you" ? "You" : l.who === "copilot" ? "Copilot" : "System"}:
              </span>{" "}
              <span className="text-foreground">{l.text}</span>
            </div>
          ))
        )}
      </Card>

      <p className="text-xs text-muted-foreground">
        Tip: open this page on your phone before driving and tap Start. The session stays
        open and you can interrupt Copilot at any time.
      </p>
    </div>
  );
}
