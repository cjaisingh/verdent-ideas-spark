import { useEffect, useRef, useState } from "react";
import { ArrowLeftRight, GripVertical, MoveRight, Trash2 } from "lucide-react";
import { TEMPLATES } from "./templates";
import { AddWidgetMenu } from "./AddWidgetMenu";
import { WIDGET_REGISTRY } from "./widgets/registry";
import type { Tab, Widget, WidgetKind } from "./widgets/types";

const DRAG_MIME = "application/x-dashboard-slot";

/** Build a styled off-DOM element to use as the native drag image. */
function makeDragGhost(label: string): HTMLElement {
  const el = document.createElement("div");
  el.textContent = label;
  el.style.cssText = [
    "position:absolute",
    "top:-1000px",
    "left:-1000px",
    "padding:6px 10px",
    "border-radius:6px",
    "font:600 12px/1 ui-sans-serif,system-ui,-apple-system",
    "letter-spacing:0.02em",
    "background:hsl(var(--primary))",
    "color:hsl(var(--primary-foreground))",
    "box-shadow:0 8px 20px -6px rgba(0,0,0,0.35)",
    "white-space:nowrap",
    "pointer-events:none",
    "z-index:9999",
  ].join(";");
  document.body.appendChild(el);
  return el;
}

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
  const ghostRef = useRef<HTMLElement | null>(null);

  // Clean up any leftover drag ghost if the component unmounts mid-drag.
  useEffect(() => {
    return () => {
      ghostRef.current?.remove();
      ghostRef.current = null;
    };
  }, []);

  const endDrag = () => {
    setDragFrom(null);
    setDragOver(null);
    ghostRef.current?.remove();
    ghostRef.current = null;
  };

  const dragging = dragFrom !== null;

  return (
    <div className={`${template.gridClass} h-full min-h-[480px]`}>
      {template.slots.map((slot, i) => {
        const widget = tab.widgets[i] ?? null;
        const entry = widget ? WIDGET_REGISTRY[widget.kind] : null;
        const isDragSource = dragFrom === i;
        const isDropCandidate = dragging && !isDragSource;
        const isHovered = isDropCandidate && dragOver === i;
        const targetIsOccupied = !!widget;

        // Visual states:
        // - source: dimmed, primary dashed outline
        // - candidate (any non-source slot during drag): subtle dashed outline
        // - hovered occupied target: amber ring + "Swap" hint
        // - hovered empty target: emerald ring + "Move here" hint
        const baseRing = isDragSource
          ? "outline-dashed outline-2 outline-primary/60 outline-offset-2 opacity-50"
          : isDropCandidate
            ? "outline-dashed outline-1 outline-border outline-offset-2"
            : "";
        const hoverRing = isHovered
          ? targetIsOccupied
            ? "ring-2 ring-amber-500 ring-offset-2 ring-offset-background"
            : "ring-2 ring-emerald-500 ring-offset-2 ring-offset-background"
          : "";

        return (
          <div
            key={i}
            className={`${slot.className} relative min-h-0 rounded-md transition ${baseRing} ${hoverRing}`}
            onDragOver={(e) => {
              if (!editing || !dragging) return;
              e.preventDefault();
              e.dataTransfer.dropEffect = "move";
              if (dragOver !== i) setDragOver(i);
            }}
            onDragLeave={(e) => {
              // Only clear when leaving the slot itself, not on child enter.
              if (e.currentTarget.contains(e.relatedTarget as Node)) return;
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
                  const ghost = makeDragGhost(entry.label);
                  ghostRef.current = ghost;
                  e.dataTransfer.setDragImage(ghost, 12, 12);
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
            ) : editing && !dragging ? (
              <AddWidgetMenu
                onPick={(kind: WidgetKind) => onAdd(i, { id: newId(), kind })}
              />
            ) : (
              <div className="flex h-full items-center justify-center rounded-md border border-dashed border-border text-xs text-muted-foreground">
                empty
              </div>
            )}

            {/* Hover hint badge */}
            {isHovered && (
              <div
                className={`pointer-events-none absolute inset-x-0 bottom-2 z-20 mx-auto flex w-fit items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-semibold shadow-md ${
                  targetIsOccupied
                    ? "bg-amber-500 text-white"
                    : "bg-emerald-500 text-white"
                }`}
              >
                {targetIsOccupied ? (
                  <>
                    <ArrowLeftRight className="h-3 w-3" />
                    Swap
                  </>
                ) : (
                  <>
                    <MoveRight className="h-3 w-3" />
                    Move here
                  </>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
