// Auto-recovery for Telegram webhook silence.
//
// Fired once per sentinel-tick (every 15 min). Self-contained: calls
// getWebhookInfo via the connector gateway and only re-registers when
// Telegram itself reports trouble (last_error_date in the last 15 min,
// or a non-zero pending_update_count, or last_error_message non-empty).
//
// Back-off: max 3 attempts in a rolling 6h window. After the cap, this
// function escalates by raising a critical `telegram_webhook_silent`
// sentinel finding and notifying the operator via telegram-send (best
// effort — Telegram may itself be the broken thing).
//
// Idempotent re-register: setWebhook with the same URL + secret_token +
// allowed_updates. We do NOT drop_pending_updates so the backlog is
// preserved and processed once the webhook is healthy again.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { withLogger } from "../_shared/logger.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-service-token",
};

const GATEWAY_URL = "https://connector-gateway.lovable.dev/telegram";
const SILENCE_ERROR_WINDOW_SEC = 15 * 60; // last_error_date within 15min
const BACKOFF_WINDOW_HOURS = 6;
const MAX_ATTEMPTS_PER_WINDOW = 3;

async function deriveSecret(apiKey: string): Promise<string> {
  const data = new TextEncoder().encode(`telegram-webhook:${apiKey}`);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return btoa(String.fromCharCode(...new Uint8Array(digest)))
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function json(p: unknown, s = 200) {
  return new Response(JSON.stringify(p), {
    status: s, headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(withLogger("telegram-webhook-reregister", async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  // Service-token auth (called from sentinel-tick or operator).
  const SERVICE_TOKEN = Deno.env.get("AWIP_SERVICE_TOKEN");
  const provided = req.headers.get("x-service-token");
  const auth = req.headers.get("authorization") ?? "";
  const ok = (!!SERVICE_TOKEN && provided === SERVICE_TOKEN) || auth.startsWith("Bearer ");
  if (!ok) return json({ error: "unauthorized" }, 401);

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
  const TELEGRAM_API_KEY = Deno.env.get("TELEGRAM_API_KEY");

  const sb = createClient(SUPABASE_URL, SERVICE_KEY);
  const startedAt = Date.now();
  const record = async (status: string, status_code: number, message: string, detail: Record<string, unknown> = {}) => {
    try {
      await sb.from("automation_runs").insert({
        job: "telegram-webhook-reregister", trigger: "auto",
        status, status_code, duration_ms: Date.now() - startedAt, message, detail,
      });
    } catch (e) { console.error("automation_runs insert failed", e); }
  };

  if (!LOVABLE_API_KEY || !TELEGRAM_API_KEY) {
    await record("error", 500, "Telegram connector not configured (LOVABLE_API_KEY / TELEGRAM_API_KEY missing)");
    return json({ ok: false, error: "connector_not_configured" }, 500);
  }

  // --- 1. Probe: getWebhookInfo ---
  let info: {
    url?: string;
    has_custom_certificate?: boolean;
    pending_update_count?: number;
    last_error_date?: number;
    last_error_message?: string;
    allowed_updates?: string[];
  } = {};
  try {
    const r = await fetch(`${GATEWAY_URL}/getWebhookInfo`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${LOVABLE_API_KEY}`,
        "X-Connection-Api-Key": TELEGRAM_API_KEY,
        "Content-Type": "application/json",
      },
      body: "{}",
    });
    const j = await r.json().catch(() => null);
    if (!r.ok || !j?.ok) {
      await record("error", r.status, `getWebhookInfo failed`, { body: j });
      return json({ ok: false, stage: "probe", body: j }, 502);
    }
    info = j.result ?? {};
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await record("error", 502, `getWebhookInfo network error: ${msg}`);
    return json({ ok: false, stage: "probe", error: msg }, 502);
  }

  const nowSec = Math.floor(Date.now() / 1000);
  const errAgeSec = info.last_error_date ? nowSec - info.last_error_date : Infinity;
  const silent =
    (info.last_error_date && errAgeSec <= SILENCE_ERROR_WINDOW_SEC) ||
    (typeof info.pending_update_count === "number" && info.pending_update_count > 0) ||
    !info.url;

  if (!silent) {
    // Healthy — best-effort: clear any open `telegram_webhook_silent` finding.
    await sb.from("sentinel_findings")
      .update({ status: "resolved", resolved_at: new Date().toISOString() })
      .eq("dedupe_key", "telegram_webhook_silent")
      .eq("status", "open");
    await record("ok", 200, "Webhook healthy — no action", { info });
    return json({ ok: true, healthy: true, info });
  }

  // --- 2. Back-off: count recent re-register attempts ---
  const windowSince = new Date(Date.now() - BACKOFF_WINDOW_HOURS * 3600_000).toISOString();
  const { data: recentAttempts } = await sb
    .from("automation_runs")
    .select("id,status,created_at")
    .eq("job", "telegram-webhook-reregister")
    .eq("trigger", "auto")
    .gte("created_at", windowSince)
    .in("status", ["ok", "fix-attempted", "error"]);

  const attemptsThatTriedFix = (recentAttempts ?? []).filter((r) =>
    r.status === "fix-attempted" || r.status === "error"
  ).length;

  if (attemptsThatTriedFix >= MAX_ATTEMPTS_PER_WINDOW) {
    const msg = `Webhook silent and ${attemptsThatTriedFix} re-register attempts in last ${BACKOFF_WINDOW_HOURS}h have not recovered it. Escalating — manual intervention required.`;
    await record("escalated", 503, msg, { info, attempts_in_window: attemptsThatTriedFix });

    // Critical sentinel finding (upsert by dedupe_key, sentinel-tick also writes this key).
    const existing = await sb.from("sentinel_findings").select("id")
      .eq("dedupe_key", "telegram_webhook_silent").maybeSingle();
    if (existing.data) {
      await sb.from("sentinel_findings").update({
        severity: "critical",
        status: "open",
        last_seen_at: new Date().toISOString(),
        summary: msg,
        payload: { info, attempts_in_window: attemptsThatTriedFix, auto_recovery: "failed" },
      }).eq("id", existing.data.id);
    } else {
      await sb.from("sentinel_findings").insert({
        kind: "telegram_webhook_silent",
        severity: "critical",
        dedupe_key: "telegram_webhook_silent",
        subject_ref: { function_name: "telegram-webhook" },
        summary: msg,
        payload: { info, attempts_in_window: attemptsThatTriedFix, auto_recovery: "failed" },
      });
    }

    // Best-effort Telegram alert to operator (may itself fail if webhook is broken).
    await notifyOperator(sb, SUPABASE_URL, SERVICE_TOKEN ?? "",
      `🚨 Telegram webhook auto-recovery FAILED ${attemptsThatTriedFix}/${MAX_ATTEMPTS_PER_WINDOW} times in ${BACKOFF_WINDOW_HOURS}h.\nLast error: ${info.last_error_message ?? "n/a"}\nPending updates: ${info.pending_update_count ?? 0}`);
    return json({ ok: false, escalated: true, info, attempts_in_window: attemptsThatTriedFix }, 503);
  }

  // --- 3. Re-register (idempotent) ---
  const expectedSecret = await deriveSecret(TELEGRAM_API_KEY);
  const webhookUrl = info.url || `${SUPABASE_URL}/functions/v1/telegram-webhook`;
  const allowedUpdates = info.allowed_updates && info.allowed_updates.length > 0
    ? info.allowed_updates
    : ["message", "edited_message", "callback_query"];

  let setResult: unknown = null;
  let setStatus = 0;
  try {
    const r = await fetch(`${GATEWAY_URL}/setWebhook`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${LOVABLE_API_KEY}`,
        "X-Connection-Api-Key": TELEGRAM_API_KEY,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        url: webhookUrl,
        secret_token: expectedSecret,
        allowed_updates: allowedUpdates,
        // intentionally NOT setting drop_pending_updates — preserve backlog
      }),
    });
    setStatus = r.status;
    setResult = await r.json().catch(() => null);
    if (!r.ok || !(setResult as { ok?: boolean })?.ok) {
      await record("error", r.status, `setWebhook failed`, { info, setResult });
      return json({ ok: false, stage: "reregister", body: setResult }, 502);
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await record("error", 502, `setWebhook network error: ${msg}`, { info });
    return json({ ok: false, stage: "reregister", error: msg }, 502);
  }

  // Mark as `fix-attempted` (not `ok`) — we don't yet know if it cured the
  // silence; the NEXT tick's probe will decide. Only that next-probe healthy
  // result clears the sentinel finding.
  await record("fix-attempted", 200,
    `setWebhook re-asserted (attempt ${attemptsThatTriedFix + 1}/${MAX_ATTEMPTS_PER_WINDOW} in ${BACKOFF_WINDOW_HOURS}h)`,
    { info, setResult, webhook_url: webhookUrl });

  // If this was attempt 1, notify operator once so they know recovery is in flight.
  if (attemptsThatTriedFix === 0) {
    await notifyOperator(sb, SUPABASE_URL, SERVICE_TOKEN ?? "",
      `⚠️ Telegram webhook was silent — re-registered automatically.\nLast error: ${info.last_error_message ?? "n/a"}\nPending: ${info.pending_update_count ?? 0}`);
  }

  return json({
    ok: true,
    healthy: false,
    action: "reregistered",
    attempt: attemptsThatTriedFix + 1,
    max_attempts: MAX_ATTEMPTS_PER_WINDOW,
    info,
    setResult,
  });
}));

async function notifyOperator(
  sb: ReturnType<typeof createClient>,
  supabaseUrl: string,
  serviceToken: string,
  text: string,
) {
  if (!serviceToken) return;
  try {
    const { data: settings } = await sb.from("alert_settings")
      .select("operator_telegram_chat_id, enabled").eq("id", true).maybeSingle();
    const chatId = (settings as { operator_telegram_chat_id?: number | null } | null)?.operator_telegram_chat_id;
    if (!chatId || !settings?.enabled) return;
    await fetch(`${supabaseUrl}/functions/v1/telegram-send`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-service-token": serviceToken },
      body: JSON.stringify({ chat_id: chatId, text }),
    });
  } catch (e) { console.error("notifyOperator failed", e); }
}
