// Typed contract for the W8.1 Global Scheduling Substrate.
// See docs/scheduler.md and docs/agents/contract-checklist.md.
//
// Owner: awip_core. Consumers: operator UI + any FM module that holds
// a per-module service token (mem://features/module-contracts).

export type ScheduledJobStatus =
  | "pending"
  | "running"
  | "done"
  | "failed"
  | "cancelled"
  | "auto_blocked";

export type ScheduledJobSubjectType = "operator" | "tenant" | "external_contact";

export type SchedulerJobInput = {
  /** Catalog kind, e.g. 'reminder.send', 'report.weekly_digest', 'fm1.stakeholder_pulse'. */
  kind: string;
  /** Owning module — 'awip_core' for built-ins, FM slug otherwise. */
  owning_module: string;
  /** Required when owning_module !== 'awip_core'. */
  tenant_id?: string | null;
  subject_type?: ScheduledJobSubjectType | null;
  subject_id?: string | null;
  payload?: Record<string, unknown>;
  /** Idempotency key, UNIQUE per (owning_module, dedupe_key). */
  dedupe_key: string;
  /** ISO UTC timestamp. */
  run_at: string;
  /** Optional 5-field cron expression. null/undefined = one-shot. */
  recurrence?: string | null;
  max_retries?: number;
};

export type ScheduledJobRow = {
  id: string;
  kind: string;
  owning_module: string;
  tenant_id: string | null;
  subject_type: ScheduledJobSubjectType | null;
  subject_id: string | null;
  payload: Record<string, unknown>;
  dedupe_key: string;
  run_at: string;
  recurrence: string | null;
  status: ScheduledJobStatus;
  attempts: number;
  max_retries: number;
  last_error: string | null;
  result: Record<string, unknown> | null;
};

export type SchedulerHandlerResult =
  | { status: "done"; result?: unknown }
  | { status: "failed"; error: string; retryable: boolean };

export type SchedulerLocalHandler = (
  job: ScheduledJobRow,
) => Promise<SchedulerHandlerResult>;

export const SCHEDULER_CONTRACT = {
  canonicalQuestion:
    "Should this scheduled job run now, succeed, retry, or be sent to the DLQ?",
  mandatoryEvidence: ["kind", "run_at", "dedupe_key", "owning_module"] as const,
  optionalEvidence: ["tenant_id", "subject_type", "subject_id", "recurrence"] as const,
  escalationRule:
    "After max_retries the job moves to status=failed (DLQ). FM jobs without tenant_id are rejected at enqueue time.",
  auditTable: "scheduled_job_events",
  truthEntity: "ScheduledJob",
} as const;

export function validateInput(input: unknown): SchedulerJobInput {
  if (!input || typeof input !== "object") throw new Error("input: expected object");
  const o = input as Record<string, unknown>;
  const need = (k: string) => {
    if (typeof o[k] !== "string" || !o[k]) throw new Error(`input.${k}: required string`);
  };
  need("kind");
  need("owning_module");
  need("dedupe_key");
  need("run_at");
  if (Number.isNaN(Date.parse(String(o.run_at)))) throw new Error("input.run_at: invalid ISO timestamp");
  if (o.recurrence !== undefined && o.recurrence !== null && typeof o.recurrence !== "string") {
    throw new Error("input.recurrence: string or null");
  }
  const owning = String(o.owning_module);
  if (owning !== "awip_core" && !o.tenant_id) {
    throw new Error("input.tenant_id: required when owning_module is not 'awip_core'");
  }
  if (o.subject_type !== undefined && o.subject_type !== null) {
    if (!["operator", "tenant", "external_contact"].includes(String(o.subject_type))) {
      throw new Error("input.subject_type: must be operator|tenant|external_contact");
    }
  }
  const mr = o.max_retries;
  if (mr !== undefined && (typeof mr !== "number" || mr < 0 || mr > 20)) {
    throw new Error("input.max_retries: 0..20");
  }
  return {
    kind: String(o.kind),
    owning_module: owning,
    tenant_id: (o.tenant_id as string | null | undefined) ?? null,
    subject_type: (o.subject_type as ScheduledJobSubjectType | null | undefined) ?? null,
    subject_id: (o.subject_id as string | null | undefined) ?? null,
    payload: (o.payload as Record<string, unknown> | undefined) ?? {},
    dedupe_key: String(o.dedupe_key),
    run_at: String(o.run_at),
    recurrence: (o.recurrence as string | null | undefined) ?? null,
    max_retries: typeof mr === "number" ? mr : 3,
  };
}
