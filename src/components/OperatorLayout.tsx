import { useEffect } from "react";
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
import { paneFlags, usePaneState } from "@/lib/pane-state";
import { RightPaneNightAgent } from "@/components/panes/RightPaneNightAgent";
import { BottomPaneEventTicker } from "@/components/panes/BottomPaneEventTicker";
import { useIsMobile } from "@/hooks/use-mobile";

const toastedDecisions = new Set<string>();

const OperatorLayout = () => {
  const navigate = useNavigate();
  const [paneState, setPaneState] = usePaneState();
  const isMobile = useIsMobile();
  const effectiveMode = isMobile ? "centre" : paneState.mode;
  const flags = paneFlags(effectiveMode);

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
          <header className="h-12 flex items-center border-b border-border px-3 gap-3 sticky top-0 bg-background z-10">
            <PaneToggleGroup
              mode={effectiveMode}
              onChange={(m) => {
                if (m === "centre") {
                  // Toggle: re-clicking centre returns to last non-centre mode.
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
            <Link to="/tenants" className="font-semibold text-sm">AWIP Core</Link>
            <div className="ml-auto flex items-center gap-2">
              <PendingApprovalsIndicator />
              <Button variant="ghost" size="sm" onClick={signOut}>Sign out</Button>
            </div>
          </header>
          <div className="flex-1 min-h-0">
            <ResizablePanelGroup
              key={`h-${effectiveMode}`}
              direction="horizontal"
              className="h-full"
            >
              <ResizablePanel defaultSize={flags.right ? 100 - paneState.rightWidth : 100} minSize={40}>
                <ResizablePanelGroup
                  key={`v-${effectiveMode}`}
                  direction="vertical"
                  className="h-full"
                >
                  <ResizablePanel defaultSize={flags.bottom ? 100 - paneState.bottomHeight : 100} minSize={30}>
                    <main className="h-full overflow-y-auto px-6 py-6">
                      <div className="max-w-[1600px] w-full mx-auto">
                        <Outlet />
                      </div>
                    </main>
                  </ResizablePanel>
                  {flags.bottom && (
                    <>
                      <ResizableHandle withHandle />
                      <ResizablePanel
                        defaultSize={paneState.bottomHeight}
                        minSize={15}
                        maxSize={60}
                        onResize={(size) => setPaneState({ bottomHeight: Math.round(size) })}
                      >
                        <BottomPaneEventTicker />
                      </ResizablePanel>
                    </>
                  )}
                </ResizablePanelGroup>
              </ResizablePanel>
              {flags.right && (
                <>
                  <ResizableHandle withHandle />
                  <ResizablePanel
                    defaultSize={paneState.rightWidth}
                    minSize={15}
                    maxSize={40}
                    onResize={(size) => setPaneState({ rightWidth: Math.round(size) })}
                  >
                    <RightPaneNightAgent />
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
