// Local handler registry for the W8.1 scheduler.
// Remote handlers (FM modules) are NOT here — they are resolved from
// public.module_endpoints by `scheduler-tick`.
//
// To add a new local handler:
//   1. Add a row to public.scheduler_kind_catalog with handler_mode='local'.
//   2. Add an entry below.
//   3. Add a vitest/deno test.

import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import type {
  ScheduledJobRow,
  SchedulerHandlerResult,
  SchedulerLocalHandler,
} from "./contracts/scheduler.ts";

function service(): SupabaseClient {
  return createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false } },
  );
}

// ---- reminder.send ------------------------------------------------------
// payload: { message: string, telegram_chat_id?: string, create_action?: boolean, action_title?: string }
const reminderSend: SchedulerLocalHandler = async (job): Promise<SchedulerHandlerResult> => {
  const p = job.payload as Record<string, unknown>;
  const message = typeof p.message === "string" ? p.message : null;
  if (!message) return { status: "failed", error: "payload.message required", retryable: false };

  const sb = service();
  const errors: string[] = [];

  // Telegram delivery (best-effort)
  let chat_id = typeof p.telegram_chat_id === "string" ? p.telegram_chat_id : null;
  if (!chat_id && job.subject_type === "external_contact" && job.subject_id) {
    const { data } = await sb.from("external_contacts").select("telegram_chat_id").eq("id", job.subject_id).maybeSingle();
    chat_id = (data?.telegram_chat_id as string | undefined) ?? null;
  }
  if (chat_id) {
    try {
      const r = await sb.functions.invoke("telegram-send", { body: { chat_id, text: message } });
      if (r.error) errors.push(`telegram: ${r.error.message}`);
    } catch (e) {
      errors.push(`telegram: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  // Operator inbox (always, for audit)
  if (p.create_action !== false) {
    const title = (typeof p.action_title === "string" ? p.action_title : message).slice(0, 200);
    const { error } = await sb.from("discussion_actions").insert({
      title,
      details: message,
      source: "scheduler",
      source_ref: `job:${job.id}`,
      priority: "medium",
      status: "open",
    });
    if (error && !/duplicate/i.test(error.message)) errors.push(`inbox: ${error.message}`);
  }

  if (errors.length > 0 && !chat_id) {
    return { status: "failed", error: errors.join("; "), retryable: true };
  }
  return { status: "done", result: { delivered_to: chat_id ? "telegram+inbox" : "inbox", errors } };
};

// ---- report.weekly_digest ------------------------------------------------
// payload: { kind?: 'operator' } — v1 just mirrors morning-review and tags it.
const reportWeeklyDigest: SchedulerLocalHandler = async (job): Promise<SchedulerHandlerResult> => {
  const sb = service();
  try {
    const r = await sb.functions.invoke("morning-review", { body: { trigger: "weekly_digest", job_id: job.id } });
    if (r.error) return { status: "failed", error: r.error.message, retryable: true };
    return { status: "done", result: r.data };
  } catch (e) {
    return { status: "failed", error: e instanceof Error ? e.message : String(e), retryable: true };
  }
};

// ---- rationalisation.lane_eligible --------------------------------------
// payload: { lane: number, gate_check?: string }
const rationalisationLaneEligible: SchedulerLocalHandler = async (job): Promise<SchedulerHandlerResult> => {
  const p = job.payload as Record<string, unknown>;
  const lane = typeof p.lane === "number" ? p.lane : null;
  if (lane === null) return { status: "failed", error: "payload.lane required", retryable: false };
  const sb = service();
  const { error } = await sb.from("discussion_actions").insert({
    title: `Rationalisation Lane ${lane} eligible — 24h gate passed`,
    details: `Auto-scheduled by W8.1 scheduler. ${p.gate_check ? `Gate: ${p.gate_check}.` : ""} Review sentinel + cron_auth_failures_burst before proceeding.`,
    source: "scheduler",
    source_ref: `lane:${lane}`,
    priority: "high",
    status: "open",
    night_eligible: false,
  });
  if (error && !/duplicate/i.test(error.message)) {
    return { status: "failed", error: error.message, retryable: true };
  }
  return { status: "done", result: { lane, action: "discussion_action_created" } };
};

export const LOCAL_HANDLERS: Record<string, SchedulerLocalHandler> = {
  "reminder.send": reminderSend,
  "report.weekly_digest": reportWeeklyDigest,
  "rationalisation.lane_eligible": rationalisationLaneEligible,
};

export type { SchedulerLocalHandler, ScheduledJobRow };
