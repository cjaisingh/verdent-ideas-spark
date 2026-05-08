import { Trash2 } from "lucide-react";
import { TEMPLATES } from "./templates";
import { AddWidgetMenu } from "./AddWidgetMenu";
import { WIDGET_REGISTRY } from "./widgets/registry";
import type { Tab, Widget, WidgetKind } from "./widgets/types";

export function BentoGrid({
  tab,
  editing,
  onAdd,
  onRemove,
  newId,
}: {
  tab: Tab;
  editing: boolean;
  onAdd: (slotIndex: number, widget: Widget) => void;
  onRemove: (slotIndex: number) => void;
  newId: () => string;
}) {
  const template = TEMPLATES[tab.template];

  return (
    <div className={`${template.gridClass} h-full min-h-[480px]`}>
      {template.slots.map((slot, i) => {
        const widget = tab.widgets[i] ?? null;
        const entry = widget ? WIDGET_REGISTRY[widget.kind] : null;
        return (
          <div key={i} className={`${slot.className} relative min-h-0`}>
            {widget && entry ? (
              <>
                <entry.Component size={slot.size} />
                {editing && (
                  <button
                    type="button"
                    onClick={() => onRemove(i)}
                    className="absolute right-2 top-2 z-10 rounded bg-background/90 border border-border p-1 text-muted-foreground hover:text-destructive shadow-sm"
                    aria-label={`Remove ${entry.label}`}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                )}
              </>
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
