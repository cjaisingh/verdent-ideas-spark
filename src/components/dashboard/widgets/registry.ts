import type { ComponentType } from "react";
import { AiUsageWidget } from "./AiUsageWidget";
import { AiVsHumanCostWidget } from "./AiVsHumanCostWidget";
import { NightObservationsWidget } from "./NightObservationsWidget";
import { OpenRisksWidget } from "./OpenRisksWidget";
import { PendingApprovalsWidget } from "./PendingApprovalsWidget";
import { RecentCapabilityEventsWidget } from "./RecentCapabilityEventsWidget";
import type { DashboardWidgetProps, WidgetKind, WidgetSize } from "./types";

export type WidgetEntry = {
  kind: WidgetKind;
  label: string;
  description: string;
  defaultSize: WidgetSize;
  Component: ComponentType<DashboardWidgetProps>;
};

export const WIDGET_REGISTRY: Record<WidgetKind, WidgetEntry> = {
  "pending-approvals": {
    kind: "pending-approvals",
    label: "Pending approvals",
    description: "Live count + recent items from the approval queue.",
    defaultSize: "md",
    Component: PendingApprovalsWidget,
  },
  "night-observations-24h": {
    kind: "night-observations-24h",
    label: "Night observations · 24h",
    description: "What the Night Agent saw in the last 24 hours.",
    defaultSize: "md",
    Component: NightObservationsWidget,
  },
  "open-risks": {
    kind: "open-risks",
    label: "Open risks",
    description: "Unacknowledged review findings, severity-ordered.",
    defaultSize: "md",
    Component: OpenRisksWidget,
  },
  "recent-capability-events": {
    kind: "recent-capability-events",
    label: "Recent capability events",
    description: "Latest entries on the capability events stream.",
    defaultSize: "md",
    Component: RecentCapabilityEventsWidget,
  },
  "ai-usage-14d": {
    kind: "ai-usage-14d",
    label: "AI usage · 14d",
    description: "Per-job model, calls, tokens, and avg latency for scheduled AI calls.",
    defaultSize: "md",
  "ai-usage-14d": {
    kind: "ai-usage-14d",
    label: "AI usage · 14d",
    description: "Per-job model, calls, tokens, and avg latency for scheduled AI calls.",
    defaultSize: "md",
    Component: AiUsageWidget,
  },
  "ai-vs-human-cost": {
    kind: "ai-vs-human-cost",
    label: "AI vs Human cost",
    description: "Per-workstream comparison of AI build + 30d run cost vs equivalent human-hour cost (£).",
    defaultSize: "lg",
    Component: AiVsHumanCostWidget,
  },
};

export const WIDGET_LIST: WidgetEntry[] = Object.values(WIDGET_REGISTRY);
