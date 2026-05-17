// Typed contract for recording an operator credit-balance snapshot.
// No edge function fronts this — inserts go through supabase-js under
// operator-only RLS — but the shape is locked here per the contract-first rule
// so any future automation (telegram bot, edge fn, agent loop) reuses the same
// validation surface.

export type CreditSnapshotSubjectType =
  | "roadmap_phase"
  | "discussion_action"
  | "roadmap_task"
  | "dev_turn"
  | "manual";

export interface CreditSnapshotInput {
  /** Remaining credits as shown in the Lovable workspace credit bar. */
  balance_credits: number;
  /** ISO timestamp; defaults to now() server-side. */
  as_of?: string;
  /** Free-form label: "model picker", "worker checklist", etc. */
  label?: string | null;
  /** What this snapshot is being attributed to. */
  subject_type?: CreditSnapshotSubjectType | null;
  /** Row id of the subject (matches subject_type). */
  subject_id?: string | null;
  /** Phase shortcut (legacy). If set without subject_type, trigger fills in. */
  phase_id?: string | null;
  /** Where the reading was taken (e.g. "Lovable dashboard, 17 May 18:00 UTC"). */
  source?: string | null;
  /** Optional operator note. */
  note?: string | null;
}

export const CREDIT_SNAPSHOT_SUBJECT_TYPES: CreditSnapshotSubjectType[] = [
  "roadmap_phase",
  "discussion_action",
  "roadmap_task",
  "dev_turn",
  "manual",
];

export function validateCreditSnapshot(input: unknown): {
  ok: true;
  value: CreditSnapshotInput;
} | { ok: false; error: string } {
  if (!input || typeof input !== "object") return { ok: false, error: "input must be object" };
  const v = input as Record<string, unknown>;
  const n = Number(v.balance_credits);
  if (!Number.isFinite(n) || n < 0) return { ok: false, error: "balance_credits must be a non-negative number" };
  const st = v.subject_type;
  if (st != null && !CREDIT_SNAPSHOT_SUBJECT_TYPES.includes(st as CreditSnapshotSubjectType)) {
    return { ok: false, error: `subject_type must be one of ${CREDIT_SNAPSHOT_SUBJECT_TYPES.join(",")}` };
  }
  return {
    ok: true,
    value: {
      balance_credits: n,
      as_of: typeof v.as_of === "string" ? v.as_of : undefined,
      label: typeof v.label === "string" ? v.label : null,
      subject_type: (st as CreditSnapshotSubjectType | null | undefined) ?? null,
      subject_id: typeof v.subject_id === "string" ? v.subject_id : null,
      phase_id: typeof v.phase_id === "string" ? v.phase_id : null,
      source: typeof v.source === "string" ? v.source : null,
      note: typeof v.note === "string" ? v.note : null,
    },
  };
}
