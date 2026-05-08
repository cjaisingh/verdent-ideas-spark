import { Keyboard } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="inline-flex items-center justify-center min-w-5 h-5 px-1 rounded border border-border bg-muted font-mono text-[10px] text-foreground">
      {children}
    </kbd>
  );
}

export function PaneKeyboardHelp() {
  const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);
  const mod = isMac ? "⌘" : "Ctrl";
  return (
    <Popover>
      <TooltipProvider delayDuration={200}>
        <Tooltip>
          <TooltipTrigger asChild>
            <PopoverTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7"
                aria-label="Keyboard shortcuts and pane resize help"
              >
                <Keyboard className="h-3.5 w-3.5" />
              </Button>
            </PopoverTrigger>
          </TooltipTrigger>
          <TooltipContent side="bottom" className="text-xs">
            Keyboard help
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
      <PopoverContent align="end" className="w-80 p-0">
        <div className="border-b border-border px-3 py-2">
          <span className="text-xs font-semibold">Keyboard & resize help</span>
        </div>
        <dl className="px-3 py-2 space-y-3 text-xs">
          <div>
            <dt className="font-medium text-foreground mb-1">Switch pane mode</dt>
            <dd className="flex flex-wrap items-center gap-1.5 text-muted-foreground">
              <Kbd>{mod}</Kbd>+<Kbd>1</Kbd> Left only ·
              <Kbd>{mod}</Kbd>+<Kbd>2</Kbd> Dual ·
              <Kbd>{mod}</Kbd>+<Kbd>3</Kbd> Centre ·
              <Kbd>{mod}</Kbd>+<Kbd>4</Kbd> Bottom
            </dd>
          </div>
          <div>
            <dt className="font-medium text-foreground mb-1">Resize panes</dt>
            <dd className="text-muted-foreground space-y-1">
              <div className="flex items-center gap-1.5">
                <Kbd>Tab</Kbd> to focus a resize handle, then
                <Kbd>←</Kbd>/<Kbd>→</Kbd>
                or <Kbd>↑</Kbd>/<Kbd>↓</Kbd> to resize.
              </div>
              <div className="flex items-center gap-1.5">
                <Kbd>Home</Kbd>/<Kbd>End</Kbd> jump to min/max bounds.
              </div>
              <div>Or drag the handle with the mouse.</div>
            </dd>
          </div>
          <div>
            <dt className="font-medium text-foreground mb-1">During a resize</dt>
            <dd className="text-muted-foreground">
              Pane mode switching ({mod}+1–4 and the toggle buttons) is locked
              until the resize completes — your previous mode stays selected.
            </dd>
          </div>
          <div>
            <dt className="font-medium text-foreground mb-1">Reset</dt>
            <dd className="text-muted-foreground">
              Use the header buttons to reset sizes for the current mode, the
              current screen, or restore the route to default layout.
            </dd>
          </div>
        </dl>
      </PopoverContent>
    </Popover>
  );
}
