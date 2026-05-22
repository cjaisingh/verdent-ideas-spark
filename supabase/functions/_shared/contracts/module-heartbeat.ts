// Typed contract for POST /modules/heartbeat.
// Liveness ping from a module project. Volume is high; rows go to module_heartbeats (not capability_events).

export type HeartbeatInput = {
  owning_module: string;
  version?: string | null;
  capability_ids?: string[];          // which capabilities the module currently exposes
  emitted_at?: string;                // ISO timestamp from the sender (clock-skew tolerant; not trusted)
  payload?: Record<string, unknown>;  // optional extras (uptime, build hash, etc)
};

export function validateHeartbeatInput(raw: unknown): { ok: true; value: HeartbeatInput } | { ok: false; error: string } {
  if (!raw || typeof raw !== "object") return { ok: false, error: "body must be an object" };
  const b = raw as Record<string, unknown>;
  if (typeof b.owning_module !== "string" || b.owning_module.length < 1) return { ok: false, error: "owning_module required" };
  if (b.version !== undefined && b.version !== null && typeof b.version !== "string") return { ok: false, error: "version must be string" };
  if (b.capability_ids !== undefined) {
    if (!Array.isArray(b.capability_ids) || b.capability_ids.some((x) => typeof x !== "string")) {
      return { ok: false, error: "capability_ids must be string[]" };
    }
  }
  if (b.emitted_at !== undefined) {
    if (typeof b.emitted_at !== "string" || Number.isNaN(Date.parse(b.emitted_at))) {
      return { ok: false, error: "emitted_at must be ISO date string" };
    }
    if (new Date(b.emitted_at).getTime() > Date.now() + 5 * 60_000) {
      return { ok: false, error: "emitted_at is in the future" };
    }
  }
  return {
    ok: true,
    value: {
      owning_module: b.owning_module,
      version: (b.version as string | null | undefined) ?? null,
      capability_ids: Array.isArray(b.capability_ids) ? b.capability_ids as string[] : [],
      emitted_at: (b.emitted_at as string | undefined) ?? new Date().toISOString(),
      payload: (b.payload && typeof b.payload === "object") ? b.payload as Record<string, unknown> : {},
    },
  };
}

export const HEARTBEAT_CONTRACT = {
  canonicalQuestion: "Is this module still alive and what capabilities is it currently serving?",
  mandatoryEvidence: ["owning_module"] as const,
  optionalEvidence: ["version", "capability_ids", "emitted_at", "payload"] as const,
  escalationRule: "Sentinel fires module_silent_24h when last_heartbeat older than 24h for any module with ≥1 registered capability.",
  auditTable: "module_heartbeats",
  truthEntity: "Module",
} as const;
