// Out-of-band watchdog for sentinel-tick.
//
// Runs every 15 min via pg_cron (`scheduled-sentinel-watchdog`). Independent of
// AWIP_SERVICE_TOKEN and of the `telegram-send` edge fn — calls the Telegram
// connector gateway directly so a single-token rotation cannot silence it.
//
// Contract: supabase/functions/_shared/contracts/sentinel-watchdog.ts

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.0";
import { withLogger } from "../_shared/logger.ts";
import {
  ALERT_COOLDOWN_MIN,
  NEVER_RAN_WINDOW_HOURS,
  STALE_THRESHOLD_MIN,
  type SentinelWatchdogOutput,
  type SentinelWatchdogReason,
} from "../_shared/contracts/sentinel-watchdog.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type, apikey",
};

const GATEWAY_URL = "https://connector-gateway.lovable.dev/telegram";

type FailingJob = { job: string; status_code: number | null; count: number };

type Decision = {
  reason: SentinelWatchdogReason;
  shouldAlert: boolean;
  minutesSilent: number | null;
  alertKey: string | null;
};

/** Pure decision function — unit-tested without DB or network. */
export function decide(args: {
  now: Date;
  sentinelLastRunAt: Date | null;
  lastAlertKey: string | null;
  lastAlertAt: Date | null;
}): Decision {
  const { now, sentinelLastRunAt, lastAlertKey, lastAlertAt } = args;

  if (sentinelLastRunAt === null) {
    const key = `sentinel-silent::never::${now.toISOString().slice(0, 13)}`;
    const cooled = lastAlertAt
      ? (now.getTime() - lastAlertAt.getTime()) / 60_000 > ALERT_COOLDOWN_MIN
      : true;
    return {
      reason: cooled ? "never_ran" : "deduped",
      shouldAlert: cooled,
      minutesSilent: null,
      alertKey: key,
    };
  }

  const minutesSilent = Math.floor((now.getTime() - sentinelLastRunAt.getTime()) / 60_000);
  if (minutesSilent <= STALE_THRESHOLD_MIN) {
    return { reason: "healthy", shouldAlert: false, minutesSilent, alertKey: null };
  }

  // Hour-bucket key: same hour of staleness → same key → deduped.
  const key = `sentinel-silent::stale::${now.toISOString().slice(0, 13)}`;
  const cooled = lastAlertAt
    ? (now.getTime() - lastAlertAt.getTime()) / 60_000 > ALERT_COOLDOWN_MIN
    : true;
  const sameKeyRecently = lastAlertKey === key && !cooled;
  if (sameKeyRecently) {
    return { reason: "deduped", shouldAlert: false, minutesSilent, alertKey: key };
  }
  return { reason: "stale", shouldAlert: true, minutesSilent, alertKey: key };
}

function formatAlert(args: {
  minutesSilent: number | null;
  sentinelLastRunAt: string | null;
  topFailing: FailingJob[];
}): string {
  const head = args.minutesSilent === null
    ? "🚨 <b>Sentinel silent</b> — no successful run in 24h"
    : `🚨 <b>Sentinel silent</b> — last successful run ${args.minutesSilent} min ago`;
  const last = args.sentinelLastRunAt ? `\nLast: <code>${args.sentinelLastRunAt}</code>` : "";
  const failing = args.topFailing.length
    ? "\n\n<b>Failing crons (last 24h):</b>\n" +
      args.topFailing
        .slice(0, 5)
        .map((f) => `• <code>${f.job}</code> — ${f.count}× ${f.status_code ?? "?"}`)
        .join("\n")
    : "";
  return `${head}${last}${failing}\n\nFix: rotate <code>AWIP_SERVICE_TOKEN</code> + re-register affected crons.`;
}

Deno.serve(withLogger("sentinel-watchdog", async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  // Independent auth: this token is deliberately separate from AWIP_SERVICE_TOKEN.
  const watchdogToken = Deno.env.get("AWIP_WATCHDOG_TOKEN");
  const provided = req.headers.get("x-awip-watchdog-token");
  if (!watchdogToken || provided !== watchdogToken) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const url = new URL(req.url);
  const trigger = (url.searchParams.get("trigger") === "manual" ? "manual" : "cron") as
    | "manual"
    | "cron";

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false } },
  );

  const sinceIso = new Date(Date.now() - NEVER_RAN_WINDOW_HOURS * 3600 * 1000).toISOString();

  // 1. Last successful sentinel-tick run.
  const lastRunRes = await supabase
    .from("automation_runs")
    .select("created_at")
    .eq("job", "scheduled-sentinel-tick")
    .eq("status", "ok")
    .gte("created_at", sinceIso)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const sentinelLastRunAt: Date | null = lastRunRes.data?.created_at
    ? new Date(lastRunRes.data.created_at as string)
    : null;

  // 2. Last alert we fired (for dedupe).
  const lastAlertRes = await supabase
    .from("sentinel_watchdog_runs")
    .select("ran_at,last_alert_key")
    .eq("alerted", true)
    .order("ran_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const lastAlertKey = (lastAlertRes.data?.last_alert_key as string | null) ?? null;
  const lastAlertAt = lastAlertRes.data?.ran_at
    ? new Date(lastAlertRes.data.ran_at as string)
    : null;

  // 3. Decide.
  const decision = decide({
    now: new Date(),
    sentinelLastRunAt,
    lastAlertKey,
    lastAlertAt,
  });

  // 4. Top failing jobs (context for the alert and for the heartbeat row).
  let topFailing: FailingJob[] = [];
  if (decision.shouldAlert) {
    const failRes = await supabase
      .from("automation_runs")
      .select("job,status_code")
      .gte("created_at", sinceIso)
      .in("status", ["error", "fail"])
      .limit(500);
    const counts = new Map<string, FailingJob>();
    for (const row of (failRes.data ?? []) as Array<{ job: string; status_code: number | null }>) {
      const key = `${row.job}::${row.status_code ?? "null"}`;
      const existing = counts.get(key);
      if (existing) existing.count += 1;
      else counts.set(key, { job: row.job, status_code: row.status_code, count: 1 });
    }
    topFailing = [...counts.values()].sort((a, b) => b.count - a.count).slice(0, 5);
  }

  // 5. Alert via Telegram connector gateway DIRECTLY (no telegram-send middleman).
  let alerted = false;
  if (decision.shouldAlert) {
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    const TELEGRAM_API_KEY = Deno.env.get("TELEGRAM_API_KEY");
    const { data: settings } = await supabase
      .from("credit_settings")
      .select("operator_telegram_chat_id,alerts_enabled")
      .eq("id", true)
      .maybeSingle();
    const chat = settings as { operator_telegram_chat_id?: string | null; alerts_enabled?: boolean } | null;

    if (LOVABLE_API_KEY && TELEGRAM_API_KEY && chat?.alerts_enabled && chat.operator_telegram_chat_id) {
      try {
        const tgRes = await fetch(`${GATEWAY_URL}/sendMessage`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${LOVABLE_API_KEY}`,
            "X-Connection-Api-Key": TELEGRAM_API_KEY,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            chat_id: chat.operator_telegram_chat_id,
            text: formatAlert({
              minutesSilent: decision.minutesSilent,
              sentinelLastRunAt: sentinelLastRunAt?.toISOString() ?? null,
              topFailing,
            }),
            parse_mode: "HTML",
          }),
        });
        alerted = tgRes.ok;
        if (!tgRes.ok) {
          console.error("watchdog telegram send failed", tgRes.status, await tgRes.text());
        }
      } catch (e) {
        console.error("watchdog telegram exception", e);
      }
    } else {
      console.warn("watchdog wanted to alert but Telegram config incomplete");
    }
  }

  // 6. Heartbeat row (always, regardless of alert).
  await supabase.from("sentinel_watchdog_runs").insert({
    sentinel_last_run_at: sentinelLastRunAt?.toISOString() ?? null,
    minutes_silent: decision.minutesSilent,
    alerted,
    reason: decision.reason,
    last_alert_key: alerted ? decision.alertKey : null,
    details: {
      trigger,
      top_failing_jobs: topFailing,
      dedupe_key_seen: decision.alertKey,
    },
  });

  const body: SentinelWatchdogOutput = {
    ok: true,
    trigger,
    sentinel_last_run_at: sentinelLastRunAt?.toISOString() ?? null,
    minutes_silent: decision.minutesSilent,
    alerted,
    reason: decision.reason,
    alert_dedupe_key: decision.alertKey,
    top_failing_jobs: topFailing,
  };

  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}));
