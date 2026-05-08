import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/hooks/use-toast";
import { Trash2, Plus, Sparkles, Paperclip } from "lucide-react";
import { EvidencePanel } from "@/components/EvidencePanel";

export type ChecklistItem = {
  id: string;
  task_id: string;
  item_key: string;
  category: "sources" | "risk" | "verify" | "custom";
  label: string;
  checked: boolean;
  note: string | null;
  order: number;
  checked_by: string | null;
  checked_at: string | null;
};

const DEFAULT_TEMPLATE: Array<Omit<ChecklistItem, "id" | "task_id" | "checked" | "note" | "checked_by" | "checked_at">> = [
  { item_key: "acceptance-line", category: "verify", label: "Acceptance criteria are explicit and testable", order: 10 },
  { item_key: "rls-migration", category: "verify", label: "RLS migration covers new tables / columns", order: 20 },
  { item_key: "no-plaintext-secrets", category: "verify", label: "No plaintext secrets; uses configured secret store", order: 30 },
  { item_key: "events-emitted", category: "verify", label: "Mutations emit events into *_events table", order: 40 },
  { item_key: "idempotency-replay", category: "verify", label: "Write endpoints replay-safe via Idempotency-Key", order: 50 },
  { item_key: "changelog-entry", category: "verify", label: "CHANGELOG entry written", order: 60 },
  { item_key: "research-sources", category: "sources", label: "Research sources cited (ADR / standard / vendor doc)", order: 70 },
  { item_key: "risk-flags", category: "risk", label: "Risk flags reviewed (security / privacy / cost / vendor)", order: 80 },
];

const CAT_STYLES: Record<ChecklistItem["category"], string> = {
  sources: "border-sky-500/40 bg-sky-500/10 text-sky-600",
  risk: "border-amber-500/40 bg-amber-500/10 text-amber-600",
  verify: "border-emerald-500/40 bg-emerald-500/10 text-emerald-700",
  custom: "border-muted-foreground/30 bg-muted text-muted-foreground",
};

const slugify = (s: string) =>
  s.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60) || `item-${Date.now()}`;

export const ReviewChecklistEditor = ({ taskId }: { taskId: string }) => {
  const [items, setItems] = useState<ChecklistItem[]>([]);
  const [adding, setAdding] = useState(false);
  const [newLabel, setNewLabel] = useState("");
  const [newCategory, setNewCategory] = useState<ChecklistItem["category"]>("custom");
  const [editingNoteFor, setEditingNoteFor] = useState<string | null>(null);
  const [noteDraft, setNoteDraft] = useState("");
  const [evidenceFor, setEvidenceFor] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = async () => {
    const { data, error } = await supabase
      .from("roadmap_task_checklist")
      .select("*")
      .eq("task_id", taskId)
      .order("order");
    if (!error && data) setItems(data as ChecklistItem[]);
  };

  useEffect(() => {
    load();
    const ch = supabase
      .channel(`checklist-${taskId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "roadmap_task_checklist", filter: `task_id=eq.${taskId}` },
        () => load(),
      )
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [taskId]);

  const seedTemplate = async () => {
    setBusy(true);
    try {
      const rows = DEFAULT_TEMPLATE.map((t) => ({ ...t, task_id: taskId }));
      const { error } = await supabase
        .from("roadmap_task_checklist")
        .upsert(rows, { onConflict: "task_id,item_key", ignoreDuplicates: true });
      if (error) throw error;
      toast({ title: "Default checklist added" });
    } catch (e: unknown) {
      toast({ title: "Failed to seed", description: e instanceof Error ? e.message : String(e), variant: "destructive" });
    } finally {
      setBusy(false);
    }
  };

  const toggle = async (item: ChecklistItem) => {
    const next = !item.checked;
    const { data: u } = await supabase.auth.getUser();
    const { error } = await supabase
      .from("roadmap_task_checklist")
      .update({
        checked: next,
        checked_by: next ? u.user?.email ?? null : null,
        checked_at: next ? new Date().toISOString() : null,
      })
      .eq("id", item.id);
    if (error) toast({ title: "Update failed", description: error.message, variant: "destructive" });
  };

  const addItem = async () => {
    const label = newLabel.trim();
    if (!label) return;
    if (label.length > 200) {
      toast({ title: "Label too long", description: "Max 200 characters", variant: "destructive" });
      return;
    }
    const item_key = slugify(label);
    const order = (items[items.length - 1]?.order ?? 0) + 10;
    const { error } = await supabase
      .from("roadmap_task_checklist")
      .insert({ task_id: taskId, item_key, category: newCategory, label, order });
    if (error) {
      toast({ title: "Failed to add", description: error.message, variant: "destructive" });
      return;
    }
    setNewLabel("");
    setNewCategory("custom");
    setAdding(false);
  };

  const removeItem = async (item: ChecklistItem) => {
    if (!confirm(`Remove "${item.label}"?`)) return;
    const { error } = await supabase.from("roadmap_task_checklist").delete().eq("id", item.id);
    if (error) toast({ title: "Delete failed", description: error.message, variant: "destructive" });
  };

  const startNote = (item: ChecklistItem) => {
    setEditingNoteFor(item.id);
    setNoteDraft(item.note ?? "");
  };
  const saveNote = async (item: ChecklistItem) => {
    const trimmed = noteDraft.trim().slice(0, 1000);
    const { error } = await supabase
      .from("roadmap_task_checklist")
      .update({ note: trimmed || null })
      .eq("id", item.id);
    if (error) toast({ title: "Save failed", description: error.message, variant: "destructive" });
    setEditingNoteFor(null);
    setNoteDraft("");
  };

  const total = items.length;
  const done = items.filter((i) => i.checked).length;

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
          Review checklist
          {total > 0 && (
            <span className="ml-1 text-muted-foreground/70">
              ({done}/{total})
            </span>
          )}
        </div>
        <div className="flex items-center gap-1">
          {items.length === 0 && (
            <Button size="sm" variant="ghost" className="h-6 text-[11px]" onClick={seedTemplate} disabled={busy}>
              <Sparkles className="h-3 w-3 mr-1" /> Seed default
            </Button>
          )}
          {!adding && (
            <Button size="sm" variant="ghost" className="h-6 text-[11px]" onClick={() => setAdding(true)}>
              <Plus className="h-3 w-3 mr-1" /> Add
            </Button>
          )}
        </div>
      </div>

      {total > 0 && (
        <div className="h-1 rounded bg-muted overflow-hidden">
          <div
            className="h-full bg-primary transition-all"
            style={{ width: `${total > 0 ? (done / total) * 100 : 0}%` }}
          />
        </div>
      )}

      {items.length === 0 && !adding && (
        <div className="text-[11px] italic text-muted-foreground">
          No checklist yet. Seed the default review template or add custom items.
        </div>
      )}

      <div className="space-y-1">
        {items.map((item) => (
          <div key={item.id} className="text-[11px] border border-border rounded p-1.5 bg-muted/20">
            <div className="flex items-start gap-2">
              <input
                type="checkbox"
                checked={item.checked}
                onChange={() => toggle(item)}
                className="mt-0.5 h-3.5 w-3.5 cursor-pointer accent-primary shrink-0"
              />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5 flex-wrap">
                  <span className={`text-[9px] font-mono uppercase px-1 py-0 rounded border ${CAT_STYLES[item.category]}`}>
                    {item.category}
                  </span>
                  <span className={`${item.checked ? "line-through text-muted-foreground" : ""}`}>{item.label}</span>
                  <span className="text-[10px] text-muted-foreground/70 font-mono">· {item.item_key}</span>
                </div>
                {item.checked && item.checked_by && (
                  <div className="text-[10px] text-muted-foreground/70 mt-0.5">
                    ✓ {item.checked_by} · {item.checked_at ? new Date(item.checked_at).toLocaleString() : ""}
                  </div>
                )}
                {editingNoteFor === item.id ? (
                  <div className="mt-1 space-y-1">
                    <Textarea
                      value={noteDraft}
                      onChange={(e) => setNoteDraft(e.target.value)}
                      maxLength={1000}
                      className="text-xs min-h-[50px]"
                      placeholder="Note (max 1000 chars)…"
                    />
                    <div className="flex gap-1 justify-end">
                      <Button size="sm" variant="ghost" className="h-6 text-[10px]" onClick={() => setEditingNoteFor(null)}>
                        Cancel
                      </Button>
                      <Button size="sm" className="h-6 text-[10px]" onClick={() => saveNote(item)}>
                        Save
                      </Button>
                    </div>
                  </div>
                ) : (
                  item.note && (
                    <div className="mt-0.5 text-muted-foreground whitespace-pre-wrap">{item.note}</div>
                  )
                )}
                <div className="flex items-center gap-2 mt-1">
                  {editingNoteFor !== item.id && (
                    <button
                      onClick={() => startNote(item)}
                      className="text-[10px] text-muted-foreground hover:text-foreground"
                    >
                      {item.note ? "Edit note" : "Add note"}
                    </button>
                  )}
                  <button
                    onClick={() => setEvidenceFor(evidenceFor === item.item_key ? null : item.item_key)}
                    className="text-[10px] text-muted-foreground hover:text-foreground inline-flex items-center gap-0.5"
                  >
                    <Paperclip className="h-2.5 w-2.5" />
                    {evidenceFor === item.item_key ? "Hide evidence" : "Evidence"}
                  </button>
                </div>
                {evidenceFor === item.item_key && (
                  <div className="mt-2 pl-2 border-l border-border">
                    <EvidencePanel taskId={taskId} checklistItem={item.item_key} filterToItem compact />
                  </div>
                )}
              </div>
              <button onClick={() => removeItem(item)} className="text-muted-foreground hover:text-destructive shrink-0" title="Remove">
                <Trash2 className="h-3 w-3" />
              </button>
            </div>
          </div>
        ))}
      </div>

      {adding && (
        <div className="border border-border rounded p-2 space-y-1.5 bg-background">
          <div className="flex gap-1">
            {(["verify", "sources", "risk", "custom"] as const).map((c) => (
              <button
                key={c}
                onClick={() => setNewCategory(c)}
                className={`text-[10px] px-2 py-0.5 rounded border ${
                  newCategory === c ? "bg-secondary text-secondary-foreground border-secondary" : "border-border text-muted-foreground"
                }`}
              >
                {c}
              </button>
            ))}
          </div>
          <Input
            value={newLabel}
            onChange={(e) => setNewLabel(e.target.value)}
            maxLength={200}
            placeholder="Checklist item…"
            className="h-7 text-xs"
            onKeyDown={(e) => {
              if (e.key === "Enter") addItem();
              if (e.key === "Escape") { setAdding(false); setNewLabel(""); }
            }}
          />
          <div className="flex gap-1 justify-end">
            <Button size="sm" variant="ghost" className="h-7 text-[11px]" onClick={() => { setAdding(false); setNewLabel(""); }}>
              Cancel
            </Button>
            <Button size="sm" className="h-7 text-[11px]" onClick={addItem} disabled={!newLabel.trim()}>
              Add
            </Button>
          </div>
        </div>
      )}
    </div>
  );
};
