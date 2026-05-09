export type WidgetKind =
  | "pending-approvals"
  | "night-observations-24h"
  | "open-risks"
  | "recent-capability-events"
  | "ai-usage-14d"
  | "ai-vs-human-cost";

export type WidgetSize = "sm" | "md" | "lg";

export interface DashboardWidgetProps {
  size: WidgetSize;
  onOpen?: () => void;
}

export type Widget = {
  id: string;
  kind: WidgetKind;
  props?: Record<string, unknown>;
};

export type TemplateId = "grid-2x2" | "one-plus-three" | "hero-strip" | "dense-six";

export type TemplateSlot = { size: WidgetSize; className: string };

export type Tab = {
  id: string;
  name: string;
  template: TemplateId;
  widgets: (Widget | null)[];
};

export type DashboardConfig = {
  tabs: Tab[];
  activeTabId: string | null;
};
