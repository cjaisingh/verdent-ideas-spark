import { useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { toast } from "@/hooks/use-toast";
import { CheckCircle2, Circle, Mic, Volume2, Loader2, MessagesSquare, Save, Smartphone } from "lucide-react";

const VOICES = ["Kore", "Puck", "Charon", "Aoede", "Fenrir", "Leda", "Orus", "Zephyr"];
const STT_PROVIDERS = [{ id: "browser-webspeech", label: "Browser Web Speech (default, free)" }];
const TTS_PROVIDERS = [{ id: "gemini", label: "Gemini TTS (default, already wired)" }];
const TRANSPORTS = [{ id: "browser", label: "Browser (/companion)" }, { id: "rork", label: "Rork iPhone app" }];

type Step = 0 | 1 | 2 | 3 | 4;
type StepStatus = "todo" | "ok" | "fail";

export default function VoiceSetup() {
  const [step, setStep] = useState<Step>(0);
  const [statuses, setStatuses] = useState<Record<Step, StepStatus>>({ 0: "todo", 1: "todo", 2: "todo", 3: "todo", 4: "todo" });
  const [stt, setStt] = useState("browser-webspeech");
  const [tts, setTts] = useState("gemini");
  const [voice, setVoice] = useState("Kore");
  const [transport, setTransport] = useState("browser");
  const [rorkEnabled, setRorkEnabled] = useState(true);
  const [micLabel, setMicLabel] = useState<string>("");
  const [micLevel, setMicLevel] = useState(0);
  const [micPeak, setMicPeak] = useState(0);
  const [micRunning, setMicRunning] = useState(false);
  const [ttsBusy, setTtsBusy] = useState(false);
  const [loopBusy, setLoopBusy] = useState(false);
  const [loopText, setLoopText] = useState("");
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<string | null>(null);

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const ctxRef = useRef<AudioContext | null>(null);
  const rafRef = useRef<number | null>(null);

  const mark = (s: Step, v: StepStatus) => setStatuses((p) => ({ ...p, [s]: v }));

  // Load existing config
  useEffect(() => {
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const { data } = await supabase.from("voice_config").select("*").eq("user_id", user.id).maybeSingle();
      if (data) {
        setStt(data.stt_provider); setTts(data.tts_provider); setVoice(data.tts_voice);
        setTransport(data.transport); setRorkEnabled(data.rork_enabled); setMicLabel(data.mic_label ?? "");
        if (data.last_validated_at) setSavedAt(data.last_validated_at);
      }
    })();
    return () => stopMic();
  }, []);

  // Mic level meter
  const startMic = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const track = stream.getAudioTracks()[0];
      setMicLabel(track?.label ?? "default mic");
      const ctx = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
      ctxRef.current = ctx;
      const src = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 1024;
      src.connect(analyser);
      const buf = new Uint8Array(analyser.fftSize);
      let peak = 0;
      const loop = () => {
        analyser.getByteTimeDomainData(buf);
        let sum = 0;
        for (let i = 0; i < buf.length; i++) { const v = (buf[i] - 128) / 128; sum += v * v; }
        const rms = Math.sqrt(sum / buf.length);
        const level = Math.min(100, Math.round(rms * 200));
        setMicLevel(level);
        if (level > peak) { peak = level; setMicPeak(peak); }
        if (peak >= 25) mark(1, "ok");
        rafRef.current = requestAnimationFrame(loop);
      };
      setMicRunning(true);
      loop();
    } catch (e) {
      mark(1, "fail");
      toast({ title: "Microphone blocked", description: e instanceof Error ? e.message : String(e), variant: "destructive" });
    }
  };
  const stopMic = () => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    streamRef.current?.getTracks().forEach((t) => t.stop());
    ctxRef.current?.close().catch(() => {});
    streamRef.current = null; ctxRef.current = null;
    setMicRunning(false);
  };

  // TTS test
  const speak = async (text: string) => {
    setTtsBusy(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const resp = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/gemini-tts`, {
        method: "POST",
        headers: { Authorization: `Bearer ${session?.access_token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ text, voice }),
      });
      if (!resp.ok) {
        const j = await resp.json().catch(() => ({}));
        throw new Error(j.error ?? `tts ${resp.status}`);
      }
      const blob = await resp.blob();
      const url = URL.createObjectURL(blob);
      const audio = new Audio(url);
      audioRef.current?.pause();
      audioRef.current = audio;
      await audio.play();
      return true;
    } catch (e) {
      toast({ title: "TTS failed", description: e instanceof Error ? e.message : String(e), variant: "destructive" });
      return false;
    } finally { setTtsBusy(false); }
  };

  // Full loop: speak → STT → cloud-chat → TTS
  const runFullLoop = async () => {
    setLoopBusy(true); setLoopText("");
    try {
      type SR = { lang: string; interimResults: boolean; maxAlternatives: number; start: () => void; stop: () => void; onresult: (e: { results: { 0: { 0: { transcript: string } } }[] & { [k: number]: { 0: { transcript: string } } } }) => void; onerror: (e: { error: string }) => void };
      const w = window as unknown as { SpeechRecognition?: new () => SR; webkitSpeechRecognition?: new () => SR };
      const SRClass = w.SpeechRecognition ?? w.webkitSpeechRecognition;
      if (!SRClass) throw new Error("Browser Web Speech API not available (use Chrome/Edge).");
      if (!streamRef.current) await startMic();

      const transcript = await new Promise<string>((resolve, reject) => {
        const r = new SRClass();
        r.lang = "en-GB"; r.interimResults = false; r.maxAlternatives = 1;
        const to = setTimeout(() => { try { r.stop(); } catch {/**/} reject(new Error("No speech detected (10s)")); }, 10000);
        r.onresult = (e) => { clearTimeout(to); resolve(e.results[0][0].transcript); };
        r.onerror = (e) => { clearTimeout(to); reject(new Error(e.error)); };
        r.start();
      });
      setLoopText(`You: ${transcript}`);

      const { data: chat, error: chatErr } = await supabase.functions.invoke("companion-cloud-chat", {
        body: { messages: [{ role: "user", content: transcript }], stream: false },
      });
      if (chatErr) throw chatErr;
      const reply = (chat as { reply?: string; text?: string })?.reply
        ?? (chat as { text?: string })?.text
        ?? JSON.stringify(chat).slice(0, 200);
      setLoopText(`You: ${transcript}\nAI: ${reply}`);

      const ok = await speak(reply.slice(0, 400));
      if (ok) mark(3, "ok"); else mark(3, "fail");
    } catch (e) {
      mark(3, "fail");
      toast({ title: "Loop failed", description: e instanceof Error ? e.message : String(e), variant: "destructive" });
    } finally { setLoopBusy(false); }
  };

  const save = async () => {
    setSaving(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("not signed in");
      const validation = {
        mic: { peak: micPeak, label: micLabel },
        loop: statuses[3] === "ok",
        ts: new Date().toISOString(),
      };
      const { error } = await supabase.from("voice_config").upsert({
        user_id: user.id,
        stt_provider: stt, tts_provider: tts, tts_voice: voice, transport,
        mic_label: micLabel, rork_enabled: rorkEnabled,
        last_validated_at: new Date().toISOString(),
        last_validation: validation,
      }, { onConflict: "user_id" });
      if (error) throw error;
      mark(4, "ok");
      setSavedAt(new Date().toISOString());
      toast({ title: "Voice config saved", description: rorkEnabled ? "Rork iPhone app will pick this up on next launch." : "Browser only." });
    } catch (e) {
      mark(4, "fail");
      toast({ title: "Save failed", description: e instanceof Error ? e.message : String(e), variant: "destructive" });
    } finally { setSaving(false); }
  };

  const StepDot = ({ s }: { s: Step }) => statuses[s] === "ok"
    ? <CheckCircle2 className="h-4 w-4 text-emerald-500" />
    : statuses[s] === "fail"
      ? <CheckCircle2 className="h-4 w-4 text-destructive" />
      : <Circle className="h-4 w-4 text-muted-foreground" />;

  const stepTitles = ["Choose providers", "Mic check", "TTS check", "Full loop", "Save & export"];

  return (
    <div className="container mx-auto max-w-3xl py-8 space-y-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Voice Setup</h1>
        <p className="text-sm text-muted-foreground">
          Pick STT/TTS providers, validate microphone and end-to-end audio, then publish the config to /companion and the Rork iPhone app.
        </p>
      </header>

      <ol className="flex flex-wrap gap-2 text-sm">
        {stepTitles.map((t, i) => (
          <li key={t}>
            <button onClick={() => setStep(i as Step)}
              className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md border ${step === i ? "border-primary bg-primary/10" : "border-border"}`}>
              <StepDot s={i as Step} /> {i + 1}. {t}
            </button>
          </li>
        ))}
      </ol>

      {step === 0 && (
        <Card>
          <CardHeader><CardTitle className="text-base">Providers & transport</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div>
                <Label className="text-xs">STT (speech → text)</Label>
                <select value={stt} onChange={(e) => setStt(e.target.value)} className="mt-1 h-9 w-full rounded-md border border-input bg-background px-2 text-sm">
                  {STT_PROVIDERS.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
                </select>
              </div>
              <div>
                <Label className="text-xs">TTS (text → speech)</Label>
                <select value={tts} onChange={(e) => setTts(e.target.value)} className="mt-1 h-9 w-full rounded-md border border-input bg-background px-2 text-sm">
                  {TTS_PROVIDERS.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
                </select>
              </div>
              <div>
                <Label className="text-xs">TTS voice</Label>
                <select value={voice} onChange={(e) => setVoice(e.target.value)} className="mt-1 h-9 w-full rounded-md border border-input bg-background px-2 text-sm">
                  {VOICES.map((v) => <option key={v} value={v}>{v}</option>)}
                </select>
              </div>
              <div>
                <Label className="text-xs">Primary transport</Label>
                <select value={transport} onChange={(e) => setTransport(e.target.value)} className="mt-1 h-9 w-full rounded-md border border-input bg-background px-2 text-sm">
                  {TRANSPORTS.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
                </select>
              </div>
            </div>
            <label className="flex items-center gap-2 text-sm pt-2">
              <Switch checked={rorkEnabled} onCheckedChange={setRorkEnabled} />
              <Smartphone className="h-3.5 w-3.5" /> Publish to Rork iPhone app
            </label>
            <div className="flex justify-end pt-2">
              <Button onClick={() => { mark(0, "ok"); setStep(1); }}>Next: Mic check</Button>
            </div>
          </CardContent>
        </Card>
      )}

      {step === 1 && (
        <Card>
          <CardHeader><CardTitle className="text-base flex items-center gap-2"><Mic className="h-4 w-4" /> Microphone check</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <p className="text-sm text-muted-foreground">Speak normally. We need a peak above 25 to consider the mic working.</p>
            <Progress value={micLevel} />
            <div className="flex items-center gap-2 text-xs text-muted-foreground tabular-nums">
              <Badge variant="outline">peak {micPeak}</Badge>
              <Badge variant="outline">live {micLevel}</Badge>
              {micLabel && <span className="truncate">device: {micLabel}</span>}
            </div>
            <div className="flex gap-2">
              {!micRunning ? <Button onClick={startMic}><Mic className="h-3.5 w-3.5 mr-1" /> Start</Button>
                : <Button variant="secondary" onClick={stopMic}>Stop</Button>}
              <Button variant="ghost" onClick={() => { mark(1, "todo"); setMicPeak(0); }}>Reset</Button>
              <Button className="ml-auto" disabled={statuses[1] !== "ok"} onClick={() => setStep(2)}>Next: TTS</Button>
            </div>
          </CardContent>
        </Card>
      )}

      {step === 2 && (
        <Card>
          <CardHeader><CardTitle className="text-base flex items-center gap-2"><Volume2 className="h-4 w-4" /> TTS check</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <p className="text-sm text-muted-foreground">Plays a short test phrase via <code>gemini-tts</code> with voice <strong>{voice}</strong>.</p>
            <div className="flex gap-2">
              <Button onClick={async () => { const ok = await speak(`Voice check. This is ${voice} reading from AWIP.`); if (ok) mark(2, "ok"); else mark(2, "fail"); }} disabled={ttsBusy}>
                {ttsBusy ? <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" /> : <Volume2 className="h-3.5 w-3.5 mr-1" />} Play test phrase
              </Button>
              <Button className="ml-auto" disabled={statuses[2] !== "ok"} onClick={() => setStep(3)}>Next: Full loop</Button>
            </div>
          </CardContent>
        </Card>
      )}

      {step === 3 && (
        <Card>
          <CardHeader><CardTitle className="text-base flex items-center gap-2"><MessagesSquare className="h-4 w-4" /> Full loop</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Speak a short prompt → browser STT → <code>companion-cloud-chat</code> → TTS reply. Logs land in <code>ai_usage_log</code>.
            </p>
            <Button onClick={runFullLoop} disabled={loopBusy}>
              {loopBusy ? <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" /> : <Mic className="h-3.5 w-3.5 mr-1" />}
              {loopBusy ? "Listening / thinking…" : "Start round-trip"}
            </Button>
            {loopText && <pre className="text-xs whitespace-pre-wrap bg-muted/40 border border-border rounded-md p-3">{loopText}</pre>}
            <div className="flex justify-end">
              <Button disabled={statuses[3] !== "ok"} onClick={() => setStep(4)}>Next: Save</Button>
            </div>
          </CardContent>
        </Card>
      )}

      {step === 4 && (
        <Card>
          <CardHeader><CardTitle className="text-base flex items-center gap-2"><Save className="h-4 w-4" /> Save & export</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <div className="text-sm space-y-1">
              <div>STT: <strong>{stt}</strong></div>
              <div>TTS: <strong>{tts}</strong> · voice <strong>{voice}</strong></div>
              <div>Transport: <strong>{transport}</strong> · Rork export: <strong>{rorkEnabled ? "on" : "off"}</strong></div>
              <div>Mic peak achieved: <strong>{micPeak}</strong></div>
              <div>Loop validated: <strong>{statuses[3] === "ok" ? "yes" : "no"}</strong></div>
            </div>
            <Input readOnly value={`${import.meta.env.VITE_SUPABASE_URL}/rest/v1/voice_config?user_id=eq.<your-uid>&select=*`} className="text-xs font-mono" />
            <p className="text-xs text-muted-foreground">The Rork iPhone app reads this row directly (per <code>docs/rork-companion-spec.md</code>).</p>
            <div className="flex gap-2">
              <Button onClick={save} disabled={saving}>
                {saving ? <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" /> : <Save className="h-3.5 w-3.5 mr-1" />}
                Save voice config
              </Button>
              {savedAt && <Badge variant="secondary" className="ml-auto">last saved {new Date(savedAt).toLocaleString()}</Badge>}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
