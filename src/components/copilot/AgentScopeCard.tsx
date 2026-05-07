import { useState } from "react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ChevronDown, ChevronUp, Wrench, Database, ShieldAlert, RotateCcw } from "lucide-react";
import { toast } from "sonner";
import type { CopilotAgent, AgentOverride } from "@/hooks/useCopilotAgents";

const TTS_VOICES = [
  "aura-2-orion-en", "aura-2-helios-en", "aura-2-luna-en", "aura-2-stella-en",
  "aura-asteria-en", "aura-arcas-en",
];

type Props = {
  agent: CopilotAgent;
  override: AgentOverride | null;
  onSaveOverride: (patch: Partial<Omit<AgentOverride, "id" | "user_id" | "agent_id">>) => Promise<void>;
};

const RISK_VARIANT: Record<string, "default" | "secondary" | "destructive"> = {
  low: "secondary",
  medium: "default",
  high: "destructive",
};

export function AgentScopeCard({ agent, override, onSaveOverride }: Props) {
  const [expanded, setExpanded] = useState(false);
  const [voice, setVoice] = useState(override?.tts_voice ?? "");
  const [greeting, setGreeting] = useState(override?.greeting ?? "");
  // null === "use global / setting from copilot_settings"
  const [micGain, setMicGain] = useState<number | null>(override?.mic_gain ?? null);
  const [outVolume, setOutVolume] = useState<number | null>(override?.out_volume ?? null);
  const [noiseGate, setNoiseGate] = useState<number | null>(override?.noise_gate ?? null);
  const [saving, setSaving] = useState(false);

  const save = async () => {
    setSaving(true);
    try {
      await onSaveOverride({
        tts_voice: voice.trim() ? voice : null,
        greeting: greeting.trim() ? greeting : null,
        mic_gain: micGain,
        out_volume: outVolume,
        noise_gate: noiseGate,
      });
      toast.success(`Overrides saved for ${agent.name}`);
    } catch (e: any) {
      toast.error(e.message || "Failed to save overrides");
    } finally {
      setSaving(false);
    }
  };

  const reset = () => {
    setVoice("");
    setGreeting("");
    setMicGain(null);
    setOutVolume(null);
    setNoiseGate(null);
  };

  return (
    <Card className="p-5 space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-base font-semibold">{agent.name}</div>
          <p className="text-xs text-muted-foreground">
            {agent.description ?? "No description."}
          </p>
        </div>
        <Badge variant={RISK_VARIANT[agent.max_risk]} className="shrink-0">
          <ShieldAlert className="size-3 mr-1" /> max risk: {agent.max_risk}
        </Badge>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
        <div>
          <div className="flex items-center gap-1.5 text-muted-foreground mb-1">
            <Wrench className="size-3" /> Tools / capabilities
          </div>
          <div className="flex flex-wrap gap-1">
            {agent.allowed_capability_ids.length === 0 ? (
              <span className="text-muted-foreground italic">none</span>
            ) : (
              agent.allowed_capability_ids.map((c) => (
                <Badge key={c} variant="outline" className="font-mono text-[10px]">{c}</Badge>
              ))
            )}
          </div>
        </div>
        <div>
          <div className="flex items-center gap-1.5 text-muted-foreground mb-1">
            <Database className="size-3" /> Tables (read scope)
          </div>
          <div className="flex flex-wrap gap-1">
            {agent.allowed_tables.length === 0 ? (
              <span className="text-muted-foreground italic">none</span>
            ) : (
              agent.allowed_tables.map((t) => (
                <Badge key={t} variant="outline" className="font-mono text-[10px]">{t}</Badge>
              ))
            )}
          </div>
        </div>
      </div>

      <div className="text-xs text-muted-foreground flex flex-wrap gap-x-4 gap-y-1">
        <span>Voice: <span className="font-mono">{override?.tts_voice ?? agent.tts_voice}</span></span>
        <span>Language: <span className="font-mono">{agent.language}</span></span>
        <span>Greeting: "{override?.greeting ?? agent.default_greeting}"</span>
      </div>

      <Button
        variant="ghost"
        size="sm"
        className="h-8 -ml-2 text-xs"
        onClick={() => setExpanded((v) => !v)}
      >
        {expanded ? <ChevronUp className="size-3 mr-1" /> : <ChevronDown className="size-3 mr-1" />}
        My overrides
      </Button>

      {expanded && (
        <div className="space-y-4 pt-1 border-t">
          <div className="space-y-1.5 pt-3">
            <Label className="text-xs">Voice</Label>
            <Select value={voice || "__default"} onValueChange={(v) => setVoice(v === "__default" ? "" : v)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__default">Use agent default ({agent.tts_voice})</SelectItem>
                {TTS_VOICES.map((v) => <SelectItem key={v} value={v}>{v}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs">Greeting</Label>
            <Input
              value={greeting}
              onChange={(e) => setGreeting(e.target.value)}
              placeholder={agent.default_greeting}
            />
          </div>

          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <Label className="text-xs">Mic gain</Label>
              <span className="text-xs text-muted-foreground tabular-nums">
                {micGain === null ? "global" : `${micGain.toFixed(2)}×`}
              </span>
            </div>
            <Slider
              value={[micGain ?? 1.0]}
              min={0} max={2} step={0.05}
              onValueChange={(v) => setMicGain(v[0])}
            />
          </div>

          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <Label className="text-xs">Output volume</Label>
              <span className="text-xs text-muted-foreground tabular-nums">
                {outVolume === null ? "global" : `${Math.round(outVolume * 100)}%`}
              </span>
            </div>
            <Slider
              value={[outVolume ?? 1.0]}
              min={0} max={1.5} step={0.05}
              onValueChange={(v) => setOutVolume(v[0])}
            />
          </div>

          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <Label className="text-xs">Noise gate</Label>
              <span className="text-xs text-muted-foreground tabular-nums">
                {noiseGate === null
                  ? "global"
                  : noiseGate === 0 ? "Off" : `${(noiseGate * 100).toFixed(1)}%`}
              </span>
            </div>
            <Slider
              value={[noiseGate ?? 0.02]}
              min={0} max={0.2} step={0.005}
              onValueChange={(v) => setNoiseGate(v[0])}
            />
          </div>

          <div className="flex gap-2">
            <Button size="sm" onClick={save} disabled={saving}>
              {saving ? "Saving…" : "Save overrides"}
            </Button>
            <Button size="sm" variant="ghost" onClick={reset}>
              <RotateCcw className="size-3 mr-1" /> Reset all
            </Button>
          </div>
        </div>
      )}
    </Card>
  );
}
