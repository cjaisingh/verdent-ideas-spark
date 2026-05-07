import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import {
  Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle, SheetTrigger,
} from "@/components/ui/sheet";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Mic, MicOff, Loader2, Volume2, Settings2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { useCopilotAgents } from "@/hooks/useCopilotAgents";
import { AgentSelector } from "@/components/copilot/AgentSelector";
import { AgentScopeCard } from "@/components/copilot/AgentScopeCard";

type LogLine = { who: "you" | "copilot" | "system"; text: string; ts: number };

const PROJECT_ID = import.meta.env.VITE_SUPABASE_PROJECT_ID;
const WS_URL = `wss://${PROJECT_ID}.functions.supabase.co/copilot-voice`;

const STT_MODELS = [
  { value: "nova-3", label: "Nova-3 (latest, best accuracy)" },
  { value: "nova-2", label: "Nova-2 (proven, fast)" },
  { value: "nova-2-conversationalai", label: "Nova-2 conversational" },
  { value: "enhanced", label: "Enhanced (legacy)" },
];
const TTS_VOICES = [
  { value: "aura-2-orion-en", label: "Aura-2 Orion (male, en)" },
  { value: "aura-2-helios-en", label: "Aura-2 Helios (male, en)" },
  { value: "aura-2-luna-en", label: "Aura-2 Luna (female, en)" },
  { value: "aura-2-stella-en", label: "Aura-2 Stella (female, en)" },
  { value: "aura-asteria-en", label: "Aura Asteria (female, en)" },
  { value: "aura-arcas-en", label: "Aura Arcas (male, en)" },
];
const LANGUAGES = [
  { value: "en", label: "English" },
  { value: "en-GB", label: "English (UK)" },
  { value: "en-US", label: "English (US)" },
  { value: "es", label: "Spanish" },
  { value: "fr", label: "French" },
  { value: "de", label: "German" },
];

export default function Copilot() {
  const [active, setActive] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [agentState, setAgentState] = useState<"idle" | "listening" | "thinking" | "speaking">("idle");
  const [log, setLog] = useState<LogLine[]>([]);

  // Controls (persisted per operator in copilot_settings)
  const [pttMode, setPttMode] = useState(false);
  const [pttHeld, setPttHeld] = useState(false);
  const [micGain, setMicGain] = useState(1.0);
  const [noiseGate, setNoiseGate] = useState(0.02); // RMS threshold 0..0.5
  const [outVolume, setOutVolume] = useState(1.0);
  const [micLevel, setMicLevel] = useState(0);
  const [muted, setMuted] = useState(false);
  const [autoMuteReason, setAutoMuteReason] = useState<string | null>(null);

  // Voice/STT settings (persisted)
  const [sttModel, setSttModel] = useState("nova-3");
  const [ttsVoice, setTtsVoice] = useState("aura-2-orion-en");
  const [language, setLanguage] = useState("en");
  const [greeting, setGreeting] = useState("Copilot ready.");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [savingSettings, setSavingSettings] = useState(false);
  const [settingsLoaded, setSettingsLoaded] = useState(false);

  // Multi-agent catalog (shared) + per-user overrides + the operator's active pick.
  const { agents, effective, overrideByAgent, upsertOverride, loaded: agentsLoaded } = useCopilotAgents();
  const [activeAgentId, setActiveAgentId] = useState<string | null>(null);
  const activeAgentRaw = agents.find((a) => a.id === activeAgentId) ?? null;
  const activeAgent = activeAgentRaw ? effective(activeAgentRaw) : null;
  const ttsVoiceRef = useRef<string>(ttsVoice);
  useEffect(() => {
    if (activeAgent) ttsVoiceRef.current = activeAgent.tts_voice;
    else ttsVoiceRef.current = ttsVoice;
  }, [activeAgent, ttsVoice]);

  const wsRef = useRef<WebSocket | null>(null);
  const micCtxRef = useRef<AudioContext | null>(null);
  const playCtxRef = useRef<AudioContext | null>(null);
  const workletRef = useRef<AudioWorkletNode | null>(null);
  const micSourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const playHeadRef = useRef<number>(0);
  const outGainRef = useRef<GainNode | null>(null);
  const transcriptRef = useRef<HTMLDivElement | null>(null);

  // Auto-scroll transcript to bottom on new messages.
  useEffect(() => {
    const el = transcriptRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [log]);

  // Live refs for audio callback (avoids stale closure on state).
  const pttModeRef = useRef(pttMode);
  const pttHeldRef = useRef(pttHeld);
  const micGainRef = useRef(micGain);
  const noiseGateRef = useRef(noiseGate);
  const gateHoldRef = useRef(0); // ms remaining of "open" hold-over
  const mutedRef = useRef(muted);
  useEffect(() => { pttModeRef.current = pttMode; }, [pttMode]);
  useEffect(() => { pttHeldRef.current = pttHeld; }, [pttHeld]);
  useEffect(() => {
    micGainRef.current = micGain;
    workletRef.current?.port.postMessage({ gain: micGain });
  }, [micGain]);
  useEffect(() => { noiseGateRef.current = noiseGate; }, [noiseGate]);
  useEffect(() => { mutedRef.current = muted; }, [muted]);
  useEffect(() => {
    if (outGainRef.current) outGainRef.current.gain.value = outVolume;
  }, [outVolume]);

  // ---- Auto-mute on lost audio focus / call interruption ----
  // Respects the user's manual mute: if they muted themselves, we never auto-unmute.
  const userMutedRef = useRef(muted);
  useEffect(() => {
    if (!autoMuteReason) userMutedRef.current = muted;
  }, [muted, autoMuteReason]);

  const applyAutoMute = (reason: string) => {
    setAutoMuteReason((prev) => prev ?? reason);
    setMuted(true);
    toast.warning(`Copilot auto-muted: ${reason}`);
  };
  const clearAutoMute = () => {
    setAutoMuteReason((prev) => {
      if (!prev) return null;
      setMuted(userMutedRef.current);
      toast.info("Copilot mic restored");
      return null;
    });
  };

  useEffect(() => {
    if (!active) return;
    const onVisibility = () => {
      if (document.hidden) applyAutoMute("tab hidden");
      else if (autoMuteReason === "tab hidden") clearAutoMute();
    };
    const onBlur = () => applyAutoMute("window lost focus");
    const onFocus = () => {
      if (autoMuteReason === "window lost focus") clearAutoMute();
    };
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("blur", onBlur);
    window.addEventListener("focus", onFocus);

    const micCtx = micCtxRef.current;
    const playCtx = playCtxRef.current;
    const onCtxState = () => {
      const s = micCtx?.state as string | undefined;
      if (s === "suspended" || s === "interrupted") {
        applyAutoMute("audio focus lost (call?)");
      } else if (s === "running" && autoMuteReason === "audio focus lost (call?)") {
        clearAutoMute();
      }
    };
    micCtx?.addEventListener("statechange", onCtxState);
    playCtx?.addEventListener("statechange", onCtxState);

    const track = streamRef.current?.getAudioTracks()[0];
    const onTrackEnded = () => applyAutoMute("microphone released");
    const onTrackMute = () => applyAutoMute("microphone muted by system");
    const onTrackUnmute = () => {
      if (autoMuteReason === "microphone muted by system") clearAutoMute();
    };
    track?.addEventListener("ended", onTrackEnded);
    track?.addEventListener("mute", onTrackMute);
    track?.addEventListener("unmute", onTrackUnmute);

    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("blur", onBlur);
      window.removeEventListener("focus", onFocus);
      micCtx?.removeEventListener("statechange", onCtxState);
      playCtx?.removeEventListener("statechange", onCtxState);
      track?.removeEventListener("ended", onTrackEnded);
      track?.removeEventListener("mute", onTrackMute);
      track?.removeEventListener("unmute", onTrackUnmute);
    };
  }, [active, autoMuteReason]);

  const append = (line: LogLine) => setLog((l) => [...l.slice(-40), line]);

  const stop = () => {
    try { wsRef.current?.close(); } catch {}
    try { workletRef.current?.disconnect(); } catch {}
    try { workletRef.current?.port.close(); } catch {}
    try { micSourceRef.current?.disconnect(); } catch {}
    try { streamRef.current?.getTracks().forEach((t) => t.stop()); } catch {}
    try { micCtxRef.current?.close(); } catch {}
    try { playCtxRef.current?.close(); } catch {}
    wsRef.current = null;
    workletRef.current = null;
    micSourceRef.current = null;
    micCtxRef.current = null;
    playCtxRef.current = null;
    streamRef.current = null;
    outGainRef.current = null;
    playHeadRef.current = 0;
    setActive(false);
    setAgentState("idle");
    setMicLevel(0);
    setPttHeld(false);
    setAutoMuteReason(null);
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

      // Load mic AudioWorklet (file in /public). Lower-latency than ScriptProcessorNode.
      await micCtx.audioWorklet.addModule("/copilot-mic-worklet.js");

      const outGain = playCtx.createGain();
      outGain.gain.value = outVolume;
      outGain.connect(playCtx.destination);
      outGainRef.current = outGain;

      const ws = new WebSocket(WS_URL);
      ws.binaryType = "arraybuffer";
      wsRef.current = ws;

      ws.onopen = () => ws.send(JSON.stringify({
        type: "auth",
        jwt,
        settings: { stt_model: sttModel, tts_voice: ttsVoice, language, greeting },
      }));

      ws.onmessage = (ev) => {
        if (typeof ev.data === "string") {
          let m: any; try { m = JSON.parse(ev.data); } catch { return; }
          if (m.type === "ready") {
            append({ who: "system", text: "Connected.", ts: Date.now() });
            setAgentState("listening");
            setConnecting(false);
            const src = micCtx.createMediaStreamSource(stream);
            micSourceRef.current = src;
            const node = new AudioWorkletNode(micCtx, "copilot-mic", {
              numberOfInputs: 1,
              numberOfOutputs: 0,
              channelCount: 1,
            });
            workletRef.current = node;
            node.port.postMessage({ gain: micGainRef.current });
            let lvlAccum = 0, lvlFrames = 0;
            node.port.onmessage = (ev) => {
              if (ws.readyState !== WebSocket.OPEN) return;
              const { pcm, rms } = ev.data as { pcm: ArrayBuffer; rms: number };
              lvlAccum = Math.max(lvlAccum * 0.7, rms);
              if (++lvlFrames >= 3) {
                setMicLevel(Math.min(1, lvlAccum * 1.8));
                lvlFrames = 0;
              }
              const muteOrPtt = mutedRef.current || (pttModeRef.current && !pttHeldRef.current);
              // Noise gate (always-on mode only — PTT already gates explicitly).
              let gateClosed = false;
              if (!pttModeRef.current && noiseGateRef.current > 0) {
                if (rms >= noiseGateRef.current) {
                  gateHoldRef.current = 300; // ms hold-open after voice
                } else {
                  gateHoldRef.current = Math.max(0, gateHoldRef.current - 20);
                  if (gateHoldRef.current === 0) gateClosed = true;
                }
              }
              if (muteOrPtt || gateClosed) {
                ws.send(new ArrayBuffer(pcm.byteLength));
              } else {
                ws.send(pcm);
              }
            };
            src.connect(node);
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

  // Load persisted settings on mount.
  useEffect(() => {
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { setSettingsLoaded(true); return; }
      const { data, error } = await supabase
        .from("copilot_settings")
        .select("*")
        .eq("user_id", user.id)
        .maybeSingle();
      if (!error && data) {
        setSttModel(data.stt_model);
        setTtsVoice(data.tts_voice);
        setLanguage(data.language);
        setGreeting(data.greeting);
        setPttMode(data.ptt_mode);
        setMicGain(Number(data.mic_gain));
        setOutVolume(Number(data.out_volume));
        if (data.noise_gate != null) setNoiseGate(Number(data.noise_gate));
      }
      setSettingsLoaded(true);
    })();
  }, []);

  // Debounced auto-save of audio knobs (sliders / toggle).
  useEffect(() => {
    if (!settingsLoaded) return;
    const t = setTimeout(async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      await supabase.from("copilot_settings").upsert({
        user_id: user.id,
        stt_model: sttModel,
        tts_voice: ttsVoice,
        language,
        greeting,
        ptt_mode: pttMode,
        mic_gain: micGain,
        out_volume: outVolume,
        noise_gate: noiseGate,
      }, { onConflict: "user_id" });
    }, 600);
    return () => clearTimeout(t);
  }, [settingsLoaded, pttMode, micGain, outVolume, noiseGate]);

  const saveVoiceSettings = async () => {
    setSavingSettings(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Not signed in");
      const { error } = await supabase.from("copilot_settings").upsert({
        user_id: user.id,
        stt_model: sttModel,
        tts_voice: ttsVoice,
        language,
        greeting,
        ptt_mode: pttMode,
        mic_gain: micGain,
        out_volume: outVolume,
        noise_gate: noiseGate,
      }, { onConflict: "user_id" });
      if (error) throw error;
      toast.success("Voice settings saved" + (active ? " — restart session to apply" : ""));
      setSettingsOpen(false);
    } catch (e: any) {
      toast.error(e.message || "Failed to save");
    } finally {
      setSavingSettings(false);
    }
  };

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
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Copilot</h1>
          <p className="text-sm text-muted-foreground">
            Hands-free voice console. Powered by Deepgram Voice Agent + AWIP tools.
          </p>
        </div>
        <Sheet open={settingsOpen} onOpenChange={setSettingsOpen}>
          <SheetTrigger asChild>
            <Button variant="outline" size="sm">
              <Settings2 className="size-4 mr-2" /> Session settings
            </Button>
          </SheetTrigger>
          <SheetContent className="w-full sm:max-w-md overflow-y-auto">
            <SheetHeader>
              <SheetTitle>Session settings</SheetTitle>
              <SheetDescription>
                Voice and STT options for your Copilot. Saved to your operator profile.
                Changes apply on the next session start.
              </SheetDescription>
            </SheetHeader>
            <div className="py-6 space-y-5">
              <div className="space-y-2">
                <Label className="text-sm">Speech-to-text model</Label>
                <Select value={sttModel} onValueChange={setSttModel}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {STT_MODELS.map((m) => (
                      <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label className="text-sm">TTS voice</Label>
                <Select value={ttsVoice} onValueChange={setTtsVoice}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {TTS_VOICES.map((v) => (
                      <SelectItem key={v.value} value={v.value}>{v.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label className="text-sm">Language</Label>
                <Select value={language} onValueChange={setLanguage}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {LANGUAGES.map((l) => (
                      <SelectItem key={l.value} value={l.value}>{l.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label className="text-sm" htmlFor="greeting">Greeting</Label>
                <Input
                  id="greeting"
                  value={greeting}
                  onChange={(e) => setGreeting(e.target.value)}
                  placeholder="Copilot ready."
                />
                <p className="text-xs text-muted-foreground">Spoken when a session starts.</p>
              </div>
            </div>
            <SheetFooter>
              <Button variant="ghost" onClick={() => setSettingsOpen(false)}>Cancel</Button>
              <Button onClick={saveVoiceSettings} disabled={savingSettings}>
                {savingSettings ? "Saving…" : "Save"}
              </Button>
            </SheetFooter>
          </SheetContent>
        </Sheet>
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

        <div className="text-sm font-medium uppercase tracking-wide text-center">
          {connecting
            ? "Connecting…"
            : !active
            ? "Idle"
            : autoMuteReason
            ? `Auto-muted · ${autoMuteReason}`
            : muted
            ? "Muted"
            : pttMode && !pttHeld
            ? "Push to talk"
            : agentState}
        </div>

        {/* Mic level meter */}
        {active && (
          <div className="w-full max-w-xs">
            <div className="relative h-2 rounded-full bg-muted overflow-hidden">
              <div
                className={`h-full transition-[width] duration-75 ${
                  micLevel > 0.85 ? "bg-destructive" : micLevel > 0.5 ? "bg-amber-500" : "bg-emerald-500"
                } ${transmitting ? "" : "opacity-30"}`}
                style={{ width: `${Math.round(micLevel * 100)}%` }}
              />
              {!pttMode && noiseGate > 0 && (
                <div
                  className="absolute top-0 bottom-0 w-px bg-foreground/70"
                  style={{ left: `${Math.min(100, noiseGate * 1.8 * 100)}%` }}
                  title={`Noise gate: ${(noiseGate * 100).toFixed(1)}%`}
                />
              )}
            </div>
            <div className="text-xs text-muted-foreground text-center mt-1">
              Mic level{!pttMode && noiseGate > 0 && " · gate marker"}
            </div>
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
              <Button variant="outline" onClick={() => {
                setAutoMuteReason(null);
                setMuted((m) => !m);
              }}>
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
          <div className="grid grid-cols-3 gap-2 pt-1">
            {[
              { label: "Low", value: 0.7 },
              { label: "Medium", value: 1.0 },
              { label: "High", value: 1.5 },
            ].map((p) => {
              const active = Math.abs(micGain - p.value) < 0.03;
              return (
                <Button
                  key={p.label}
                  size="sm"
                  variant={active ? "default" : "outline"}
                  className="h-9"
                  onClick={() => setMicGain(p.value)}
                >
                  {p.label}
                </Button>
              );
            })}
          </div>
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label className="text-sm flex items-center gap-2"><Mic className="size-4" /> Noise gate</Label>
            <span className="text-xs text-muted-foreground tabular-nums">
              {noiseGate === 0 ? "Off" : `${(noiseGate * 100).toFixed(1)}%`}
            </span>
          </div>
          <Slider
            value={[noiseGate]}
            min={0}
            max={0.2}
            step={0.005}
            onValueChange={(v) => setNoiseGate(v[0])}
          />
          <p className="text-xs text-muted-foreground">
            In always-on mode, mic input below this RMS level is sent as silence (300 ms hold-over). Set to 0 to disable.
            {pttMode && " — Disabled while push-to-talk is on."}
          </p>
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label className="text-sm flex items-center gap-2"><Volume2 className="size-4" /> Output volume</Label>
            <span className="text-xs text-muted-foreground tabular-nums">{Math.round(outVolume * 100)}%</span>
          </div>
          <Slider value={[outVolume]} min={0} max={1.5} step={0.05} onValueChange={(v) => setOutVolume(v[0])} />
          <div className="grid grid-cols-3 gap-2 pt-1">
            {[
              { label: "Low", value: 0.5 },
              { label: "Medium", value: 1.0 },
              { label: "High", value: 1.4 },
            ].map((p) => {
              const active = Math.abs(outVolume - p.value) < 0.03;
              return (
                <Button
                  key={p.label}
                  size="sm"
                  variant={active ? "default" : "outline"}
                  className="h-9"
                  onClick={() => setOutVolume(p.value)}
                >
                  {p.label}
                </Button>
              );
            })}
          </div>
        </div>
      </Card>

      <Card className="p-0 overflow-hidden">
        <div className="flex items-center justify-between px-4 py-2 border-b bg-muted/40">
          <div className="text-sm font-medium">Transcript</div>
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground tabular-nums">{log.length} turns</span>
            {log.length > 0 && (
              <Button variant="ghost" size="sm" onClick={() => setLog([])}>Clear</Button>
            )}
          </div>
        </div>
        <div ref={transcriptRef} className="max-h-[45vh] overflow-y-auto p-4 space-y-2">
          {log.length === 0 ? (
            <p className="text-sm text-muted-foreground">Conversation will appear here.</p>
          ) : (
            log.map((l, i) => (
              <div key={i} className="text-sm flex gap-3">
                <span className="text-xs text-muted-foreground tabular-nums shrink-0 pt-0.5 w-16">
                  {new Date(l.ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
                </span>
                <div className="flex-1 min-w-0">
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
                  <span className="text-foreground break-words">{l.text}</span>
                </div>
              </div>
            ))
          )}
        </div>
      </Card>

      <p className="text-xs text-muted-foreground">
        Tip: hands-free mode is best for driving. Push-to-talk is useful in noisy environments —
        hold the button or Spacebar to speak.
      </p>
    </div>
  );
}
