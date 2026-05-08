import type { LucideIcon } from "lucide-react";
import { Moon, Activity, BellRing, MessageSquare } from "lucide-react";
import { lazy, type LazyExoticComponent, type ComponentType } from "react";

export type PaneSourceId = "night-agent" | "event-ticker" | "approvals" | "discussion-actions";

export interface PaneSource {
  id: PaneSourceId;
  label: string;
  shortLabel: string;
  icon: LucideIcon;
  /** Tailwind text color class (semantic tint). */
  tintClass: string;
  /** Tailwind bg color class at low alpha for the icon chip. */
  tintBgClass: string;
  /** Canonical "open full view" route. */
  openHref: string;
  /** Body-only component (no header — `PaneHeader` provides one). */
  Body: LazyExoticComponent<ComponentType>;
}

/** Lazy-load each pane body so a source you don't pick doesn't ship its query. */
export const PANE_SOURCES: Record<PaneSourceId, PaneSource> = {
  "night-agent": {
    id: "night-agent",
    label: "Night Agent",
    shortLabel: "Night",
    icon: Moon,
    tintClass: "text-tint-night",
    tintBgClass: "bg-tint-night/15",
    openHref: "/night",
    Body: lazy(() =>
      import("./bodies/NightAgentBody").then((m) => ({ default: m.NightAgentBody })),
    ),
  },
  "event-ticker": {
    id: "event-ticker",
    label: "Event ticker",
    shortLabel: "Events",
    icon: Activity,
    tintClass: "text-tint-event",
    tintBgClass: "bg-tint-event/15",
    openHref: "/events",
    Body: lazy(() =>
      import("./bodies/EventTickerBody").then((m) => ({ default: m.EventTickerBody })),
    ),
  },
  approvals: {
    id: "approvals",
    label: "Pending approvals",
    shortLabel: "Approvals",
    icon: BellRing,
    tintClass: "text-tint-approval",
    tintBgClass: "bg-tint-approval/15",
    openHref: "/admin",
    Body: lazy(() =>
      import("./bodies/ApprovalsBody").then((m) => ({ default: m.ApprovalsBody })),
    ),
  },
  "discussion-actions": {
    id: "discussion-actions",
    label: "Discussion actions",
    shortLabel: "Discussions",
    icon: MessageSquare,
    tintClass: "text-tint-discussion",
    tintBgClass: "bg-tint-discussion/15",
    openHref: "/jobs",
    Body: lazy(() =>
      import("./bodies/DiscussionActionsBody").then((m) => ({
        default: m.DiscussionActionsBody,
      })),
    ),
  },
};

export const PANE_SOURCE_LIST: PaneSource[] = Object.values(PANE_SOURCES);

export function isPaneSourceId(v: unknown): v is PaneSourceId {
  return typeof v === "string" && v in PANE_SOURCES;
}
