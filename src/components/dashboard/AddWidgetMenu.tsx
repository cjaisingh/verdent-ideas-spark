import { Plus } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { WIDGET_LIST } from "./widgets/registry";
import type { WidgetKind } from "./widgets/types";

export function AddWidgetMenu({ onPick }: { onPick: (kind: WidgetKind) => void }) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="flex h-full w-full flex-col items-center justify-center gap-1 rounded-md border border-dashed border-border text-muted-foreground hover:border-primary hover:text-primary transition"
        >
          <Plus className="h-5 w-5" />
          <span className="text-xs">Add widget</span>
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-64 p-1" align="start">
        <ul className="text-sm">
          {WIDGET_LIST.map((w) => (
            <li key={w.kind}>
              <button
                type="button"
                onClick={() => onPick(w.kind)}
                className="w-full rounded px-2 py-1.5 text-left hover:bg-accent hover:text-accent-foreground"
              >
                <div className="font-medium">{w.label}</div>
                <div className="text-xs text-muted-foreground">{w.description}</div>
              </button>
            </li>
          ))}
        </ul>
      </PopoverContent>
    </Popover>
  );
}
