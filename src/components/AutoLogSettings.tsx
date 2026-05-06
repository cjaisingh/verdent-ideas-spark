import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogDescription } from "@/components/ui/dialog";
import { toast } from "@/hooks/use-toast";
import { Settings2 } from "lucide-react";

type Settings = {
  enabled: boolean;
  capture_tokens: boolean;
  capture_duration: boolean;
  capture_model: boolean;
  capture_prompt: boolean;
  capture_response: boolean;
  capture_request_meta: boolean;
  capture_response_meta: boolean;
  extract_issues_fixes: boolean;
  source_lovable_agent: boolean;
  source_ai_gateway: boolean;
  source_awip_api: boolean;
};

const DEFAULTS: Settings = {
  enabled: true, capture_tokens: true, capture_duration: true, capture_model: true,
  capture_prompt: true, capture_response: true, capture_request_meta: true,
  capture_response_meta: true, extract_issues_fixes: true,
  source_lovable_agent: true, source_ai_gateway: true, source_awip_api: true,
};

const FIELDS: { key: keyof Settings; label: string; hint: string }[] = [
  { key: "capture_duration", label: "Duration", hint: "Wall-clock time for each AI turn" },
  { key: "capture_tokens", label: "Tokens", hint: "Prompt / completion / total token counts" },
  { key: "capture_model", label: "Model", hint: "Model name and inferred provider" },
  { key: "capture_prompt", label: "Prompt preview", hint: "First ~500 chars of the user prompt" },
  { key: "capture_response", label: "Response preview", hint: "First ~500 chars of the AI response" },
  { key: "capture_request_meta", label: "Request metadata", hint: "Endpoint, system prompt, tool choices" },
  { key: "capture_response_meta", label: "Response metadata", hint: "HTTP status, finish reason, tool calls" },
  { key: "extract_issues_fixes", label: "Auto-extract issues / fixes", hint: "Parse labeled sections from the AI output" },
];

const SOURCES: { key: keyof Settings; label: string; hint: string }[] = [
  { key: "source_lovable_agent", label: "Lovable agent", hint: "Turns captured by the in-app TurnTracker" },
  { key: "source_ai_gateway", label: "AI gateway", hint: "Turns posted via the AI gateway" },
  { key: "source_awip_api", label: "AWIP API", hint: "Turns posted with the service token" },
];

export const AutoLogSettings = () => {
  const [open, setOpen] = useState(false);
  const [settings, setSettings] = useState<Settings>(DEFAULTS);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open) return;
    (async () => {
      const { data } = await supabase.from("roadmap_autolog_settings" as any).select("*").eq("id", true).maybeSingle();
      if (data) setSettings({ ...DEFAULTS, ...(data as any) });
    })();
  }, [open]);

  const save = async (next: Settings) => {
    setLoading(true);
    const { error } = await supabase.from("roadmap_autolog_settings" as any).upsert({ id: true, ...next, updated_at: new Date().toISOString() });
    setLoading(false);
    if (error) {
      toast({ title: "Save failed", description: error.message, variant: "destructive" });
      return;
    }
    setSettings(next);
  };

  const toggle = (key: keyof Settings) => save({ ...settings, [key]: !settings[key] });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" className="h-9 gap-1.5">
          <Settings2 className="h-3.5 w-3.5" /> Auto-log
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Automatic work logging</DialogTitle>
          <DialogDescription>
            Controls what gets captured from each AI turn into roadmap work logs. Manual entries are unaffected.
          </DialogDescription>
        </DialogHeader>

        <div className="flex items-center justify-between rounded-md border border-border p-3">
          <div>
            <div className="font-medium">Auto-logging enabled</div>
            <div className="text-xs text-muted-foreground">Master switch for all automatic sources</div>
          </div>
          <Switch checked={settings.enabled} onCheckedChange={() => toggle("enabled")} disabled={loading} />
        </div>

        <div className={`space-y-2 ${settings.enabled ? "" : "opacity-50 pointer-events-none"}`}>
          <div className="text-xs font-semibold uppercase text-muted-foreground tracking-wide">What to capture</div>
          {FIELDS.map((f) => (
            <div key={f.key} className="flex items-center justify-between rounded-md border border-border p-2.5">
              <div className="pr-3">
                <div className="text-sm font-medium">{f.label}</div>
                <div className="text-xs text-muted-foreground">{f.hint}</div>
              </div>
              <Switch checked={settings[f.key]} onCheckedChange={() => toggle(f.key)} disabled={loading} />
            </div>
          ))}
        </div>

        <div className={`space-y-2 ${settings.enabled ? "" : "opacity-50 pointer-events-none"}`}>
          <div className="text-xs font-semibold uppercase text-muted-foreground tracking-wide">Sources to capture</div>
          {SOURCES.map((f) => (
            <div key={f.key} className="flex items-center justify-between rounded-md border border-border p-2.5">
              <div className="pr-3">
                <div className="text-sm font-medium">{f.label}</div>
                <div className="text-xs text-muted-foreground">{f.hint}</div>
              </div>
              <Switch checked={settings[f.key]} onCheckedChange={() => toggle(f.key)} disabled={loading} />
            </div>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
};
