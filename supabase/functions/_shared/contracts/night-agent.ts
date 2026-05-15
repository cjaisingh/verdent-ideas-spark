// Typed contract for the Night Agent's per-action input packet.
// Source of truth for what the agent is guaranteed to receive when it audits
// one eligible discussion_action during a night shift.
//
// See docs/agents/contract-checklist.md for the rules behind this shape.
//
// Status: v0 — types + canonical question only. The /open loop in
// `night-agent/open.ts` constructs a `NightAgentInput` per iteration as a
// typed snapshot of what classification logic already sees. Future slices
// (recentEvents, linkedFindings, truthProfile) get filled in incrementally
// without changing call sites.

export type NightAgentRisk = "low" | "med" | "high";

export type NightAgentInput = {
  /** The discussion_action row being audited. */
  action: {
    id: string;
    short_num: number | null;
    title: string;
    details: string | null;
    priority: string;
    status: string;
    night_eligible: boolean | null;
    promoted_task_id: string | null;
  };
  /** Output of `classifyJob` — kept on the packet so downstream sees the same
   *  verdict the gate used. `critical` never reaches here (trigger-blocked). */
  risk: NightAgentRisk;
  riskReason: string;
  /** Required when the source row had `risk='high'`; null otherwise. */
  nightOverrideReason: string | null;

  // ---- v1 fields (not yet populated; declared so call sites lock the shape)
  /** Last 20 events from `discussion_action_events` for this action. */
  recentEvents?: Array<{ event_type: string; created_at: string; from?: string | null; to?: string | null }>;
  /** Findings linked via `discussion_action_findings`. */
  linkedFindings?: Array<{ id: string; severity: string; status: string; summary: string }>;
  /** Snapshot of `decision_authorities` rules for entity='Action'. */
  truthProfile?: {
    entity: "Action";
    authorities: Array<{ source: string; precedence: number; weight: number; override_policy: string }>;
  };
};

export type NightAgentOutput =
  | { verdict: "advance"; toStatus: string; rationale: string }
  | { verdict: "hold"; reason: string }
  | { verdict: "escalate"; reason: string; suggestedOwner?: string };

export const NIGHT_AGENT_CONTRACT = {
  canonicalQuestion:
    "Should this night-eligible discussion_action advance, hold, or escalate?",
  mandatoryEvidence: ["action", "risk"] as const,
  optionalEvidence: ["recentEvents", "linkedFindings", "truthProfile"] as const,
  escalationRule:
    "Escalate if risk=high AND no nightOverrideReason, OR if any linked finding has severity>=high and status=open.",
  auditTable: "discussion_action_events",
  truthEntity: "Action",
} as const;

/**
 * Build a `NightAgentInput` from data already in scope at the top of the
 * /open per-job loop. Pure function, no DB I/O — keeps the shadow packet
 * cost-free. v1 helpers will hydrate the optional fields from the SbClient.
 */
export function buildNightAgentInput(
  job: NightAgentInput["action"] & Record<string, unknown>,
  classification: { risk: NightAgentRisk; reason: string },
  nightOverrideReason: string | null = null,
): NightAgentInput {
  return {
    action: {
      id: job.id,
      short_num: job.short_num,
      title: job.title,
      details: job.details,
      priority: job.priority,
      status: job.status,
      night_eligible: job.night_eligible,
      promoted_task_id: job.promoted_task_id,
    },
    risk: classification.risk,
    riskReason: classification.reason,
    nightOverrideReason,
  };
}
