import { useState } from "react";
import { GripVertical, Trash2 } from "lucide-react";
import { TEMPLATES } from "./templates";
import { AddWidgetMenu } from "./AddWidgetMenu";
import { WIDGET_REGISTRY } from "./widgets/registry";
import type { Tab, Widget, WidgetKind } from "./widgets/types";

const DRAG_MIME = "application/x-dashboard-slot";

export function BentoGrid({
  tab,
  editing,
  onAdd,
  onRemove,
  onSwap,
  newId,
}: {
  tab: Tab;
  editing: boolean;
  onAdd: (slotIndex: number, widget: Widget) => void;
  onRemove: (slotIndex: number) => void;
  onSwap: (fromIndex: number, toIndex: number) => void;
  newId: () => string;
}) {
  const template = TEMPLATES[tab.template];
  const [dragFrom, setDragFrom] = useState<number | null>(null);
  const [dragOver, setDragOver] = useState<number | null>(null);

  const endDrag = () => {
    setDragFrom(null);
    setDragOver(null);
  };

  return (
    <div className={`${template.gridClass} h-full min-h-[480px]`}>
      {template.slots.map((slot, i) => {
        const widget = tab.widgets[i] ?? null;
        const entry = widget ? WIDGET_REGISTRY[widget.kind] : null;
        const isDragSource = dragFrom === i;
        const isDropTarget = editing && dragFrom !== null && dragFrom !== i && dragOver === i;

        return (
          <div
            key={i}
            className={`${slot.className} relative min-h-0 transition ${
              isDragSource ? "opacity-40" : ""
            } ${isDropTarget ? "ring-2 ring-primary ring-offset-2 ring-offset-background rounded-md" : ""}`}
            onDragOver={(e) => {
              if (!editing || dragFrom === null) return;
              e.preventDefault();
              e.dataTransfer.dropEffect = "move";
              if (dragOver !== i) setDragOver(i);
            }}
            onDragLeave={() => {
              if (dragOver === i) setDragOver(null);
            }}
            onDrop={(e) => {
              if (!editing) return;
              const raw = e.dataTransfer.getData(DRAG_MIME);
              const from = raw ? Number(raw) : NaN;
              if (Number.isFinite(from) && from !== i) {
                e.preventDefault();
                onSwap(from, i);
              }
              endDrag();
            }}
          >
            {widget && entry ? (
              <div
                className="h-full w-full"
                draggable={editing}
                onDragStart={(e) => {
                  if (!editing) return;
                  e.dataTransfer.setData(DRAG_MIME, String(i));
                  e.dataTransfer.effectAllowed = "move";
                  setDragFrom(i);
                }}
                onDragEnd={endDrag}
              >
                <entry.Component size={slot.size} />
                {editing && (
                  <>
                    <div
                      className="absolute left-2 top-2 z-10 rounded bg-background/90 border border-border p-1 text-muted-foreground shadow-sm cursor-grab active:cursor-grabbing"
                      aria-label={`Drag ${entry.label}`}
                      title="Drag to swap"
                    >
                      <GripVertical className="h-3.5 w-3.5" />
                    </div>
                    <button
                      type="button"
                      onClick={() => onRemove(i)}
                      className="absolute right-2 top-2 z-10 rounded bg-background/90 border border-border p-1 text-muted-foreground hover:text-destructive shadow-sm"
                      aria-label={`Remove ${entry.label}`}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </>
                )}
              </div>
            ) : editing ? (
              <AddWidgetMenu
                onPick={(kind: WidgetKind) => onAdd(i, { id: newId(), kind })}
              />
            ) : (
              <div className="flex h-full items-center justify-center rounded-md border border-dashed border-border text-xs text-muted-foreground">
                empty
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
