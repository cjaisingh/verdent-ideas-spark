import { useEffect, useRef, useState } from "react";
import { Link, Outlet, useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import PendingApprovalsIndicator from "@/components/PendingApprovalsIndicator";
import { SidebarProvider } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/AppSidebar";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable";
import { PaneToggleGroup } from "@/components/PaneToggleGroup";
import { SIZE_BOUNDS, clearModeSizes, clearViewportSizes, getModeSizes, hasModeSizeOverrides, hasViewportSizeOverrides, paneFlags, usePaneState, withModeSize } from "@/lib/pane-state";
import { Monitor, RotateCcw } from "lucide-react";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { RightPaneNightAgent } from "@/components/panes/RightPaneNightAgent";
import { BottomPaneEventTicker } from "@/components/panes/BottomPaneEventTicker";
import { useViewport } from "@/hooks/use-viewport";

const toastedDecisions = new Set<string>();

const OperatorLayout = () => {
  const navigate = useNavigate();
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
  // Snapshot the focus mode at drag start so it can be restored if anything
  // (a stray click, keyboard shortcut, etc.) tried to change it mid-drag.
  const modeAtDragStartRef = useRef<typeof paneState.mode | null>(null);
  const handleDragging = (d: boolean) => {
    if (d) {
      modeAtDragStartRef.current = paneState.mode;
    } else {
      const snapshot = modeAtDragStartRef.current;
      modeAtDragStartRef.current = null;
      if (snapshot && snapshot !== paneState.mode) {
        setPaneState({ mode: snapshot });
      }
      // Final safety pass: re-run the clamp on whatever sizes ended up saved
      // for this viewport+mode so a value can't sit outside the current bounds
      // (e.g. if SIZE_BOUNDS shrank since the last drag). Only re-write if
      // there was already a custom override — don't materialise defaults.
      if (hasModeSizeOverrides(paneState, effectiveMode, viewport)) {
        const current = getModeSizes(paneState, effectiveMode, viewport);
        setPaneState((prev) => withModeSize(prev, effectiveMode, current, viewport));
      }
    }
    setDragging(d);
  };

  // PanelResizeHandle natively handles ArrowLeft/Right/Up/Down (and Home/End)
  // when focused. We piggy-back on the keydown to flip the same "interaction
  // locked" indicator that drag uses.
  const handleResizeKeyDown = (e: React.KeyboardEvent) => {
    if (
      e.key === "ArrowLeft" ||
      e.key === "ArrowRight" ||
      e.key === "ArrowUp" ||
      e.key === "ArrowDown" ||
      e.key === "Home" ||
      e.key === "End"
    ) {
      setKbResizing(true);
      if (kbTimerRef.current) window.clearTimeout(kbTimerRef.current);
      kbTimerRef.current = window.setTimeout(() => setKbResizing(false), 400);
    }
  };
  useEffect(() => () => {
    if (kbTimerRef.current) window.clearTimeout(kbTimerRef.current);
  }, []);
  const interacting = dragging || kbResizing;

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
            aria-busy={dragging}
            className={`h-12 flex items-center border-b border-border px-3 gap-3 sticky top-0 bg-background z-10 transition-opacity ${
              dragging ? "pointer-events-none select-none opacity-90" : ""
            }`}
          >
            {!isMobile && (
              <PaneToggleGroup
                disabled={dragging}
                mode={effectiveMode}
                onChange={(m) => {
                  // Toggles are disabled while dragging; ignore any change that
                  // still slips through and skip no-op selections.
                  if (dragging) return;
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
            {dragging && (
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
                      onClick={() => setPaneState(clearModeSizes(paneState, effectiveMode, viewport))}
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
                      onClick={() => setPaneState(clearViewportSizes(paneState, viewport))}
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
            <Link to="/tenants" className="font-semibold text-sm">AWIP Core</Link>
            <div className="ml-auto flex items-center gap-2">
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
                              aria-label="Drag to resize bottom pane. Pane switching is locked while dragging."
                              className={dragging ? "opacity-40 transition-opacity" : "transition-opacity"}
                            />
                          </TooltipTrigger>
                          <TooltipContent side="top" className="text-xs">
                            Drag to resize · pane switching locked while dragging
                          </TooltipContent>
                        </Tooltip>
                      </TooltipProvider>
                      <ResizablePanel
                        defaultSize={sizes.bottomHeight}
                        minSize={bounds.bottom.min}
                        maxSize={bounds.bottom.max}
                        onResize={(size) =>
                          setPaneState((prev) => withModeSize(prev, effectiveMode, { bottomHeight: Math.round(size) }, viewport))
                        }
                      >
                        <div className="relative h-full">
                          {dragging && (
                            <span
                              role="status"
                              aria-live="polite"
                              className="pointer-events-none absolute left-1/2 top-1 z-20 -translate-x-1/2 rounded border border-amber-500/40 bg-background/95 px-1.5 py-0.5 font-mono text-[10px] text-amber-600 shadow-sm dark:text-amber-400"
                            >
                              B {sizes.bottomHeight}%
                            </span>
                          )}
                          <BottomPaneEventTicker />
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
                          aria-label="Drag to resize right pane. Pane switching is locked while dragging."
                          className={dragging ? "opacity-40 transition-opacity" : "transition-opacity"}
                        />
                      </TooltipTrigger>
                      <TooltipContent side="left" className="text-xs">
                        Drag to resize · pane switching locked while dragging
                      </TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                  <ResizablePanel
                    defaultSize={sizes.rightWidth}
                    minSize={bounds.right.min}
                    maxSize={bounds.right.max}
                    onResize={(size) =>
                      setPaneState((prev) => withModeSize(prev, effectiveMode, { rightWidth: Math.round(size) }, viewport))
                    }
                  >
                    <div className="relative h-full">
                      {dragging && (
                        <span
                          role="status"
                          aria-live="polite"
                          className="pointer-events-none absolute left-1 top-2 z-20 rounded border border-amber-500/40 bg-background/95 px-1.5 py-0.5 font-mono text-[10px] text-amber-600 shadow-sm dark:text-amber-400"
                        >
                          R {sizes.rightWidth}%
                        </span>
                      )}
                      <RightPaneNightAgent />
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
