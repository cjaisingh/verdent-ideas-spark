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
  /**
   * Subtle indicator dot per mode — used when the corresponding pane
   * (right or bottom) is currently hidden but has data worth opening.
   * Tooltip is augmented to explain why the dot is present.
   */
  indicators?: Partial<Record<PaneMode, { count: number; sourceLabel: string } | undefined>>;
}

export function PaneToggleGroup({ mode, onChange, disabled = false, indicators }: Props) {
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
          disabled && "opacity-50",
        )}
      >
        {MODES.map(({ mode: m, Icon, label, shortcut }) => {
          const active = m === mode;
          const indicator = !active ? indicators?.[m] : undefined;
          const hasIndicator = !!indicator && indicator.count > 0;
          return (
            <Tooltip key={m}>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  aria-disabled={disabled || undefined}
                  onClick={(e) => {
                    if (disabled) {
                      e.preventDefault();
                      return;
                    }
                    onChange(m);
                  }}
                  aria-label={
                    disabled
                      ? `${label} — locked while resizing panels`
                      : hasIndicator
                        ? `${label} — ${indicator!.sourceLabel} has ${indicator!.count} item${indicator!.count === 1 ? "" : "s"}`
                        : label
                  }
                  aria-pressed={active}
                  className={cn(
                    "relative inline-flex h-7 w-7 items-center justify-center rounded transition-colors",
                    active
                      ? "bg-background text-foreground shadow-sm"
                      : "text-muted-foreground hover:text-foreground hover:bg-background/50",
                    disabled && "cursor-not-allowed",
                  )}
                >
                  <Icon className="h-3.5 w-3.5" />
                  {hasIndicator && (
                    <span
                      aria-hidden
                      className="absolute top-0.5 right-0.5 inline-flex h-1.5 w-1.5 rounded-full bg-amber-500 ring-1 ring-background"
                    />
                  )}
                </button>
              </TooltipTrigger>
              <TooltipContent side="bottom" className="text-xs">
                {disabled ? (
                  <span>Pane switching locked while resizing panels</span>
                ) : (
                  <>
                    <div>
                      {label} <span className="ml-1 text-muted-foreground">{shortcut}</span>
                    </div>
                    {hasIndicator && (
                      <div className="mt-0.5 text-amber-600 dark:text-amber-400">
                        {indicator!.sourceLabel}: {indicator!.count}
                      </div>
                    )}
                  </>
                )}
              </TooltipContent>
            </Tooltip>
          );
        })}
      </div>
    </TooltipProvider>
  );
}
