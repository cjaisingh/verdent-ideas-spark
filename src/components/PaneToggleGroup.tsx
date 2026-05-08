import { useEffect } from "react";
import { PanelLeft, Columns2, Square, PanelBottom } from "lucide-react";
import { cn } from "@/lib/utils";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import type { PaneMode } from "@/lib/pane-state";

const MODES: Array<{
  mode: PaneMode;
  Icon: typeof PanelLeft;
  label: string;
  shortcut: string;
  key: string;
}> = [
  { mode: "left", Icon: PanelLeft, label: "Left only", shortcut: "⌘1", key: "1" },
  { mode: "dual", Icon: Columns2, label: "Dual (left + right)", shortcut: "⌘2", key: "2" },
  { mode: "centre", Icon: Square, label: "Centre / focus", shortcut: "⌘3", key: "3" },
  { mode: "bottom", Icon: PanelBottom, label: "Bottom drawer", shortcut: "⌘4", key: "4" },
];

interface Props {
  mode: PaneMode;
  onChange: (mode: PaneMode) => void;
  disabled?: boolean;
}

export function PaneToggleGroup({ mode, onChange, disabled = false }: Props) {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (disabled) return;
      if (!(e.metaKey || e.ctrlKey)) return;
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)) return;
      const found = MODES.find((m) => m.key === e.key);
      if (!found) return;
      e.preventDefault();
      onChange(found.mode);
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onChange, disabled]);

  return (
    <TooltipProvider delayDuration={200}>
      <div
        className={cn(
          "inline-flex items-center gap-0.5 rounded-md border border-border bg-muted/40 p-0.5 transition-opacity",
          disabled && "opacity-50 pointer-events-none",
        )}
      >
        {MODES.map(({ mode: m, Icon, label, shortcut }) => {
          const active = m === mode;
          return (
            <Tooltip key={m}>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  disabled={disabled}
                  onClick={() => onChange(m)}
                  aria-label={label}
                  aria-pressed={active}
                  className={cn(
                    "inline-flex h-7 w-7 items-center justify-center rounded transition-colors",
                    active
                      ? "bg-background text-foreground shadow-sm"
                      : "text-muted-foreground hover:text-foreground hover:bg-background/50",
                  )}
                >
                  <Icon className="h-3.5 w-3.5" />
                </button>
              </TooltipTrigger>
              <TooltipContent side="bottom" className="text-xs">
                {label} <span className="ml-1 text-muted-foreground">{shortcut}</span>
              </TooltipContent>
            </Tooltip>
          );
        })}
      </div>
    </TooltipProvider>
  );
}
