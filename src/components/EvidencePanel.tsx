import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/hooks/use-toast";
import { Paperclip, Link as LinkIcon, FileText, Trash2, ExternalLink, Upload } from "lucide-react";

export type Evidence = {
  id: string;
  task_id: string;
  checklist_item: string | null;
  kind: "link" | "file" | "note";
  title: string;
  url: string | null;
  storage_path: string | null;
  note: string | null;
  source: string | null;
  added_by: string | null;
  created_at: string;
};

type Props = {
  taskId: string;
  /** Optional: scope this panel to a specific checklist item key (e.g. "rls-migration") */
  checklistItem?: string | null;
  /** When true, only shows evidence for this checklist item */
  filterToItem?: boolean;
  compact?: boolean;
};

export const EvidencePanel = ({ taskId, checklistItem = null, filterToItem = false, compact = false }: Props) => {
  const [items, setItems] = useState<Evidence[]>([]);
  const [adding, setAdding] = useState(false);
  const [kind, setKind] = useState<"link" | "file" | "note">("link");
  const [title, setTitle] = useState("");
  const [url, setUrl] = useState("");
  const [note, setNote] = useState("");
  const [source, setSource] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);

  const load = async () => {
    let q = supabase
      .from("roadmap_task_evidence")
      .select("*")
      .eq("task_id", taskId)
      .order("created_at", { ascending: false });
    if (filterToItem && checklistItem) q = q.eq("checklist_item", checklistItem);
    const { data, error } = await q;
    if (!error && data) setItems(data as Evidence[]);
  };

  useEffect(() => {
    load();
    const ch = supabase
      .channel(`evidence-${taskId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "roadmap_task_evidence", filter: `task_id=eq.${taskId}` },
        () => load(),
      )
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [taskId, checklistItem, filterToItem]);

  const reset = () => {
    setTitle(""); setUrl(""); setNote(""); setSource(""); setFile(null); setKind("link"); setAdding(false);
  };

  const submit = async () => {
    if (!title.trim()) {
      toast({ title: "Title required", variant: "destructive" });
      return;
    }
    setBusy(true);
    try {
      const { data: u } = await supabase.auth.getUser();
      let storage_path: string | null = null;
      let resolvedUrl: string | null = url.trim() || null;

      if (kind === "file") {
        if (!file) {
          toast({ title: "Pick a file", variant: "destructive" });
          setBusy(false);
          return;
        }
        const safe = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
        const path = `${taskId}/${Date.now()}-${safe}`;
        const up = await supabase.storage.from("roadmap-evidence").upload(path, file, { upsert: false });
        if (up.error) throw up.error;
        storage_path = path;
      }

      const { error } = await supabase.from("roadmap_task_evidence").insert({
        task_id: taskId,
        checklist_item: checklistItem,
        kind,
        title: title.trim(),
        url: resolvedUrl,
        storage_path,
        note: note.trim() || null,
        source: source.trim() || null,
        added_by: u.user?.email ?? null,
      });
      if (error) throw error;
      toast({ title: "Evidence attached" });
      reset();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      toast({ title: "Failed to attach", description: msg, variant: "destructive" });
    } finally {
      setBusy(false);
    }
  };

  const remove = async (ev: Evidence) => {
    if (!confirm(`Remove evidence "${ev.title}"?`)) return;
    if (ev.storage_path) {
      await supabase.storage.from("roadmap-evidence").remove([ev.storage_path]);
    }
    const { error } = await supabase.from("roadmap_task_evidence").delete().eq("id", ev.id);
    if (error) toast({ title: "Delete failed", description: error.message, variant: "destructive" });
  };

  const openFile = async (ev: Evidence) => {
    if (!ev.storage_path) return;
    const { data, error } = await supabase.storage
      .from("roadmap-evidence")
      .createSignedUrl(ev.storage_path, 60 * 10);
    if (error || !data?.signedUrl) {
      toast({ title: "Could not open file", description: error?.message, variant: "destructive" });
      return;
    }
    window.open(data.signedUrl, "_blank");
  };

  const iconFor = (k: Evidence["kind"]) =>
    k === "link" ? <LinkIcon className="h-3 w-3" /> : k === "file" ? <Paperclip className="h-3 w-3" /> : <FileText className="h-3 w-3" />;

  return (
    <div className={compact ? "space-y-1.5" : "space-y-2"}>
      <div className="flex items-center justify-between">
        <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
          Research evidence {checklistItem && filterToItem && <span className="font-mono normal-case">· {checklistItem}</span>}
          <span className="ml-1 text-muted-foreground/70">({items.length})</span>
        </div>
        {!adding && (
          <Button size="sm" variant="ghost" className="h-6 text-[11px]" onClick={() => setAdding(true)}>
            + Attach
          </Button>
        )}
      </div>

      {items.length === 0 && !adding && (
        <div className="text-[11px] italic text-muted-foreground">No evidence attached yet.</div>
      )}

      <div className="space-y-1">
        {items.map((ev) => (
          <div key={ev.id} className="text-[11px] border border-border rounded p-1.5 bg-muted/20">
            <div className="flex items-start gap-2">
              <span className="text-muted-foreground mt-0.5">{iconFor(ev.kind)}</span>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5 flex-wrap">
                  <span className="font-medium">{ev.title}</span>
                  {ev.checklist_item && !filterToItem && (
                    <span className="font-mono text-[10px] text-muted-foreground">· {ev.checklist_item}</span>
                  )}
                  {ev.source && <span className="text-[10px] text-muted-foreground">· {ev.source}</span>}
                </div>
                {ev.url && (
                  <a href={ev.url} target="_blank" rel="noreferrer" className="text-[10px] text-primary hover:underline inline-flex items-center gap-0.5 break-all">
                    {ev.url} <ExternalLink className="h-2.5 w-2.5" />
                  </a>
                )}
                {ev.storage_path && (
                  <button onClick={() => openFile(ev)} className="text-[10px] text-primary hover:underline inline-flex items-center gap-0.5">
                    {ev.storage_path.split("/").pop()} <ExternalLink className="h-2.5 w-2.5" />
                  </button>
                )}
                {ev.note && <div className="mt-0.5 text-muted-foreground whitespace-pre-wrap">{ev.note}</div>}
                <div className="text-[10px] text-muted-foreground/70 mt-0.5">
                  {ev.added_by ?? "system"} · {new Date(ev.created_at).toLocaleString()}
                </div>
              </div>
              <button onClick={() => remove(ev)} className="text-muted-foreground hover:text-destructive" title="Remove">
                <Trash2 className="h-3 w-3" />
              </button>
            </div>
          </div>
        ))}
      </div>

      {adding && (
        <div className="border border-border rounded p-2 space-y-1.5 bg-background">
          <div className="flex gap-1">
            {(["link", "file", "note"] as const).map((k) => (
              <button
                key={k}
                onClick={() => setKind(k)}
                className={`text-[10px] px-2 py-0.5 rounded border ${
                  kind === k ? "bg-secondary text-secondary-foreground border-secondary" : "border-border text-muted-foreground"
                }`}
              >
                {k}
              </button>
            ))}
            {checklistItem && (
              <span className="text-[10px] text-muted-foreground self-center ml-1 font-mono">
                → {checklistItem}
              </span>
            )}
          </div>
          <Input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Title (e.g. SFG20 schedule reference)"
            className="h-7 text-xs"
          />
          {kind === "link" && (
            <Input
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://…"
              className="h-7 text-xs"
            />
          )}
          {kind === "file" && (
            <label className="flex items-center gap-2 text-[11px] cursor-pointer border border-dashed border-border rounded px-2 py-1.5 hover:bg-muted/30">
              <Upload className="h-3 w-3" />
              <span>{file ? file.name : "Choose file…"}</span>
              <input type="file" className="hidden" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
            </label>
          )}
          <Input
            value={source}
            onChange={(e) => setSource(e.target.value)}
            placeholder="Source (e.g. ADR-0003, RICS standard, vendor doc)"
            className="h-7 text-xs"
          />
          <Textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Why this matters / what it proves…"
            className="text-xs min-h-[50px]"
          />
          <div className="flex gap-1 justify-end">
            <Button size="sm" variant="ghost" className="h-7 text-[11px]" onClick={reset} disabled={busy}>
              Cancel
            </Button>
            <Button size="sm" className="h-7 text-[11px]" onClick={submit} disabled={busy || !title.trim()}>
              {busy ? "Saving…" : "Attach"}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
};
