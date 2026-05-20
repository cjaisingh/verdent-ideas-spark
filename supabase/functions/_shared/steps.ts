// Per-step instrumentation for the live platform timeline.
// recordStep wraps an async fn, writes a `running` row before and updates
// it to ok/error on completion. Instrumentation MUST NEVER throw — if the
// insert/update fails we swallow and let the wrapped fn keep running.

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

export type PhaseKind =
  | "ai_call"
  | "db_scan"
  | "lock_wait"
  | "backoff"
  | "external_http"
  | "compute"
  | "other";

export interface StepInit {
  job: string;
  step_key: string;
  step_label: string;
  phase_kind: PhaseKind;
  run_id?: string | null;
  detail?: Record<string, unknown>;
}

async function safeInsert(sb: SupabaseClient, init: StepInit): Promise<string | null> {
  try {
    const { data, error } = await sb
      .from("automation_steps")
      .insert({
        job: init.job,
        step_key: init.step_key,
        step_label: init.step_label,
        phase_kind: init.phase_kind,
        run_id: init.run_id ?? null,
        detail: init.detail ?? {},
        status: "running",
      })
      .select("id")
      .maybeSingle();
    if (error) return null;
    return data?.id ?? null;
  } catch {
    return null;
  }
}

async function safeFinish(
  sb: SupabaseClient,
  id: string | null,
  status: "ok" | "error" | "skipped",
  startMs: number,
  detail?: Record<string, unknown>,
): Promise<void> {
  if (!id) return;
  try {
    const finished_at = new Date().toISOString();
    const duration_ms = Math.max(0, Date.now() - startMs);
    const patch: Record<string, unknown> = { status, finished_at, duration_ms };
    if (detail) patch.detail = detail;
    await sb.from("automation_steps").update(patch).eq("id", id);
  } catch {
    // swallow
  }
}

export async function recordStep<T>(
  sb: SupabaseClient,
  init: StepInit,
  fn: () => Promise<T>,
): Promise<T> {
  const startMs = Date.now();
  const id = await safeInsert(sb, init);
  try {
    const out = await fn();
    await safeFinish(sb, id, "ok", startMs, init.detail);
    return out;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await safeFinish(sb, id, "error", startMs, { ...(init.detail ?? {}), error: msg.slice(0, 500) });
    throw e;
  }
}

export async function beginStep(sb: SupabaseClient, init: StepInit): Promise<{ id: string | null; startMs: number }> {
  const startMs = Date.now();
  const id = await safeInsert(sb, init);
  return { id, startMs };
}

export async function endStep(
  sb: SupabaseClient,
  handle: { id: string | null; startMs: number },
  status: "ok" | "error" | "skipped",
  detail?: Record<string, unknown>,
): Promise<void> {
  await safeFinish(sb, handle.id, status, handle.startMs, detail);
}
