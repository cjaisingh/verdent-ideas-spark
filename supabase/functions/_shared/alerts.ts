// Shared alert dispatcher: writes to public.alert_log and (if configured)
// posts to the operator webhook and/or Telegram. Mirrors the in-function
// copies in qa-validate / scheduled-code-review / record-test-run /
// secrets-health-check so every job can surface auth/operational failures
// the same way.
//
// Reasons currently in use:
//   review_error    — code review run errored
//   high_finding    — review surfaced a high-severity finding
//   test_fail       — recorded test run failed
//   qa_fail         — qa-validate probe failed
//   secrets_missing — secrets-health-check found a missing secret
//   auth_failed     — cron job hit a 401 (this file's primary use case)
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

const FLAG_MAP: Record<string, string> = {
  review_error: "alert_on_review_error",
  high_finding: "alert_on_high_finding",
  test_fail: "alert_on_test_fail",
  qa_fail: "alert_on_qa_fail",
  auth_failed: "alert_on_auth_failed",
};

export type AlertDispatchResult = { delivered: boolean; attempts: number };

export async function dispatchAlert(
  sb: SupabaseClient,
  job: string,
  reason: string,
  message: string,
  payload: Record<string, unknown> = {},
): Promise<AlertDispatchResult> {
  let delivered = false;
  let status_code: number | null = null;
  let error: string | null = null;
  let attempts = 0;
  try {
    const { data: settings } = await sb.from("alert_settings").select("*").eq("id", true).maybeSingle();
    const flag = FLAG_MAP[reason];
    const flagOff = !!settings && flag && (settings as any)[flag] === false;
    const enabled = !!settings?.enabled;
    const webhookConfigured = enabled && !!settings?.webhook_url;
    const telegramChatId: number | null = enabled
      ? ((settings as any)?.operator_telegram_chat_id ?? null)
      : null;

    let dedupedOut = false;
    if ((webhookConfigured || telegramChatId) && !flagOff) {
      const dedupeMin = Math.max(0, Number((settings as any)?.dedupe_minutes ?? 0));
      if (dedupeMin > 0) {
        const since = new Date(Date.now() - dedupeMin * 60_000).toISOString();
        const { data: recent } = await sb.from("alert_log")
          .select("id").eq("job", job).eq("reason", reason).eq("delivered", true)
          .gte("created_at", since).limit(1);
        if (recent && recent.length > 0) dedupedOut = true;
      }
    }

    // Webhook leg (Slack-style POST).
    if (webhookConfigured && !flagOff && !dedupedOut) {
      const body = JSON.stringify({
        text: `🚨 ${job} · ${reason}\n${message}`,
        job, reason, message, payload, ts: new Date().toISOString(),
      });
      try {
        attempts++;
        const r = await fetch((settings as any).webhook_url, {
          method: "POST", headers: { "Content-Type": "application/json" }, body,
        });
        status_code = r.status;
        delivered = r.ok;
        if (!r.ok) error = (await r.text()).slice(0, 300);
      } catch (e) {
        error = e instanceof Error ? e.message : String(e);
      }
    }

    // Telegram leg — independent of webhook. Calls telegram-send so the
    // bot token stays in TELEGRAM_API_KEY and the platform allowlist gates it.
    if (telegramChatId && !flagOff && !dedupedOut) {
      const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
      const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
      const SERVICE_TOKEN = Deno.env.get("AWIP_SERVICE_TOKEN");
      if (SUPABASE_URL && SERVICE_ROLE && SERVICE_TOKEN) {
        try {
          attempts++;
          const r = await fetch(`${SUPABASE_URL}/functions/v1/telegram-send`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "Authorization": `Bearer ${SERVICE_ROLE}`,
              "x-service-token": SERVICE_TOKEN,
            },
            body: JSON.stringify({
              chat_id: telegramChatId,
              text: `🚨 <b>${escapeHtml(job)}</b> · ${escapeHtml(reason)}\n${escapeHtml(message)}`,
              parse_mode: "HTML",
            }),
          });
          if (r.ok) {
            delivered = true;
            status_code = status_code ?? r.status;
          } else if (!delivered) {
            status_code = r.status;
            error = error ?? (await r.text().catch(() => "")).slice(0, 300);
          }
        } catch (e) {
          if (!delivered) error = error ?? (e instanceof Error ? e.message : String(e));
        }
      }
    }
  } catch (e) {
    error = error ?? (e instanceof Error ? e.message : String(e));
  }
  // Always record the attempt — even if no sinks are configured, the
  // operator can see in alert_log that the condition fired.
  try {
    await sb.from("alert_log").insert({ job, reason, message, delivered, status_code, error, payload });
  } catch (e) { console.error("alert_log insert failed", e); }
  // Structured log line so dispatch attempts surface in edge_request_logs
  // alongside the wrapping function's request id (W1 logger coverage).
  try {
    console.log(JSON.stringify({
      tag: "alerts.dispatch", job, reason, delivered, status_code, attempts,
      error: error ? error.slice(0, 200) : null,
      message: message.slice(0, 200),
    }));
  } catch { /**/ }
  return { delivered, attempts };
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
