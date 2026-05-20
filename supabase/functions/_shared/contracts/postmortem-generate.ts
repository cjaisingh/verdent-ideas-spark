// Typed contract for the auto-postmortem generator.
// Triggered daily; for each slipped phase/sprint emits one row in
// public.postmortems with an AI-drafted root cause + timeline + what changed.
// Prose only — no automatic enforcement, no detector creation.
//
// See docs/agents/contract-checklist.md for the rules behind this shape.

export type PostmortemSubjectKind = "phase" | "sprint";

export type PostmortemInput = {
  subject: {
    kind: PostmortemSubjectKind;
    id: string;
    label: string;
    status: string;
    ends_on: string; // YYYY-MM-DD — slip pivot
    days_late: number;
  };
  context: {
    sprintsUnderPhase?: Array<{ id: string; key: string; status: string; ends_on: string | null }>;
    linkedActions?: Array<{ id: string; title: string; status: string; priority: string; created_at: string }>;
    sentinelFindings?: Array<{ id: string; kind: string; severity: string; summary: string; first_seen_at: string }>;
    failedOvernightRuns?: Array<{ id: string; status: string; requested_at: string; finished_at: string | null; error?: string | null }>;
    recentEvents?: Array<{ source: string; event_type: string; created_at: string; payload?: unknown }>;
  };
};

export type PostmortemDraft = {
  root_cause: string;
  contributing_factors: string[];
  timeline: Array<{ at: string; what: string }>;
  what_changed: string;
};

export const POSTMORTEM_CONTRACT = {
  canonicalQuestion:
    "Why did this phase/sprint slip past its planned end date, and what has already changed since the slip?",
  mandatoryEvidence: ["subject"] as const,
  optionalEvidence: [
    "sprintsUnderPhase",
    "linkedActions",
    "sentinelFindings",
    "failedOvernightRuns",
    "recentEvents",
  ] as const,
  outputShape: {
    root_cause: "string — one paragraph naming the dominant cause",
    contributing_factors: "string[] — 0–5 short bullets",
    timeline: "array of {at: ISO, what: short phrase}",
    what_changed: "string — one paragraph on remediation already observable in the data",
  },
} as const;
