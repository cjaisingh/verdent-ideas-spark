import { useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Play, Square, Volume2 } from "lucide-react";
import { toast } from "@/hooks/use-toast";

const VOICES = ["Kore", "Puck", "Charon", "Aoede", "Fenrir", "Leda", "Orus", "Zephyr"];

export default function GeminiTtsTestPanel() {
  const [text, setText] = useState("Good morning. Three approvals are waiting and the Sentinel is green.");
  const [voice, setVoice] = useState("Kore");
  const [busy, setBusy] = useState(false);
  const [meta, setMeta] = useState<{ secs: string; ms: number } | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const urlRef = useRef<string | null>(null);

  const speak = async () => {
    if (!text.trim()) return;
    setBusy(true); setMeta(null);
    const t0 = Date.now();
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const resp = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/gemini-tts`, {
        method: "POST",
        headers: { Authorization: `Bearer ${session?.access_token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ text, voice }),
      });
      if (!resp.ok) {
        const j = await resp.json().catch(() => ({}));
        throw new Error(`[${resp.status}] ${j.error ?? "tts failed"}${j.detail ? `: ${j.detail.slice(0, 120)}` : ""}`);
      }
      const secs = resp.headers.get("X-Audio-Seconds") ?? "?";
      const blob = await resp.blob();
      if (urlRef.current) URL.revokeObjectURL(urlRef.current);
      urlRef.current = URL.createObjectURL(blob);
      const audio = new Audio(urlRef.current);
      audioRef.current?.pause();
      audioRef.current = audio;
      await audio.play();
      setMeta({ secs, ms: Date.now() - t0 });
    } catch (e) {
      toast({ title: "TTS failed", description: e instanceof Error ? e.message : String(e), variant: "destructive" });
    } finally { setBusy(false); }
  };

  const stop = () => { try { audioRef.current?.pause(); } catch {/**/} };

  return (
    <section className="space-y-3">
      <div>
        <h2 className="text-lg font-medium flex items-center gap-2"><Volume2 className="h-4 w-4" /> Gemini TTS preview</h2>
        <p className="text-xs text-muted-foreground">
          Test the natural-voice TTS used by the Rork iPhone companion. Calls <code>gemini-tts</code> edge fn (uses <code>GOOGLE_AI_API_KEY</code>). Logged to <code>ai_usage_log</code> as <code>job=gemini-tts</code>.
        </p>
      </div>
      <div className="border border-border rounded-md p-3 space-y-2">
        <Input value={text} onChange={(e) => setText(e.target.value)} placeholder="Text to speak…" disabled={busy} />
        <div className="flex flex-wrap items-center gap-2">
          <select
            value={voice}
            onChange={(e) => setVoice(e.target.value)}
            disabled={busy}
            className="h-9 rounded-md border border-input bg-background px-2 text-sm"
          >
            {VOICES.map((v) => <option key={v} value={v}>{v}</option>)}
          </select>
          <Button size="sm" onClick={speak} disabled={busy || !text.trim()}>
            <Play className="h-3.5 w-3.5 mr-1" /> {busy ? "Generating…" : "Speak"}
          </Button>
          <Button size="sm" variant="ghost" onClick={stop} disabled={busy}>
            <Square className="h-3.5 w-3.5 mr-1" /> Stop
          </Button>
          {meta && <Badge variant="secondary" className="ml-auto tabular-nums">{meta.secs}s audio · {meta.ms}ms</Badge>}
        </div>
      </div>
    </section>
  );
}
