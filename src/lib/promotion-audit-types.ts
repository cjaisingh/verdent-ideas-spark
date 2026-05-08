// Mirror of supabase/functions/awip-api/promotion_audit.ts response shape.

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

export type CandidateSnapshot = {
  short_num: number | null;
  title: string;
  risk?: string;
  phase?: string;
  suite?: string;
};

export type SkippedCandidate = CandidateSnapshot & { reason: string };

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

export type AfterBlock = {
  decision: "accepted" | "rejected" | "pending";
  decided_at: string | null;
  decided_by: string | null;
  audit_complete: {
    worst_severity: string;
    qa_passed: boolean;
    steps: number;
  } | null;
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

export type PromotionAuditListResponse = {
  reports: PromotionAuditReport[];
};
