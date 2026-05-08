import type { PaneSourceId } from "@/components/panes/sources";

export type PaneSlotKey = "right" | "bottom";

type RouteDefaults = Record<PaneSlotKey, PaneSourceId>;

const FALLBACK: RouteDefaults = { right: "night-agent", bottom: "event-ticker" };

/** Keyed by the first path segment (matches `routeKeyFromPath`). */
const DEFAULTS: Record<string, RouteDefaults> = {
  "/": { right: "night-agent", bottom: "event-ticker" },
  "/dashboard": { right: "night-agent", bottom: "event-ticker" },
  "/roadmap": { right: "approvals", bottom: "event-ticker" },
  "/capabilities": { right: "night-agent", bottom: "event-ticker" },
  "/jobs": { right: "discussion-actions", bottom: "event-ticker" },
  "/copilot": { right: "discussion-actions", bottom: "event-ticker" },
  "/night": { right: "night-agent", bottom: "event-ticker" },
  "/night-shifts": { right: "night-agent", bottom: "event-ticker" },
  "/admin": { right: "approvals", bottom: "event-ticker" },
  "/approvals": { right: "approvals", bottom: "event-ticker" },
  "/control-plane": { right: "night-agent", bottom: "event-ticker" },
};

export function defaultSourceForRoute(routeKey: string, slot: PaneSlotKey): PaneSourceId {
  return (DEFAULTS[routeKey] ?? FALLBACK)[slot];
}
