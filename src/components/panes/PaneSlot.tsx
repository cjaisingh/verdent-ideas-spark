import { Suspense } from "react";
import { Link } from "react-router-dom";
import { Check, ChevronDown } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import {
  PANE_SOURCES,
  PANE_SOURCE_LIST,
  isPaneSourceId,
  type PaneSourceId,
} from "@/components/panes/sources";
import {
  getSlotSource,
  withSlotSource,
  usePaneState,
  type PaneSlotKey,
  type ViewportClass,
} from "@/lib/pane-state";
import { defaultSourceForRoute } from "@/lib/pane-defaults";

interface PaneSlotProps {
  slot: PaneSlotKey;
  viewport: ViewportClass;
}

export function PaneSlot({ slot, viewport }: PaneSlotProps) {
  const [paneState, setPaneState, routeKey] = usePaneState();

  const overrideRaw = getSlotSource(paneState, slot, viewport);
  const sourceId: PaneSourceId = isPaneSourceId(overrideRaw)
    ? overrideRaw
    : defaultSourceForRoute(routeKey, slot);
  const source = PANE_SOURCES[sourceId];
  const Icon = source.icon;

  const isCustom = isPaneSourceId(overrideRaw) && overrideRaw !== defaultSourceForRoute(routeKey, slot);

  return (
    <section className={cn(
      "h-full flex flex-col bg-background",
      slot === "right" ? "border-l border-border" : "border-t border-border",
    )}>
      <header className="h-9 px-2 flex items-center gap-1 border-b border-border shrink-0">
        <DropdownMenu>
          <DropdownMenuTrigger
            className={cn(
              "inline-flex items-center gap-1.5 h-7 px-1.5 rounded text-xs font-medium",
              "hover:bg-muted/60 transition-colors",
            )}
            aria-label={`Change ${slot} pane source (currently ${source.label})`}
          >
            <span className={cn("inline-flex h-4 w-4 items-center justify-center rounded", source.tintBgClass)}>
              <Icon className={cn("h-3 w-3", source.tintClass)} />
            </span>
            <span className="text-foreground">{source.label}</span>
            {isCustom && (
              <span className="h-1 w-1 rounded-full bg-amber-500" title="Source overridden for this route" />
            )}
            <ChevronDown className="h-3 w-3 text-muted-foreground" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-56">
            <DropdownMenuLabel className="text-[10px] uppercase tracking-wide text-muted-foreground">
              {slot === "right" ? "Right pane" : "Bottom pane"} source
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            {PANE_SOURCE_LIST.map((s) => {
              const SIcon = s.icon;
              const active = s.id === sourceId;
              return (
                <DropdownMenuItem
                  key={s.id}
                  onClick={() => {
                    setPaneState((prev) => withSlotSource(prev, slot, s.id, viewport));
                  }}
                  className="text-xs"
                >
                  <span className={cn("inline-flex h-4 w-4 items-center justify-center rounded mr-2", s.tintBgClass)}>
                    <SIcon className={cn("h-3 w-3", s.tintClass)} />
                  </span>
                  <span className="flex-1">{s.label}</span>
                  {active && <Check className="h-3 w-3 text-muted-foreground" />}
                </DropdownMenuItem>
              );
            })}
            {isCustom && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  onClick={() => {
                    // Reset just this slot for this viewport.
                    setPaneState((prev) => {
                      const byVp = prev.sourcesByViewportSlot ?? {};
                      const forVp = { ...(byVp[viewport] ?? {}) };
                      delete forVp[slot];
                      return {
                        ...prev,
                        sourcesByViewportSlot: { ...byVp, [viewport]: forVp },
                      };
                    });
                  }}
                  className="text-xs text-muted-foreground"
                >
                  Reset to route default
                </DropdownMenuItem>
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
        <Link
          to={source.openHref}
          className="ml-auto text-[10px] text-muted-foreground hover:text-foreground"
        >
          Open →
        </Link>
      </header>
      <div className="flex-1 min-h-0">
        <Suspense fallback={<div className="p-3 text-xs text-muted-foreground">Loading…</div>}>
          <source.Body />
        </Suspense>
      </div>
    </section>
  );
}
