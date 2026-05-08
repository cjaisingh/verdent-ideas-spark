// Pure assembly logic for the Night Agent promotion audit report.
// All inputs are plain rows so the assembler is unit-testable without I/O.

export type ShiftRow = {
  id: string;
  started_at: string;
  ended_at: string | null;
  status: string;
  window_start: string;
  window_end: string;
  summary: Record<string, unknown> | null;
};

export type ProposalRow = {
  id: string;
  shift_id: string;
  status: string;
  kind: string;
  rationale: string | null;
  target_ref: Record<string, unknown> | null;
  payload: Record<string, unknown> | null;
  created_at: string;
  decided_at: string | null;
  decided_by: string | null;
};

export type ObservationRow = {
  id: string;
  shift_id: string;
  kind: string;
  severity: string;
  summary: string;
  subject_ref: Record<string, unknown> | null;
  payload: Record<string, unknown> | null;
  created_at: string;
};

export type CandidateSnapshot = {
  short_num: number | null;
  title: string;
  risk?: string;
  phase?: string;
  suite?: string;
};

export type SkippedCandidate = CandidateSnapshot & { reason: string };

export type GatesSnapshot = {
  timezone?: string;
  window?: string;
  local_date?: string;
  local_time?: string;
  enabled?: boolean;
  in_window?: boolean;
  blackout_hit?: boolean;
  allowed_kinds?: string[];
  blackout_dates?: string[];
};

export type BeforeBlock = {
  shift_id: string;
  opened_at: string;
  legacy: boolean;
  gates: GatesSnapshot | null;
  skip_reasons: string[];
  candidates_total: number | null;
  candidates_selected: CandidateSnapshot[];
  candidates_skipped: SkippedCandidate[];
};

export type AuditCompleteBlock = {
  worst_severity: string;
  qa_passed: boolean;
  steps: number;
} | null;

export type AfterBlock = {
  decision: "accepted" | "rejected" | "pending";
  decided_at: string | null;
  decided_by: string | null;
  audit_complete: AuditCompleteBlock;
  observations: Array<{
    kind: string;
    severity: string;
    summary: string;
    created_at: string;
  }>;
};

export type PromotionAuditReport = {
  proposal: {
    id: string;
    shift_id: string;
    status: string;
    kind: string;
    rationale: string | null;
    target_ref: Record<string, unknown> | null;
  };
  before: BeforeBlock;
  after: AfterBlock;
};

function asStringArray(v: unknown): string[] {
  return Array.isArray(v) ? v.map(String) : [];
}

function asCandidates(v: unknown): CandidateSnapshot[] {
  if (!Array.isArray(v)) return [];
  return v.map((x) => {
    const o = (x ?? {}) as Record<string, unknown>;
    return {
      short_num: typeof o.short_num === "number" ? o.short_num : null,
      title: String(o.title ?? ""),
      risk: o.risk ? String(o.risk) : undefined,
      phase: o.phase ? String(o.phase) : undefined,
      suite: o.suite ? String(o.suite) : undefined,
    };
  });
}

function asSkipped(v: unknown): SkippedCandidate[] {
  if (!Array.isArray(v)) return [];
  return v.map((x) => {
    const o = (x ?? {}) as Record<string, unknown>;
    return {
      short_num: typeof o.short_num === "number" ? o.short_num : null,
      title: String(o.title ?? ""),
      reason: String(o.reason ?? ""),
      risk: o.risk ? String(o.risk) : undefined,
      phase: o.phase ? String(o.phase) : undefined,
      suite: o.suite ? String(o.suite) : undefined,
    };
  });
}

export function buildBefore(shift: ShiftRow): BeforeBlock {
  const s = (shift.summary ?? {}) as Record<string, unknown>;
  const gates = (s.gates ?? null) as GatesSnapshot | null;
  const legacy = !gates;
  return {
    shift_id: shift.id,
    opened_at: shift.started_at,
    legacy,
    gates,
    skip_reasons: asStringArray(s.skip_reasons),
    candidates_total:
      typeof s.candidates_total === "number" ? s.candidates_total : null,
    candidates_selected: asCandidates(s.candidates_selected),
    candidates_skipped: asSkipped(s.candidates_skipped),
  };
}

function decisionFor(p: ProposalRow): AfterBlock["decision"] {
  if (p.status === "accepted") return "accepted";
  if (p.status === "rejected") return "rejected";
  return "pending";
}

export function buildAfter(
  proposal: ProposalRow,
  observations: ObservationRow[],
): AfterBlock {
  const targetId = (proposal.target_ref ?? {})["discussion_action_id"];
  const matching = observations.filter((o) => {
    const oid = (o.subject_ref ?? {})["discussion_action_id"];
    return targetId && oid === targetId;
  });
  const completeObs = matching.find((o) => o.summary?.startsWith("audit_complete"));
  let audit_complete: AuditCompleteBlock = null;
  if (completeObs) {
    const p = (completeObs.payload ?? {}) as Record<string, unknown>;
    audit_complete = {
      worst_severity: String(p.worst_severity ?? completeObs.severity ?? "info"),
      qa_passed: Boolean(p.qa_passed),
      steps: typeof p.steps === "number" ? p.steps : 5,
    };
  }
  return {
    decision: decisionFor(proposal),
    decided_at: proposal.decided_at,
    decided_by: proposal.decided_by,
    audit_complete,
    observations: matching.map((o) => ({
      kind: o.kind,
      severity: o.severity,
      summary: o.summary,
      created_at: o.created_at,
    })),
  };
}

export function buildReport(
  proposal: ProposalRow,
  shift: ShiftRow,
  observations: ObservationRow[],
): PromotionAuditReport {
  return {
    proposal: {
      id: proposal.id,
      shift_id: proposal.shift_id,
      status: proposal.status,
      kind: proposal.kind,
      rationale: proposal.rationale,
      target_ref: proposal.target_ref,
    },
    before: buildBefore(shift),
    after: buildAfter(proposal, observations),
  };
}
