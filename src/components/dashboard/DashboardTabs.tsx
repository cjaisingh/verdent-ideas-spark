import { useState } from "react";
import { Plus, Pencil, Trash2, Check, X, Copy } from "lucide-react";
import { TEMPLATE_LIST } from "./templates";
import type { Tab, TemplateId } from "./widgets/types";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";

export function DashboardTabs({
  tabs,
  activeTabId,
  maxTabs,
  editing,
  onSelect,
  onAdd,
  onRename,
  onDelete,
  onDuplicate,
  onReorder,
  onTemplateChange,
}: {
  tabs: Tab[];
  activeTabId: string | null;
  maxTabs: number;
  editing: boolean;
  onSelect: (id: string) => void;
  onAdd: () => void;
  onRename: (id: string, name: string) => void;
  onDelete: (id: string) => void;
  onDuplicate: (id: string) => void;
  onReorder: (fromId: string, toId: string) => void;
  onTemplateChange: (id: string, template: TemplateId) => void;
}) {
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const activeTab = tabs.find((t) => t.id === activeTabId) ?? null;

  const startRename = (t: Tab) => {
    setRenamingId(t.id);
    setRenameValue(t.name);
  };
  const commitRename = () => {
    if (renamingId) onRename(renamingId, renameValue.trim());
    setRenamingId(null);
  };

  return (
    <div className="flex flex-wrap items-center gap-1 border-b border-border px-2 py-1.5">
      {tabs.map((t) => {
        const active = t.id === activeTabId;
        const isRenaming = renamingId === t.id;
        return (
          <div
            key={t.id}
            draggable={editing && !isRenaming}
            onDragStart={(e) => e.dataTransfer.setData("text/tab-id", t.id)}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              const fromId = e.dataTransfer.getData("text/tab-id");
              if (fromId && fromId !== t.id) onReorder(fromId, t.id);
            }}
            className={`group flex items-center gap-1 rounded-md px-2 py-1 text-sm transition ${
              active
                ? "bg-accent text-accent-foreground"
                : "text-muted-foreground hover:bg-accent/50 hover:text-foreground"
            }`}
          >
            {isRenaming ? (
              <>
                <input
                  autoFocus
                  value={renameValue}
                  onChange={(e) => setRenameValue(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") commitRename();
                    if (e.key === "Escape") setRenamingId(null);
                  }}
                  maxLength={24}
                  className="w-24 rounded bg-background px-1 py-0.5 text-sm outline-none ring-1 ring-border focus:ring-primary"
                />
                <button onClick={commitRename} className="text-emerald-600" aria-label="Save">
                  <Check className="h-3.5 w-3.5" />
                </button>
                <button onClick={() => setRenamingId(null)} className="text-muted-foreground" aria-label="Cancel">
                  <X className="h-3.5 w-3.5" />
                </button>
              </>
            ) : (
              <>
                <button
                  type="button"
                  onClick={() => onSelect(t.id)}
                  onDoubleClick={() => editing && startRename(t)}
                  className="font-medium"
                >
                  {t.name}
                </button>
                {editing && (
                  <>
                    <button
                      type="button"
                      onClick={() => startRename(t)}
                      className="opacity-50 hover:opacity-100"
                      aria-label={`Rename ${t.name}`}
                    >
                      <Pencil className="h-3 w-3" />
                    </button>
                    <button
                      type="button"
                      onClick={() => onDuplicate(t.id)}
                      disabled={tabs.length >= maxTabs}
                      className="opacity-50 hover:opacity-100 disabled:opacity-20 disabled:cursor-not-allowed"
                      aria-label={`Duplicate ${t.name}`}
                      title={tabs.length >= maxTabs ? `Max ${maxTabs} tabs` : "Duplicate tab"}
                    >
                      <Copy className="h-3 w-3" />
                    </button>
                    {tabs.length > 1 && (
                      <button
                        type="button"
                        onClick={() => setConfirmDeleteId(t.id)}
                        className="opacity-50 hover:opacity-100 hover:text-destructive"
                        aria-label={`Delete ${t.name}`}
                      >
                        <Trash2 className="h-3 w-3" />
                      </button>
                    )}
                  </>
                )}
              </>
            )}
          </div>
        );
      })}

      <button
        type="button"
        onClick={onAdd}
        disabled={tabs.length >= maxTabs}
        className="ml-1 inline-flex items-center gap-1 rounded-md px-2 py-1 text-sm text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-40 disabled:hover:bg-transparent disabled:cursor-not-allowed"
        title={tabs.length >= maxTabs ? `Max ${maxTabs} tabs` : "Add tab"}
      >
        <Plus className="h-3.5 w-3.5" />
        <span>Tab</span>
      </button>

      {editing && activeTab && (
        <div className="ml-auto flex items-center gap-2 text-xs text-muted-foreground">
          <span>Layout</span>
          <Select
            value={activeTab.template}
            onValueChange={(v) => onTemplateChange(activeTab.id, v as TemplateId)}
          >
            <SelectTrigger className="h-7 w-40">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {TEMPLATE_LIST.map((tpl) => (
                <SelectItem key={tpl.id} value={tpl.id}>
                  {tpl.label} — {tpl.description}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}

      {confirmDeleteId && (
        <div
          role="dialog"
          className="fixed inset-0 z-50 flex items-center justify-center bg-background/60 p-4"
          onClick={() => setConfirmDeleteId(null)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-sm rounded-lg border border-border bg-card p-4 shadow-xl"
          >
            <h2 className="text-sm font-semibold">Delete this tab?</h2>
            <p className="mt-1 text-xs text-muted-foreground">
              This removes the tab and all of its widget slots. You can rebuild it later.
            </p>
            <div className="mt-3 flex justify-end gap-2">
              <button
                onClick={() => setConfirmDeleteId(null)}
                className="rounded border border-border px-3 py-1 text-sm hover:bg-accent"
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  onDelete(confirmDeleteId);
                  setConfirmDeleteId(null);
                }}
                className="rounded bg-destructive px-3 py-1 text-sm text-destructive-foreground hover:opacity-90"
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
