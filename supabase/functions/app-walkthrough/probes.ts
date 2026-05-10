// Static route probes for the nightly walkthrough.
// Edge-function probes hit awip-api endpoints and a handful of edge functions
// that expose a benign GET surface. UI route probes hit the published preview
// SPA shell to confirm the bundle still serves.

export type RouteProbe = {
  /** Human-readable label and dedupe target for sentinel findings. */
  target: string;
  /** Either an absolute URL or a path relative to the supabase functions root. */
  path: string;
  method?: "GET" | "HEAD";
  /** Functions that require the operator service token. */
  auth?: "service" | "none";
  /** HTTP statuses that count as a pass. Defaults to [200]. */
  expectStatus?: number[];
  /** Maximum acceptable latency in ms. Defaults to 8000. */
  maxMs?: number;
  severity?: "info" | "low" | "medium" | "high" | "critical";
};

/** awip-api surface — these are the contract endpoints other surfaces depend on. */
export const AWIP_API_PROBES: RouteProbe[] = [
  { target: "awip-api:/health", path: "/awip-api/health", auth: "none", severity: "high" },
  { target: "awip-api:/okrs", path: "/awip-api/okrs", auth: "service", severity: "high" },
  { target: "awip-api:/capabilities", path: "/awip-api/capabilities", auth: "service", severity: "high" },
  { target: "awip-api:/events", path: "/awip-api/events?limit=1", auth: "service", severity: "medium" },
];

/** Edge functions that should respond to a benign GET / OPTIONS. */
export const EDGE_FN_PROBES: RouteProbe[] = [
  { target: "edge:morning-review", path: "/morning-review", method: "GET", auth: "service", severity: "medium",
    expectStatus: [200, 405] },
  { target: "edge:sentinel-tick", path: "/sentinel-tick", method: "OPTIONS", auth: "none", severity: "medium",
    expectStatus: [200, 204] },
  { target: "edge:deep-audit", path: "/deep-audit", method: "OPTIONS", auth: "none", severity: "medium",
    expectStatus: [200, 204] },
  { target: "edge:awip-rag", path: "/awip-rag", method: "OPTIONS", auth: "none", severity: "low",
    expectStatus: [200, 204] },
  { target: "edge:gemini-tts", path: "/gemini-tts", method: "OPTIONS", auth: "none", severity: "low",
    expectStatus: [200, 204] },
];

/** Public UI routes — assert the SPA shell still serves. */
export function uiRouteProbes(previewOrigin: string): RouteProbe[] {
  if (!previewOrigin) return [];
  const routes = ["/", "/auth", "/roadmap", "/overnight", "/morning-review", "/audits", "/companion"];
  return routes.map((r) => ({
    target: `ui:${r}`,
    path: `${previewOrigin.replace(/\/$/, "")}${r}`,
    method: "GET",
    auth: "none",
    severity: "low",
    expectStatus: [200],
    maxMs: 10_000,
  }));
}
