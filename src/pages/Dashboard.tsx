import { useState } from "react";
import { Settings2 } from "lucide-react";
import { toast } from "sonner";
import { useDashboardConfig } from "@/hooks/useDashboardConfig";
import { DashboardTabs } from "@/components/dashboard/DashboardTabs";
import { BentoGrid } from "@/components/dashboard/BentoGrid";
import type { TemplateId } from "@/components/dashboard/widgets/types";
import { TEMPLATES } from "@/components/dashboard/templates";

export default function Dashboard() {
  const dash = useDashboardConfig();
  const [editing, setEditing] = useState(false);
  const [pendingTemplate, setPendingTemplate] = useState<{ tabId: string; template: TemplateId } | null>(null);

  if (!dash.loaded) {
    return <div className="p-6 text-sm text-muted-foreground">Loading dashboard…</div>;
  }
  if (!dash.config) {
    return <div className="p-6 text-sm text-muted-foreground">Sign in to use the dashboard.</div>;
  }
  const { tabs, activeTabId } = dash.config;
  const activeTab = tabs.find((t) => t.id === activeTabId) ?? tabs[0];

  const handleTemplateChange = (tabId: string, template: TemplateId) => {
    const tab = tabs.find((t) => t.id === tabId);
    if (!tab) return;
    const newSlotCount = TEMPLATES[template].slots.length;
    const oldFilled = tab.widgets.filter(Boolean).length;
    const willDrop = oldFilled > newSlotCount;
    if (willDrop) {
      setPendingTemplate({ tabId, template });
    } else {
      dash.setTemplate(tabId, template);
    }
  };

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center justify-between border-b border-border px-4 py-3">
        <div>
          <h1 className="text-lg font-semibold">Dashboard</h1>
          <p className="text-xs text-muted-foreground">
            Your operator landing — up to {dash.MAX_TABS} tabs, persisted across sessions.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setEditing((v) => !v)}
          className={`inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm transition ${
            editing
              ? "border-primary bg-primary text-primary-foreground"
              : "border-border text-foreground hover:bg-accent"
          }`}
        >
          <Settings2 className="h-3.5 w-3.5" />
          {editing ? "Done" : "Edit"}
        </button>
      </header>

      <DashboardTabs
        tabs={tabs}
        activeTabId={activeTab?.id ?? null}
        maxTabs={dash.MAX_TABS}
        editing={editing}
        onSelect={dash.setActiveTab}
        onAdd={() => {
          if (tabs.length >= dash.MAX_TABS) {
            toast.error(`Max ${dash.MAX_TABS} tabs`);
            return;
          }
          dash.addTab(`Tab ${tabs.length + 1}`);
          setEditing(true);
        }}
        onRename={dash.renameTab}
        onDelete={(id) => {
          if (tabs.length <= 1) {
            toast.error("Cannot delete the last tab");
            return;
          }
          dash.deleteTab(id);
        }}
        onReorder={dash.reorderTab}
        onTemplateChange={handleTemplateChange}
      />

      <main className="flex-1 overflow-auto p-4">
        {activeTab && (
          <BentoGrid
            tab={activeTab}
            editing={editing}
            newId={dash.newWidgetId}
            onAdd={(slotIndex, widget) => dash.setSlotWidget(activeTab.id, slotIndex, widget)}
            onRemove={(slotIndex) => dash.setSlotWidget(activeTab.id, slotIndex, null)}
            onSwap={(from, to) => dash.swapSlots(activeTab.id, from, to)}
          />
        )}
      </main>

      {pendingTemplate && (
        <div
          role="dialog"
          className="fixed inset-0 z-50 flex items-center justify-center bg-background/60 p-4"
          onClick={() => setPendingTemplate(null)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-sm rounded-lg border border-border bg-card p-4 shadow-xl"
          >
            <h2 className="text-sm font-semibold">Change layout?</h2>
            <p className="mt-1 text-xs text-muted-foreground">
              The new layout has fewer slots. Some widgets will be dropped.
            </p>
            <div className="mt-3 flex justify-end gap-2">
              <button
                onClick={() => setPendingTemplate(null)}
                className="rounded border border-border px-3 py-1 text-sm hover:bg-accent"
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  dash.setTemplate(pendingTemplate.tabId, pendingTemplate.template);
                  setPendingTemplate(null);
                }}
                className="rounded bg-primary px-3 py-1 text-sm text-primary-foreground hover:opacity-90"
              >
                Change
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
