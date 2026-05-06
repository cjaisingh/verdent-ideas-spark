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

const SAMPLE_TURN = {
  source: "lovable_agent" as "lovable_agent" | "ai_gateway" | "awip_api",
  prompt: "Refactor the roadmap auto-log settings dialog to add a live preview of saved fields.",
  response:
    "Updated AutoLogSettings.tsx and added a preview panel.\n\nIssues:\n- Dialog was too narrow for the new preview\n\nFixes:\n- Switched max-w-md to max-w-2xl and split into a two-column layout",
  model: "google/gemini-2.5-flash",
  tokens_in: 412,
  tokens_out: 286,
  duration_ms: 4180,
  request_meta: { endpoint: "/v1/chat/completions", tool_choice: "auto" },
  response_meta: { http_status: 200, finish_reason: "stop" },
};

function extractIssuesAndFixes(raw: string): { issues: string | null; fixes: string | null } {
  const grab = (labels: string[]) => {
    const re = new RegExp(`(?:^|\\n)\\s*(?:${labels.join("|")})\\s*[:\\-–]\\s*\\n?([\\s\\S]*?)(?=\\n\\s*[A-Z][A-Za-z ]{2,30}\\s*[:\\-–]|$)`, "i");
    const m = raw.match(re);
    return m ? m[1].split("\n").map((l) => l.replace(/^\s*[-*•\d.]+\s*/, "").trim()).filter(Boolean).join("; ") : null;
  };
  return {
    issues: grab(["issues?", "problems?", "errors?", "bugs?"]),
    fixes: grab(["fixes?", "fixed", "resolutions?", "resolved", "solutions?"]),
  };
}

function buildPreview(s: Settings) {
  const sourceEnabled =
    SAMPLE_TURN.source === "lovable_agent" ? s.source_lovable_agent
    : SAMPLE_TURN.source === "ai_gateway" ? s.source_ai_gateway
    : s.source_awip_api;
  if (!s.enabled) return { skipped: "Auto-logging disabled (master switch off)", row: null };
  if (!sourceEnabled) return { skipped: `Source "${SAMPLE_TURN.source}" is disabled`, row: null };

  const trim = (t: string) => (t.length > 120 ? t.slice(0, 120) + "…" : t);
  const tIn = s.capture_tokens ? SAMPLE_TURN.tokens_in : null;
  const tOut = s.capture_tokens ? SAMPLE_TURN.tokens_out : null;
  const { issues, fixes } = s.extract_issues_fixes
    ? extractIssuesAndFixes(SAMPLE_TURN.response)
    : { issues: null, fixes: null };

  const row: Record<string, unknown> = {
    source: SAMPLE_TURN.source,
    task_id: "(active task)",
    duration_ms: s.capture_duration ? SAMPLE_TURN.duration_ms : null,
    tokens_in: tIn,
    tokens_out: tOut,
    tokens_total: s.capture_tokens ? (tIn ?? 0) + (tOut ?? 0) : null,
    model: s.capture_model ? SAMPLE_TURN.model : null,
    model_provider: s.capture_model ? SAMPLE_TURN.model.split("/")[0] : null,
    prompt_preview: s.capture_prompt ? trim(SAMPLE_TURN.prompt) : null,
    response_preview: s.capture_response ? trim(SAMPLE_TURN.response) : null,
    request_meta: s.capture_request_meta ? SAMPLE_TURN.request_meta : {},
    response_meta: s.capture_response_meta ? SAMPLE_TURN.response_meta : {},
    issues,
    fixes,
  };
  return { skipped: null as string | null, row };
}

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
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Automatic work logging</DialogTitle>
          <DialogDescription>
            Controls what gets captured from each AI turn into roadmap work logs. Manual entries are unaffected.
          </DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="space-y-3">
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
          </div>

          <PreviewPanel settings={settings} />
        </div>
      </DialogContent>
    </Dialog>
  );
};

const PreviewPanel = ({ settings }: { settings: Settings }) => {
  const { skipped, row } = buildPreview(settings);
  const isEmpty = (v: unknown) =>
    v === null || v === undefined || (typeof v === "object" && v !== null && !Array.isArray(v) && Object.keys(v as object).length === 0);
  const fmt = (v: unknown) =>
    typeof v === "object" && v !== null ? JSON.stringify(v) : String(v);

  return (
    <div className="space-y-2 md:sticky md:top-0 md:self-start">
      <div className="text-xs font-semibold uppercase text-muted-foreground tracking-wide">Live preview</div>
      <div className="rounded-md border border-border bg-muted/30 p-3 text-xs space-y-2">
        <div className="text-muted-foreground">
          What would be saved for a sample <span className="font-mono">{SAMPLE_TURN.source}</span> turn:
        </div>
        {skipped ? (
          <div className="rounded border border-dashed border-border bg-background p-3 text-center text-muted-foreground">
            ⚠️ {skipped}<br />
            <span className="text-[10px]">No row would be inserted.</span>
          </div>
        ) : (
          <div className="divide-y divide-border rounded border border-border bg-background">
            {row && Object.entries(row).map(([k, v]) => {
              const empty = isEmpty(v);
              return (
                <div key={k} className="flex items-start gap-2 px-2.5 py-1.5">
                  <span className={`font-mono text-[11px] ${empty ? "text-muted-foreground/60 line-through" : "text-foreground"}`}>
                    {k}
                  </span>
                  <span className={`flex-1 text-right font-mono text-[11px] truncate ${empty ? "text-muted-foreground/50" : "text-muted-foreground"}`}>
                    {empty ? "—" : fmt(v)}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};
  );
};
