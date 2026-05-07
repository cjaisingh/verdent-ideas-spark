import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Mic, MicOff, Loader2, Volume2 } from "lucide-react";
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

  // Controls
  const [pttMode, setPttMode] = useState(false); // false = always-on (hands-free), true = push-to-talk
  const [pttHeld, setPttHeld] = useState(false);
  const [micGain, setMicGain] = useState(1.0);   // 0..2
  const [outVolume, setOutVolume] = useState(1.0); // 0..1.5
  const [micLevel, setMicLevel] = useState(0); // 0..1, smoothed RMS
  const [muted, setMuted] = useState(false);

  const wsRef = useRef<WebSocket | null>(null);
  const micCtxRef = useRef<AudioContext | null>(null);
  const playCtxRef = useRef<AudioContext | null>(null);
  const procRef = useRef<ScriptProcessorNode | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const playHeadRef = useRef<number>(0);
  const outGainRef = useRef<GainNode | null>(null);

  // Live refs for audio callback (avoids stale closure on state).
  const pttModeRef = useRef(pttMode);
  const pttHeldRef = useRef(pttHeld);
  const micGainRef = useRef(micGain);
  const mutedRef = useRef(muted);
  useEffect(() => { pttModeRef.current = pttMode; }, [pttMode]);
  useEffect(() => { pttHeldRef.current = pttHeld; }, [pttHeld]);
  useEffect(() => { micGainRef.current = micGain; }, [micGain]);
  useEffect(() => { mutedRef.current = muted; }, [muted]);
  useEffect(() => {
    if (outGainRef.current) outGainRef.current.gain.value = outVolume;
  }, [outVolume]);

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
    streamRef.current = null;
    outGainRef.current = null;
    playHeadRef.current = 0;
    setActive(false);
    setAgentState("idle");
    setMicLevel(0);
    setPttHeld(false);
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

      const outGain = playCtx.createGain();
      outGain.gain.value = outVolume;
      outGain.connect(playCtx.destination);
      outGainRef.current = outGain;

      const ws = new WebSocket(WS_URL);
      ws.binaryType = "arraybuffer";
      wsRef.current = ws;

      ws.onopen = () => ws.send(JSON.stringify({ type: "auth", jwt }));

      ws.onmessage = (ev) => {
        if (typeof ev.data === "string") {
          let m: any; try { m = JSON.parse(ev.data); } catch { return; }
          if (m.type === "ready") {
            append({ who: "system", text: "Connected.", ts: Date.now() });
            setAgentState("listening");
            setConnecting(false);
            const src = micCtx.createMediaStreamSource(stream);
            const proc = micCtx.createScriptProcessor(4096, 1, 1);
            procRef.current = proc;
            let lvlAccum = 0, lvlFrames = 0;
            proc.onaudioprocess = (e) => {
              if (ws.readyState !== WebSocket.OPEN) return;
              const f32 = e.inputBuffer.getChannelData(0);
              const gain = micGainRef.current;
              // RMS for level meter (pre-mute, post-gain).
              let sumSq = 0;
              const i16 = new Int16Array(f32.length);
              for (let i = 0; i < f32.length; i++) {
                const s = Math.max(-1, Math.min(1, f32[i] * gain));
                i16[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
                sumSq += s * s;
              }
              const rms = Math.sqrt(sumSq / f32.length);
              lvlAccum = Math.max(lvlAccum * 0.7, rms);
              if (++lvlFrames >= 3) {
                setMicLevel(Math.min(1, lvlAccum * 1.8));
                lvlFrames = 0;
              }
              // Gating: mute, or PTT mode and not held.
              const gated = mutedRef.current || (pttModeRef.current && !pttHeldRef.current);
              if (gated) {
                // Send silence to keep stream alive but not transmit speech.
                ws.send(new Int16Array(f32.length).buffer);
              } else {
                ws.send(i16.buffer);
              }
            };
            src.connect(proc);
            proc.connect(micCtx.destination);
            setActive(true);
          } else if (m.type === "ConversationText") {
            append({ who: m.role === "user" ? "you" : "copilot", text: m.content, ts: Date.now() });
          } else if (m.type === "UserStartedSpeaking") {
            setAgentState("listening");
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
          const ctx = playCtxRef.current!;
          const i16 = new Int16Array(ev.data as ArrayBuffer);
          const f32 = new Float32Array(i16.length);
          for (let i = 0; i < i16.length; i++) f32[i] = i16[i] / 0x8000;
          const buf = ctx.createBuffer(1, f32.length, 24000);
          buf.copyToChannel(f32, 0);
          const src = ctx.createBufferSource();
          src.buffer = buf;
          src.connect(outGainRef.current ?? ctx.destination);
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

  // Spacebar push-to-talk.
  useEffect(() => {
    if (!active || !pttMode) return;
    const down = (e: KeyboardEvent) => {
      if (e.code === "Space" && !e.repeat) { e.preventDefault(); setPttHeld(true); }
    };
    const up = (e: KeyboardEvent) => {
      if (e.code === "Space") { e.preventDefault(); setPttHeld(false); }
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
    };
  }, [active, pttMode]);

  useEffect(() => () => stop(), []);

  const transmitting = active && !muted && (!pttMode || pttHeld);
  const stateColor = !transmitting && active
    ? "bg-muted"
    : {
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
            ) : active && transmitting ? (
              <Mic className="size-12 text-background" />
            ) : (
              <MicOff className="size-12 text-muted-foreground" />
            )}
          </div>
          {transmitting && (
            <span className="absolute inset-0 rounded-full animate-ping opacity-30 bg-current" />
          )}
        </div>

        <div className="text-sm font-medium uppercase tracking-wide">
          {connecting ? "Connecting…" : !active ? "Idle" : muted ? "Muted" : pttMode && !pttHeld ? "Push to talk" : agentState}
        </div>

        {/* Mic level meter */}
        {active && (
          <div className="w-full max-w-xs">
            <div className="h-2 rounded-full bg-muted overflow-hidden">
              <div
                className={`h-full transition-[width] duration-75 ${
                  micLevel > 0.85 ? "bg-destructive" : micLevel > 0.5 ? "bg-amber-500" : "bg-emerald-500"
                } ${transmitting ? "" : "opacity-30"}`}
                style={{ width: `${Math.round(micLevel * 100)}%` }}
              />
            </div>
            <div className="text-xs text-muted-foreground text-center mt-1">Mic level</div>
          </div>
        )}

        {/* Push-to-talk button */}
        {active && pttMode && (
          <Button
            size="lg"
            variant={pttHeld ? "default" : "secondary"}
            className="select-none touch-none w-48"
            onMouseDown={() => setPttHeld(true)}
            onMouseUp={() => setPttHeld(false)}
            onMouseLeave={() => pttHeld && setPttHeld(false)}
            onTouchStart={(e) => { e.preventDefault(); setPttHeld(true); }}
            onTouchEnd={(e) => { e.preventDefault(); setPttHeld(false); }}
          >
            <Mic className="mr-2 size-5" />
            {pttHeld ? "Release to send" : "Hold to talk"}
          </Button>
        )}

        <div className="flex gap-2">
          {!active ? (
            <Button size="lg" onClick={start} disabled={connecting}>Start session</Button>
          ) : (
            <>
              <Button variant="outline" onClick={() => setMuted((m) => !m)}>
                {muted ? "Unmute" : "Mute"}
              </Button>
              <Button size="lg" variant="destructive" onClick={stop}>End session</Button>
            </>
          )}
        </div>
      </Card>

      {/* Audio controls */}
      <Card className="p-5 space-y-5">
        <div className="flex items-center justify-between">
          <div>
            <Label htmlFor="ptt-toggle" className="text-sm font-medium">Push-to-talk mode</Label>
            <p className="text-xs text-muted-foreground">
              Mic only sends while you hold the button (or Spacebar).
            </p>
          </div>
          <Switch id="ptt-toggle" checked={pttMode} onCheckedChange={setPttMode} />
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label className="text-sm flex items-center gap-2"><Mic className="size-4" /> Mic gain</Label>
            <span className="text-xs text-muted-foreground tabular-nums">{micGain.toFixed(2)}×</span>
          </div>
          <Slider value={[micGain]} min={0} max={2} step={0.05} onValueChange={(v) => setMicGain(v[0])} />
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label className="text-sm flex items-center gap-2"><Volume2 className="size-4" /> Output volume</Label>
            <span className="text-xs text-muted-foreground tabular-nums">{Math.round(outVolume * 100)}%</span>
          </div>
          <Slider value={[outVolume]} min={0} max={1.5} step={0.05} onValueChange={(v) => setOutVolume(v[0])} />
        </div>
      </Card>

      <Card className="p-4 max-h-[40vh] overflow-y-auto space-y-3">
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
        Tip: hands-free mode is best for driving. Push-to-talk is useful in noisy environments —
        hold the button or Spacebar to speak.
      </p>
    </div>
  );
}
