// Reusable dialog to enqueue an ai_jobs draft for the local Ollama worker.
// Supports all 3 contract kinds. Calls ai-jobs-enqueue with idempotency key.

import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Link } from "react-router-dom";
import { Loader2, Sparkles } from "lucide-react";
import { toast } from "sonner";

const CUSTOM = "__custom__";
const WORKER_DEFAULT = "__worker_default__";
const FRESH_MS = 2 * 60 * 1000;

export type DraftKind = "draft_changelog_entry" | "draft_lesson_synthesis" | "draft_doc_section";

type Props = {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  kind: DraftKind;
  // Optional prefill — caller can pass any subset of fields.
  initial?: Record<string, unknown>;
};

const KIND_TITLE: Record<DraftKind, string> = {
  draft_changelog_entry: "Draft CHANGELOG entry",
  draft_lesson_synthesis: "Draft lesson synthesis",
  draft_doc_section: "Draft doc section",
};

export function EnqueueDraftDialog({ open, onOpenChange, kind, initial }: Props) {
  const [submitting, setSubmitting] = useState(false);

  // changelog fields
  const today = new Date().toISOString().slice(0, 10);
  const weekAgo = new Date(Date.now() - 7 * 86400_000).toISOString().slice(0, 10);
  const [dateFrom, setDateFrom] = useState(weekAgo);
  const [dateTo, setDateTo] = useState(today);
  const [bullets, setBullets] = useState("");
  const [context, setContext] = useState("");

  // lesson fields
  const [titleHint, setTitleHint] = useState("");
  const [category, setCategory] = useState("");
  const [evidence, setEvidence] = useState("");

  // doc fields
  const [docPath, setDocPath] = useState("");
  const [sectionAnchor, setSectionAnchor] = useState("");
  const [prompt, setPrompt] = useState("");
  const [existingMd, setExistingMd] = useState("");

  // Model picker — sourced from ai_workers (online = last_seen within 2 min).
  const [tags, setTags] = useState<string[]>([]);
  const [workerDefault, setWorkerDefault] = useState<string | null>(null);
  const [modelChoice, setModelChoice] = useState<string>(WORKER_DEFAULT);
  const [customModel, setCustomModel] = useState("");

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from("ai_workers")
        .select("model_tags, default_model, last_seen_at, enabled");
      if (cancelled) return;
      const now = Date.now();
      const online = (data ?? []).filter(
        (w) => w.enabled && w.last_seen_at && now - new Date(w.last_seen_at).getTime() < FRESH_MS,
      );
      const union = Array.from(new Set(online.flatMap((w) => w.model_tags ?? []))).sort();
      setTags(union);
      setWorkerDefault(online.find((w) => w.default_model)?.default_model ?? null);
    })();
    return () => { cancelled = true; };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    setModelChoice(WORKER_DEFAULT);
    setCustomModel("");
  }, [open, kind]);

  const requestedModel = useMemo(() => {
    if (modelChoice === WORKER_DEFAULT) return null;
    if (modelChoice === CUSTOM) return customModel.trim() || null;
    return modelChoice;
  }, [modelChoice, customModel]);

  useEffect(() => {
    if (kind === "draft_changelog_entry") {
      setDateFrom((initial?.date_from as string) ?? weekAgo);
      setDateTo((initial?.date_to as string) ?? today);
      setBullets(Array.isArray(initial?.bullets) ? (initial!.bullets as string[]).join("\n") : "");
      setContext((initial?.context as string) ?? "");
    }
    if (kind === "draft_lesson_synthesis") {
      setTitleHint((initial?.title_hint as string) ?? "");
      setCategory((initial?.category as string) ?? "");
      setEvidence(
        Array.isArray(initial?.evidence)
          ? (initial!.evidence as Array<{ source: string; snippet: string }>)
              .map((e) => `[${e.source}] ${e.snippet}`)
              .join("\n\n")
          : "",
      );
    }
    if (kind === "draft_doc_section") {
      setDocPath((initial?.doc_path as string) ?? "");
      setSectionAnchor((initial?.section_anchor as string) ?? "");
      setPrompt((initial?.prompt as string) ?? "");
      setExistingMd((initial?.existing_md as string) ?? "");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, kind]);

  function buildInput(): Record<string, unknown> | null {
    if (kind === "draft_changelog_entry") {
      const list = bullets
        .split("\n")
        .map((s) => s.replace(/^[-*]\s*/, "").trim())
        .filter(Boolean);
      if (!list.length) {
        toast.error("Add at least one bullet");
        return null;
      }
      return {
        date_from: dateFrom,
        date_to: dateTo,
        bullets: list,
        context: context.trim() || undefined,
      };
    }
    if (kind === "draft_lesson_synthesis") {
      if (!titleHint.trim()) {
        toast.error("Title hint required");
        return null;
      }
      // Parse evidence as blocks "[source] snippet" separated by blank lines.
      const blocks = evidence.split(/\n\s*\n/).map((b) => b.trim()).filter(Boolean);
      const parsed = blocks.map((b) => {
        const m = b.match(/^\[([^\]]+)\]\s*([\s\S]+)$/);
        return m ? { source: m[1].trim(), snippet: m[2].trim() } : { source: "operator", snippet: b };
      });
      if (!parsed.length) {
        toast.error("Add at least one evidence block");
        return null;
      }
      return {
        title_hint: titleHint.trim(),
        category: category.trim() || undefined,
        evidence: parsed,
        candidate_id: initial?.candidate_id,
      };
    }
    if (kind === "draft_doc_section") {
      if (!docPath.trim() || !sectionAnchor.trim() || !prompt.trim()) {
        toast.error("doc_path, section_anchor and prompt are required");
        return null;
      }
      return {
        doc_path: docPath.trim(),
        section_anchor: sectionAnchor.trim(),
        prompt: prompt.trim(),
        existing_md: existingMd.trim() || undefined,
      };
    }
    return null;
  }

  async function submit() {
    const input = buildInput();
    if (!input) return;
    setSubmitting(true);
    try {
      const idempotencyKey = `${kind}:${crypto.randomUUID()}`;
      const { data, error } = await supabase.functions.invoke("ai-jobs-enqueue", {
        body: { kind, input, idempotency_key: idempotencyKey },
      });
      if (error) throw error;
      toast.success(
        <span>
          Job queued ({(data as { status?: string })?.status ?? "queued"}).{" "}
          <Link to="/admin/ai-jobs" className="underline">View queue</Link>
        </span>,
      );
      onOpenChange(false);
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "enqueue failed");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="h-4 w-4" /> {KIND_TITLE[kind]}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-3">
          {kind === "draft_changelog_entry" && (
            <>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <Label className="text-xs">From</Label>
                  <Input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
                </div>
                <div>
                  <Label className="text-xs">To</Label>
                  <Input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
                </div>
              </div>
              <div>
                <Label className="text-xs">Bullets (one per line)</Label>
                <Textarea
                  rows={8}
                  value={bullets}
                  onChange={(e) => setBullets(e.target.value)}
                  placeholder={"added X\nfixed Y\nimproved Z"}
                />
              </div>
              <div>
                <Label className="text-xs">Context (optional)</Label>
                <Textarea rows={2} value={context} onChange={(e) => setContext(e.target.value)} />
              </div>
            </>
          )}

          {kind === "draft_lesson_synthesis" && (
            <>
              <div>
                <Label className="text-xs">Working title</Label>
                <Input value={titleHint} onChange={(e) => setTitleHint(e.target.value)} />
              </div>
              <div>
                <Label className="text-xs">Category (optional)</Label>
                <Input value={category} onChange={(e) => setCategory(e.target.value)} />
              </div>
              <div>
                <Label className="text-xs">
                  Evidence — blocks separated by blank lines, format: <code>[source] snippet</code>
                </Label>
                <Textarea
                  rows={10}
                  value={evidence}
                  onChange={(e) => setEvidence(e.target.value)}
                  placeholder={"[sentinel:companion_streams_stalled] 3 stalls in 24h …\n\n[discussion #42] operator noted …"}
                />
              </div>
            </>
          )}

          {kind === "draft_doc_section" && (
            <>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <Label className="text-xs">Doc path</Label>
                  <Input value={docPath} onChange={(e) => setDocPath(e.target.value)} placeholder="docs/architecture.md" />
                </div>
                <div>
                  <Label className="text-xs">Section anchor</Label>
                  <Input value={sectionAnchor} onChange={(e) => setSectionAnchor(e.target.value)} placeholder="## Worker reliability" />
                </div>
              </div>
              <div>
                <Label className="text-xs">Instruction</Label>
                <Textarea rows={4} value={prompt} onChange={(e) => setPrompt(e.target.value)} />
              </div>
              <div>
                <Label className="text-xs">Surrounding markdown (optional, for tone)</Label>
                <Textarea rows={4} value={existingMd} onChange={(e) => setExistingMd(e.target.value)} />
              </div>
            </>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>Cancel</Button>
          <Button onClick={submit} disabled={submitting}>
            {submitting ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Sparkles className="h-4 w-4 mr-1" />}
            Enqueue
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
