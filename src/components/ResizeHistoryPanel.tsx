import { History, Undo2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import type { PaneMode, ViewportClass } from "@/lib/pane-state";

export type ResizeHistoryEntry = {
  id: string;
  ts: number;
  viewport: ViewportClass;
  mode: PaneMode;
  axis: "right" | "bottom";
  before: number;
  after: number;
};

interface Props {
  entries: ResizeHistoryEntry[];
  onUndo: (entry: ResizeHistoryEntry) => void;
  onClear: () => void;
}

function relativeTime(ts: number): string {
  const s = Math.max(1, Math.round((Date.now() - ts) / 1000));
  if (s < 60) return `${s}s ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  return `${Math.round(m / 60)}h ago`;
}

export function ResizeHistoryPanel({ entries, onUndo, onClear }: Props) {
  return (
    <Popover>
      <TooltipProvider delayDuration={200}>
        <Tooltip>
          <TooltipTrigger asChild>
            <PopoverTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7 relative"
                aria-label="Resize history"
              >
                <History className="h-3.5 w-3.5" />
                {entries.length > 0 && (
                  <span className="absolute -top-0.5 -right-0.5 h-3.5 min-w-3.5 px-1 rounded-full bg-amber-500 text-[9px] font-mono text-background flex items-center justify-center">
                    {entries.length}
                  </span>
                )}
              </Button>
            </PopoverTrigger>
          </TooltipTrigger>
          <TooltipContent side="bottom" className="text-xs">
            Resize history (this session)
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
      <PopoverContent align="end" className="w-80 p-0">
        <div className="flex items-center justify-between border-b border-border px-3 py-2">
          <span className="text-xs font-semibold">Resize history</span>
          {entries.length > 0 && (
            <button
              type="button"
              onClick={onClear}
              className="text-[10px] text-muted-foreground hover:text-foreground"
            >
              Clear
            </button>
          )}
        </div>
        {entries.length === 0 ? (
          <div className="px-3 py-6 text-center text-xs text-muted-foreground">
            No resize changes yet this session.
          </div>
        ) : (
          <ul className="max-h-72 overflow-y-auto divide-y divide-border">
            {entries.map((e) => (
              <li key={e.id} className="flex items-center gap-2 px-3 py-2 text-xs">
                <span className="font-mono text-[10px] text-muted-foreground w-14 shrink-0">
                  {e.viewport}
                </span>
                <span className="font-mono text-[10px] text-muted-foreground w-12 shrink-0">
                  {e.mode}
                </span>
                <span className="flex-1 font-mono">
                  <span className="text-foreground">{e.axis === "right" ? "R" : "B"}</span>{" "}
                  <span className="text-muted-foreground">{e.before}%</span>
                  <span className="mx-1 text-muted-foreground">→</span>
                  <span className="text-foreground">{e.after}%</span>
                </span>
                <span className="text-[10px] text-muted-foreground shrink-0">
                  {relativeTime(e.ts)}
                </span>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6 shrink-0"
                  onClick={() => onUndo(e)}
                  aria-label={`Undo resize ${e.axis} ${e.before}% to ${e.after}%`}
                >
                  <Undo2 className="h-3 w-3" />
                </Button>
              </li>
            ))}
          </ul>
        )}
      </PopoverContent>
    </Popover>
  );
}
