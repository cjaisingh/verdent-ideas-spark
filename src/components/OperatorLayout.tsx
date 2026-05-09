import { useEffect, useRef, useState } from "react";
import { Link, Outlet, useNavigate, useLocation } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import PendingApprovalsIndicator from "@/components/PendingApprovalsIndicator";
import UtcClock from "@/components/UtcClock";
import { SidebarProvider } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/AppSidebar";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable";
import { PaneToggleGroup } from "@/components/PaneToggleGroup";
import { SIZE_BOUNDS, clearModeSizes, clearViewportSizes, getModeSizes, getSlotSource, hasModeSizeOverrides, hasViewportSizeOverrides, paneFlags, usePaneState, withModeSize } from "@/lib/pane-state";
import { Monitor, RefreshCw, RotateCcw } from "lucide-react";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { PaneSlot } from "@/components/panes/PaneSlot";
import { useViewport } from "@/hooks/use-viewport";
import { ResizeHistoryPanel, type ResizeHistoryEntry } from "@/components/ResizeHistoryPanel";
import { PaneKeyboardHelp } from "@/components/PaneKeyboardHelp";
import { useT, useRouteName, ROUTES } from "@/lib/i18n";
import { usePaneDataSignals } from "@/hooks/use-pane-data-signals";
import { PANE_SOURCES, isPaneSourceId, type PaneSourceId } from "@/components/panes/sources";
import { defaultSourceForRoute } from "@/lib/pane-defaults";

const toastedDecisions = new Set<string>();

const OperatorLayout = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const tenantsPath = ROUTES.tenants;
  const isOnTenants = location.pathname === tenantsPath || location.pathname.startsWith(`${tenantsPath}/`);
  const t = useT();
  const routeName = useRouteName();
  const tenantsName = routeName("tenants");
  const brand = t("awipCore.brand");
  const tenantsTooltip = t("nav.tooltip", { name: tenantsName, path: tenantsPath });
  const tenantsAria = t("nav.ariaLabel", { brand, name: tenantsName, path: tenantsPath });
  const [paneState, setPaneState] = usePaneState();
  const viewport = useViewport();
  const isMobile = viewport === "mobile";
  // Force narrow viewports off dual/bottom (would crush main content); mobile forced to centre.
  const effectiveMode =
    viewport === "mobile"
      ? "centre"
      : viewport === "narrow" && (paneState.mode === "dual" || paneState.mode === "bottom")
        ? "left"
        : paneState.mode;
  const flags = paneFlags(effectiveMode);
  const sizes = getModeSizes(paneState, effectiveMode, viewport);
  const bounds = SIZE_BOUNDS[viewport];
  const [dragging, setDragging] = useState(false);
  // Keyboard-driven resizing flag — debounced off after the last arrow keystroke.
  const [kbResizing, setKbResizing] = useState(false);
  const kbTimerRef = useRef<number | null>(null);
  // Snapshots locked at the start of an interaction (drag or keyboard burst).
  // We pin viewport+mode here so a viewport transition mid-drag (window resize,
  // route change) can't redirect the persisted size into the wrong bucket and
  // can't overwrite the mode the user had selected before they started dragging.
  const modeAtDragStartRef = useRef<typeof paneState.mode | null>(null);
  const viewportAtDragStartRef = useRef<typeof viewport | null>(null);
  const effectiveModeAtDragStartRef = useRef<typeof effectiveMode | null>(null);
  // Session-only resize history (not persisted across reloads).
  const [history, setHistory] = useState<ResizeHistoryEntry[]>([]);
  const sizesAtInteractionStartRef = useRef<{ rightWidth: number; bottomHeight: number } | null>(null);
  /** Returns the (viewport, effectiveMode) pair that writes/clamps should use:
   *  the snapshot from the start of the interaction if one is active, otherwise
   *  the live values. */
  const interactionTarget = (): { vp: typeof viewport; em: typeof effectiveMode } => ({
    vp: viewportAtDragStartRef.current ?? viewport,
    em: effectiveModeAtDragStartRef.current ?? effectiveMode,
  });
  const commitHistory = (before: { rightWidth: number; bottomHeight: number }) => {
    const { vp, em } = interactionTarget();
    const after = getModeSizes(paneState, em, vp);
    const f = paneFlags(em);
    const entries: ResizeHistoryEntry[] = [];
    if (f.right && before.rightWidth !== after.rightWidth) {
      entries.push({
        id: `${Date.now()}-r`,
        ts: Date.now(),
        viewport: vp,
        mode: em,
        axis: "right",
        before: before.rightWidth,
        after: after.rightWidth,
      });
    }
    if (f.bottom && before.bottomHeight !== after.bottomHeight) {
      entries.push({
        id: `${Date.now()}-b`,
        ts: Date.now(),
        viewport: vp,
        mode: em,
        axis: "bottom",
        before: before.bottomHeight,
        after: after.bottomHeight,
      });
    }
    if (entries.length) setHistory((h) => [...entries, ...h].slice(0, 20));
  };
  const handleDragging = (d: boolean) => {
    if (d) {
      modeAtDragStartRef.current = paneState.mode;
      viewportAtDragStartRef.current = viewport;
      effectiveModeAtDragStartRef.current = effectiveMode;
      sizesAtInteractionStartRef.current = getModeSizes(paneState, effectiveMode, viewport);
    } else {
      const modeSnap = modeAtDragStartRef.current;
      const { vp, em } = interactionTarget();
      modeAtDragStartRef.current = null;
      viewportAtDragStartRef.current = null;
      effectiveModeAtDragStartRef.current = null;
      // Restore the user-selected mode if anything (incl. a viewport transition
      // that downgraded dual/bottom to left) changed it during the drag.
      if (modeSnap && modeSnap !== paneState.mode) {
        setPaneState({ mode: modeSnap });
      }
      // Final clamp pass against the snapshot bucket — never the live one,
      // which may have been swapped out by a viewport change mid-drag.
      if (hasModeSizeOverrides(paneState, em, vp)) {
        const current = getModeSizes(paneState, em, vp);
        setPaneState((prev) => withModeSize(prev, em, current, vp));
      }
      const before = sizesAtInteractionStartRef.current;
      sizesAtInteractionStartRef.current = null;
      if (before) commitHistory(before);
    }
    setDragging(d);
  };

  // PanelResizeHandle natively handles ArrowLeft/Right/Up/Down (and Home/End)
  // when focused. We piggy-back on the keydown to flip the same "interaction
  // locked" indicator that drag uses.
  const handleResizeKeyDown: React.KeyboardEventHandler<keyof HTMLElementTagNameMap> = (e) => {
    if (
      e.key === "ArrowLeft" ||
      e.key === "ArrowRight" ||
      e.key === "ArrowUp" ||
      e.key === "ArrowDown" ||
      e.key === "Home" ||
      e.key === "End"
    ) {
      if (!sizesAtInteractionStartRef.current) {
        sizesAtInteractionStartRef.current = getModeSizes(paneState, effectiveMode, viewport);
        viewportAtDragStartRef.current = viewport;
        effectiveModeAtDragStartRef.current = effectiveMode;
        modeAtDragStartRef.current = paneState.mode;
      }
      setKbResizing(true);
      if (kbTimerRef.current) window.clearTimeout(kbTimerRef.current);
      kbTimerRef.current = window.setTimeout(() => {
        setKbResizing(false);
        const before = sizesAtInteractionStartRef.current;
        sizesAtInteractionStartRef.current = null;
        if (before) commitHistory(before);
        viewportAtDragStartRef.current = null;
        effectiveModeAtDragStartRef.current = null;
        modeAtDragStartRef.current = null;
      }, 400);
    }
  };
  useEffect(() => () => {
    if (kbTimerRef.current) window.clearTimeout(kbTimerRef.current);
  }, []);
  const interacting = dragging || kbResizing;

  const undoHistory = (entry: ResizeHistoryEntry) => {
    const patch = entry.axis === "right"
      ? { rightWidth: entry.before }
      : { bottomHeight: entry.before };
    setPaneState((prev) => withModeSize(prev, entry.mode, patch, entry.viewport));
    setHistory((h) => h.filter((x) => x.id !== entry.id));
  };

  const signOut = async () => {
    await supabase.auth.signOut();
    navigate("/auth");
  };

  useEffect(() => {
    const channel = supabase
      .channel("approval_queue_decisions")
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "approval_queue" },
        (payload) => {
          const next = payload.new as { id: string; status: string; activity?: string; decided_by?: string };
          const prev = payload.old as { status: string };
          if (prev?.status === next?.status) return;
          if (next.status !== "approved" && next.status !== "rejected") return;
          const dedupeKey = `${next.id}:${next.status}`;
          if (toastedDecisions.has(dedupeKey)) return;
          toastedDecisions.add(dedupeKey);
          const action = { label: "View", onClick: () => navigate(`/approvals/${next.id}`) };
          const opts = {
            id: dedupeKey,
            description: `${next.activity ?? "request"} • by ${next.decided_by ?? "operator"} • ${next.id.slice(0, 8)}`,
            action,
          };
          if (next.status === "approved") toast.success("Approval approved", opts);
          else toast.error("Approval rejected", opts);
        },
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [navigate]);

  return (
    <SidebarProvider open={flags.left} onOpenChange={(o) => setPaneState({ mode: o ? "left" : "centre" })}>
      <div className="min-h-screen flex w-full bg-background">
        <AppSidebar collapsible={effectiveMode === "centre" ? "offcanvas" : "icon"} />
        <div className="flex-1 flex flex-col min-w-0">
          <header
            aria-busy={interacting}
            className={`h-12 flex items-center border-b border-border px-3 gap-3 sticky top-0 bg-background z-10 transition-opacity ${
              interacting ? "pointer-events-none select-none opacity-90" : ""
            }`}
          >
            {/* Screen-reader-only summary of pane controls; updates whenever
                a resize interaction is in progress. */}
            <p className="sr-only" aria-live="polite">
              Pane layout controls. Use Control or Command plus 1 through 4 to
              switch pane mode. Tab to a resize handle, then arrow keys to
              resize, or Home and End for min and max. Drag the handles with
              the mouse to resize.
              {interacting
                ? " Pane mode switching is currently locked while you resize panels."
                : ""}
            </p>
            <TooltipProvider delayDuration={200}>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Link
                    to={tenantsPath}
                    aria-current={isOnTenants ? "page" : undefined}
                    aria-label={tenantsAria}
                    className={`inline-flex h-8 shrink-0 items-center rounded px-2 font-semibold text-sm leading-none transition-colors ${
                      isOnTenants
                        ? "bg-primary/10 text-primary ring-1 ring-inset ring-primary/30"
                        : "text-foreground hover:text-primary"
                    }`}
                  >
                    {brand}
                  </Link>
                </TooltipTrigger>
                <TooltipContent side="bottom" className="text-xs">
                  <div>{tenantsTooltip}</div>
                  {isOnTenants && (
                    <div className="mt-0.5 text-[10px] text-muted-foreground">
                      {t("nav.currentPage")}
                    </div>
                  )}
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
            {!isMobile && <PaneKeyboardHelp />}
            {!isMobile && (
              <PaneToggleGroup
                disabled={interacting}
                mode={effectiveMode}
                onChange={(m) => {
                  // Toggles are disabled while dragging; ignore any change that
                  // still slips through and skip no-op selections.
                  if (interacting) return;
                  if (m === effectiveMode) return;
                  if (m === "centre") {
                    if (paneState.mode === "centre") {
                      setPaneState({ mode: paneState.lastNonCentre });
                    } else {
                      setPaneState({ mode: "centre", lastNonCentre: paneState.mode as Exclude<typeof paneState.mode, "centre"> });
                    }
                  } else {
                    setPaneState({ mode: m, lastNonCentre: m });
                  }
                }}
              />
            )}
            {interacting && (
              <span
                role="status"
                aria-live="polite"
                className="inline-flex items-center gap-1.5 rounded border border-amber-500/40 bg-amber-500/10 px-2 py-0.5 text-[11px] font-medium text-amber-600 dark:text-amber-400"
              >
                <span className="h-1.5 w-1.5 rounded-full bg-amber-500 animate-pulse" />
                Resizing panels… switching locked
              </span>
            )}
            {!isMobile && (flags.right || flags.bottom) && hasModeSizeOverrides(paneState, effectiveMode, viewport) && (
              <TooltipProvider delayDuration={200}>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7"
                      onClick={() => {
                        setPaneState(clearModeSizes(paneState, effectiveMode, viewport));
                        toast.success("Pane sizes reset", {
                          description: `Restored defaults for ${effectiveMode} on this route (${viewport}).`,
                        });
                      }}
                      aria-label="Reset pane sizes"
                    >
                      <RotateCcw className="h-3.5 w-3.5" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent side="bottom" className="text-xs">
                    Reset pane sizes for {effectiveMode}
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            )}
            {!isMobile && hasViewportSizeOverrides(paneState, viewport) && (
              <TooltipProvider delayDuration={200}>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7"
                      onClick={() => {
                        setPaneState(clearViewportSizes(paneState, viewport));
                        toast.success("Pane sizes reset", {
                          description: `Cleared all saved sizes for ${viewport} screens on this route.`,
                        });
                      }}
                      aria-label={`Reset sizes for ${viewport} screens`}
                    >
                      <Monitor className="h-3.5 w-3.5" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent side="bottom" className="text-xs">
                    Reset sizes for this screen ({viewport})
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            )}
            {!isMobile && (
              <TooltipProvider delayDuration={200}>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7"
                      onClick={() => {
                        setPaneState({
                          mode: "left",
                          lastNonCentre: "left",
                          sizesByMode: undefined,
                          sizesByViewportMode: {},
                          sourcesByViewportSlot: {},
                        });
                        toast.success("Layout reset", {
                          description: "Pane mode and all saved sizes restored to defaults for this route.",
                        });
                      }}
                      aria-label="Reset layout to default for this route"
                    >
                      <RefreshCw className="h-3.5 w-3.5" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent side="bottom" className="text-xs">
                    Reset pane mode and sizes to default for this route
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            )}
            {!isMobile && (
              <ResizeHistoryPanel
                entries={history}
                onUndo={undoHistory}
                onClear={() => setHistory([])}
              />
            )}
            {!isMobile && (
              <TooltipProvider delayDuration={200}>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span
                      className="inline-flex items-center gap-1.5 rounded border border-border bg-muted/30 px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground"
                      aria-label={`Active pane layout: ${effectiveMode}`}
                    >
                      <span className="text-foreground">{effectiveMode}</span>
                      {flags.right && <span>R {sizes.rightWidth}%</span>}
                      {flags.bottom && <span>B {sizes.bottomHeight}%</span>}
                      {hasModeSizeOverrides(paneState, effectiveMode, viewport) && (
                        <span className="text-amber-500" title="Custom sizes saved">●</span>
                      )}
                    </span>
                  </TooltipTrigger>
                  <TooltipContent side="bottom" className="text-xs">
                    Layout stored for this route ({hasModeSizeOverrides(paneState, effectiveMode, viewport) ? "custom sizes" : "default sizes"})
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            )}
            <div className="ml-auto flex items-center gap-2">
              <UtcClock />
              <PendingApprovalsIndicator />
              <Button variant="ghost" size="sm" onClick={signOut}>Sign out</Button>
            </div>
          </header>
          <div className="flex-1 min-h-0">
            <ResizablePanelGroup
              key={`h-${viewport}-${effectiveMode}`}
              direction="horizontal"
              className="h-full animate-fade-in"
            >
              <ResizablePanel defaultSize={flags.right ? 100 - sizes.rightWidth : 100} minSize={40}>
                <ResizablePanelGroup
                  key={`v-${viewport}-${effectiveMode}`}
                  direction="vertical"
                  className="h-full animate-fade-in"
                >
                  <ResizablePanel defaultSize={flags.bottom ? 100 - sizes.bottomHeight : 100} minSize={30}>
                    <main className="h-full overflow-y-auto px-6 py-6">
                      <div className="max-w-[1600px] w-full mx-auto">
                        <Outlet />
                      </div>
                    </main>
                  </ResizablePanel>
                  {flags.bottom && (
                    <>
                      <TooltipProvider delayDuration={400}>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <ResizableHandle
                              withHandle
                              onDragging={handleDragging}
                              onKeyDown={handleResizeKeyDown}
                              aria-label="Drag or use arrow keys to resize bottom pane. Pane switching is locked while resizing."
                              className={interacting ? "opacity-40 transition-opacity" : "transition-opacity"}
                            />
                          </TooltipTrigger>
                          <TooltipContent side="top" className="text-xs">
                            Drag or arrow keys to resize · switching locked while resizing
                          </TooltipContent>
                        </Tooltip>
                      </TooltipProvider>
                      <ResizablePanel
                        defaultSize={sizes.bottomHeight}
                        minSize={bounds.bottom.min}
                        maxSize={bounds.bottom.max}
                        onResize={(size) =>
                          { const { vp, em } = interactionTarget(); setPaneState((prev) => withModeSize(prev, em, { bottomHeight: Math.round(size) }, vp)); }
                        }
                      >
                        <div className="relative h-full">
                          {interacting && (
                            <span
                              role="status"
                              aria-live="polite"
                              className="pointer-events-none absolute left-1/2 top-1 z-20 -translate-x-1/2 rounded border border-amber-500/40 bg-background/95 px-1.5 py-0.5 font-mono text-[10px] text-amber-600 shadow-sm dark:text-amber-400"
                            >
                              B {sizes.bottomHeight}%
                            </span>
                          )}
                          <PaneSlot slot="bottom" viewport={viewport} />
                        </div>
                      </ResizablePanel>
                    </>
                  )}
                </ResizablePanelGroup>
              </ResizablePanel>
              {flags.right && (
                <>
                  <TooltipProvider delayDuration={400}>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <ResizableHandle
                          withHandle
                          onDragging={handleDragging}
                          onKeyDown={handleResizeKeyDown}
                          aria-label="Drag or use arrow keys to resize right pane. Pane switching is locked while resizing."
                          className={interacting ? "opacity-40 transition-opacity" : "transition-opacity"}
                        />
                      </TooltipTrigger>
                      <TooltipContent side="left" className="text-xs">
                        Drag or arrow keys to resize · switching locked while resizing
                      </TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                  <ResizablePanel
                    defaultSize={sizes.rightWidth}
                    minSize={bounds.right.min}
                    maxSize={bounds.right.max}
                    onResize={(size) =>
                      { const { vp, em } = interactionTarget(); setPaneState((prev) => withModeSize(prev, em, { rightWidth: Math.round(size) }, vp)); }
                    }
                  >
                    <div className="relative h-full">
                      {interacting && (
                        <span
                          role="status"
                          aria-live="polite"
                          className="pointer-events-none absolute left-1 top-2 z-20 rounded border border-amber-500/40 bg-background/95 px-1.5 py-0.5 font-mono text-[10px] text-amber-600 shadow-sm dark:text-amber-400"
                        >
                          R {sizes.rightWidth}%
                        </span>
                      )}
                      <PaneSlot slot="right" viewport={viewport} />
                    </div>
                  </ResizablePanel>
                </>
              )}
            </ResizablePanelGroup>
          </div>
        </div>
      </div>
    </SidebarProvider>
  );
};

export default OperatorLayout;
