// Sentinel Agent — runs every 15 min; writes to public.sentinel_findings.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { withLogger } from "../_shared/logger.ts";
import { dispatchAlert } from "../_shared/alerts.ts";
import {
  checkCronSilence, checkFiveXxSpike, checkSecretAge, checkAdminGrants, checkJobErrorRate,
  checkFrontendRealtimeErrors, checkEdgeFunctionErrorRate, checkClientTransportErrors,
  checkVoicePipelineRed, checkNightJobsStalled, checkAllowlistRejects, checkWhatsNewDraftsStale,
  checkLintDeltaFailures, checkCompanionStreamsStalled, checkHeygenVideosFailed,
  checkTruthConflictsUnresolved, checkBudgetProjection, checkCreditRunway,
  checkCreditSnapshotStale,
  checkAiJobsStuck, checkAiWorkersOffline,
  checkTelegramWebhookSilent, checkApprovalsStale,
  checkSecretsHealthStale, checkCronAuthFailuresBurst,
  checkInboxKindClassifyFailures, checkInboxSourceSilent,
  SENTINEL_CADENCES, type FindingCandidate,
} from "./checks.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-service-token",
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...corsHeaders, "Content-Type": "application/json" } });

Deno.serve(withLogger("sentinel-tick", async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const SERVICE_TOKEN = Deno.env.get("AWIP_SERVICE_TOKEN");
  const sb = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });

  const provided = req.headers.get("x-service-token");
  const auth = req.headers.get("authorization") ?? "";
  const triggeredByCron = !!SERVICE_TOKEN && provided === SERVICE_TOKEN;
  const trigger = triggeredByCron ? "cron" : "manual";
  const startedAt = Date.now();

  const recordRun = async (status: string, code: number, msg: string, detail: Record<string, unknown> = {}) => {
    try {
      await sb.from("automation_runs").insert({
        job: "sentinel-tick", trigger, status, status_code: code,
        duration_ms: Date.now() - startedAt, message: msg, detail,
      });
    } catch (e) { console.error("automation_runs insert failed", e); }
  };

  if (!triggeredByCron && !auth.startsWith("Bearer ")) {
    await recordRun("error", 401, "Missing auth.");
    await dispatchAlert(sb, "sentinel-tick", "auth_failed", "sentinel-tick unauthorized");
    return json({ error: "unauthorized" }, 401);
  }

  try {
    const now = new Date();
    const since30m = new Date(now.getTime() - 30 * 60_000).toISOString();
    const since60m = new Date(now.getTime() - 60 * 60_000).toISOString();
    // Cron-silence check needs to see runs older than 24h for weekly jobs
    // (threshold is 2× cadence, so weekly jobs need ~14 days of history).
    // checkJobErrorRate filters down to 24h internally.
    const since15d = new Date(now.getTime() - 15 * 24 * 3600 * 1000).toISOString();

    const since24h = new Date(now.getTime() - 24 * 3600_000).toISOString();
    const since5mAgo = new Date(now.getTime() - 5 * 60_000).toISOString();

    const truthConflictsRes = await sb.from("truth_conflicts")
      .select("entity,entity_id,field,top_source,next_source").limit(200);

    // Budget projection signals + state
    const ym = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
    const [budgetSignalsRes, budgetSettingsRes, budgetAlertsRes, runwayRes, snapshotAgeRes] = await Promise.all([
      sb.from("v_tool_policy_signals").select("budget,burn_7d_per_day,projected_month_end").maybeSingle(),
      sb.from("credit_settings")
        .select("operator_telegram_chat_id,alerts_enabled")
        .eq("id", true).maybeSingle(),
      sb.from("credit_alerts").select("year_month,threshold_pct,kind").eq("year_month", ym),
      sb.from("v_credit_runway").select("balance,as_of,estimated_balance_now,burn_per_day_21d,days_runway_21d,runway_exhaustion_date_21d").maybeSingle(),
      sb.from("v_credit_snapshot_latest_age").select("latest_as_of,minutes_since_latest,snapshots_24h,entries_since_latest").maybeSingle(),
    ]);

    const monitoredJobs = Object.keys(SENTINEL_CADENCES);
    const [runsRes, edgeRes, voiceEdgeRes, secretsRes, auditRes, feRes, cliRes, allowRes, draftRes, lintRes, stalledStreamsRes, heygenFailedRes, tgWebhookRes, lastApprovalRes, lastSecretsOkRes, authFailLogRes] = await Promise.all([
      // Filter to monitored jobs only. Without this filter, high-frequency jobs
      // like automation-auth-monitor (every 15min × 15d = 1440 rows) blow past
      // PostgREST's default 1000-row cap and push lower-volume jobs out of the
      // sample — causing false-positive cron_silence findings for jobs that
      // are actually running on schedule.
      sb.from("automation_runs")
        .select("id,job,status,created_at")
        .in("job", monitoredJobs)
        .gte("created_at", since15d)
        .order("created_at", { ascending: false })
        .limit(5000),
      sb.from("edge_request_logs")
        .select("status,created_at,function_name")
        .gte("created_at", since30m).limit(2000),
      sb.from("edge_request_logs")
        .select("status,created_at,function_name")
        .in("function_name", ["gemini-tts", "companion-cloud-chat", "telegram-send-voice"])
        .gte("created_at", since60m).limit(2000),
      sb.from("app_secrets").select("key,updated_at"),
      sb.from("role_change_audit").select("id,role,action,target_user_id,created_at").gte("created_at", since30m),
      sb.from("frontend_error_logs").select("message,url,created_at,kind").gte("created_at", since30m).limit(500),
      sb.from("client_error_log").select("function_name,message,created_at").gte("created_at", since30m).limit(500),
      sb.from("edge_request_logs")
        .select("function_name,classified_error,created_at")
        .eq("classified_error", "allowlist_reject")
        .gte("created_at", since24h)
        .limit(2000),
      sb.from("whats_new_entries").select("id,created_at").eq("status", "draft").limit(500),
      sb.from("lint_delta_runs")
        .select("id,created_at,caller,file_path,error_class")
        .eq("status", "failed")
        .gte("created_at", since60m).limit(500),
      sb.from("companion_messages")
        .select("id,thread_id,streamed_at,created_at")
        .eq("status", "streaming")
        .gte("created_at", since24h)
        .lt("streamed_at", since5mAgo)
        .limit(500),
      sb.from("heygen_videos")
        .select("id,kind,error,created_at")
        .eq("status", "failed")
        .gte("created_at", since24h)
        .limit(50),
      // Telegram webhook: last invocation (any status, including 200/ignored).
      sb.from("edge_request_logs")
        .select("created_at")
        .eq("function_name", "telegram-webhook")
        .order("created_at", { ascending: false })
        .limit(1).maybeSingle(),
      // Approvals: latest row regardless of status. Silence here means the
      // operator approval channel is broken upstream.
      sb.from("approval_queue")
        .select("created_at")
        .order("created_at", { ascending: false })
        .limit(1).maybeSingle(),
      // Detector-of-the-detector: most recent ok run of secrets-health-check.
      sb.from("automation_runs")
        .select("created_at")
        .eq("job", "secrets-health-check").eq("status", "ok")
        .order("created_at", { ascending: false })
        .limit(1).maybeSingle(),
      // Aggregate auth_failed bursts across all cron jobs (last 1h).
      sb.from("alert_log")
        .select("job,reason,created_at")
        .eq("reason", "auth_failed")
        .gte("created_at", since60m).limit(500),
    ]);

    // Slice 1: reclaim stalled night workers (10-min staleness threshold).
    let reclaimResult: Record<string, number> = {};
    try {
      const { data: r } = await sb.rpc("reclaim_stale_night_jobs", { _stale_minutes: 10 });
      reclaimResult = (r as Record<string, number>) ?? {};
    } catch (e) {
      console.error("reclaim_stale_night_jobs failed", e);
    }

    // Slice 1b: reclaim stalled local-LLM (Ollama) workers, same cadence.
    try {
      await sb.rpc("reclaim_stale_ai_jobs", { _stale_minutes: 10 });
    } catch (e) {
      console.error("reclaim_stale_ai_jobs failed", e);
    }

    const [aiJobsRes, aiWorkersRes, aiQueueRes] = await Promise.all([
      sb.from("ai_jobs").select("id,kind,attempts,heartbeat_at,claimed_at").eq("status","claimed").limit(200),
      sb.from("ai_workers").select("name,enabled,last_seen_at").limit(50),
      sb.from("ai_jobs").select("id", { count: "exact", head: true }).eq("status","queued"),
    ]);

    const runs = runsRes.data ?? [];
    const edgeLogs = edgeRes.data ?? [];
    const candidates: FindingCandidate[] = [
      ...checkCronSilence(now, SENTINEL_CADENCES, runs),
      ...checkFiveXxSpike(now, 15, edgeLogs),
      ...checkEdgeFunctionErrorRate(now, 30, edgeLogs),
      ...checkClientTransportErrors(now, 30, cliRes.data ?? []),
      ...checkVoicePipelineRed(now, 60, voiceEdgeRes.data ?? []),
      ...checkSecretAge(now, secretsRes.data ?? []),
      ...checkAdminGrants(now, 15, auditRes.data ?? []),
      ...checkJobErrorRate(now, runs),
      ...checkFrontendRealtimeErrors(now, 30, feRes.data ?? []),
      ...checkNightJobsStalled(now, reclaimResult),
      ...checkAllowlistRejects(now, allowRes.data ?? []),
      ...checkWhatsNewDraftsStale(now, (draftRes.data ?? []) as { id: string; created_at: string }[]),
      ...checkLintDeltaFailures(now, (lintRes.data ?? []) as { id: string; created_at: string; caller: string | null; file_path: string | null; error_class: string | null }[]),
      ...checkCompanionStreamsStalled(now, (stalledStreamsRes.data ?? []) as { id: string; thread_id: string | null; streamed_at: string | null; created_at: string }[]),
      ...checkHeygenVideosFailed(now, (heygenFailedRes.data ?? []) as { id: string; kind: string; error: string | null; created_at: string }[]),
      ...checkTruthConflictsUnresolved(now, (truthConflictsRes.data ?? []) as { entity: string; entity_id: string; field: string; top_source: string | null; next_source: string | null }[]),
      ...checkBudgetProjection(
        now,
        (budgetSignalsRes.data ?? null) as { budget: number | null; burn_7d_per_day: number | null; projected_month_end: number | null } | null,
        (budgetAlertsRes.data ?? []) as { year_month: string; threshold_pct: number | null; kind?: string }[],
      ),
      ...checkCreditRunway(
        now,
        (runwayRes.data ?? null) as { balance: number | null; as_of: string | null; estimated_balance_now: number | null; burn_per_day_21d: number | null; days_runway_21d: number | null; runway_exhaustion_date_21d: string | null } | null,
        (budgetAlertsRes.data ?? []) as { year_month: string; threshold_pct: number | null; kind?: string }[],
      ),
      ...checkCreditSnapshotStale(
        now,
        (snapshotAgeRes.data ?? null) as { latest_as_of: string | null; minutes_since_latest: number | null; snapshots_24h: number | null; entries_since_latest: number | null } | null,
        (budgetAlertsRes.data ?? []) as { year_month: string; threshold_pct: number | null; kind?: string }[],
      ),
      ...checkAiJobsStuck(now, (aiJobsRes.data ?? []) as { id: string; kind: string; attempts: number | null; heartbeat_at: string | null; claimed_at: string | null }[]),
      ...checkAiWorkersOffline(now, (aiWorkersRes.data ?? []) as { name: string; enabled: boolean; last_seen_at: string | null }[], aiQueueRes.count ?? 0),
      ...checkTelegramWebhookSilent(now, (tgWebhookRes.data as { created_at: string } | null)?.created_at ?? null),
      ...checkApprovalsStale(now, (lastApprovalRes.data as { created_at: string } | null)?.created_at ?? null),
      ...checkSecretsHealthStale(now, (lastSecretsOkRes.data as { created_at: string } | null)?.created_at ?? null),
      ...checkCronAuthFailuresBurst(now, (authFailLogRes.data ?? []) as { job: string; reason: string; created_at: string }[]),
    ];

    let inserted = 0, updated = 0, alerts = 0, autoLinked = 0;
    for (const c of candidates) {
      const { data: existing } = await sb.from("sentinel_findings")
        .select("id,status,severity").eq("dedupe_key", c.dedupe_key).maybeSingle();
      if (existing) {
        await sb.from("sentinel_findings").update({
          last_seen_at: now.toISOString(),
          status: existing.status === "muted" ? "muted" : "open",
          severity: c.severity,
          summary: c.summary,
          payload: c.payload,
          subject_ref: c.subject_ref,
          resolved_at: null,
        }).eq("id", existing.id);
        updated++;
      } else {
        const { data: ins } = await sb.from("sentinel_findings").insert({
          kind: c.kind, severity: c.severity, summary: c.summary,
          dedupe_key: c.dedupe_key, subject_ref: c.subject_ref, payload: c.payload,
          status: "open",
        }).select("id").maybeSingle();
        inserted++;
        if (ins?.id) {
          try {
            const { data: linked } = await sb.rpc("auto_link_finding_to_action", { _finding_id: ins.id });
            if (linked) autoLinked++;
          } catch (e) { console.error("auto_link_finding_to_action failed", e); }
        }
        if (c.severity === "high" || c.severity === "critical") {
          await dispatchAlert(sb, "sentinel-tick", "high_finding", `${c.kind}: ${c.summary}`, c.payload);
          alerts++;
        }

        // Budget projection side-effects: insert credit_alerts row + optional Telegram push.
        if (c.kind === "budget_projection_80" || c.kind === "budget_projection_100") {
          const p = c.payload as { year_month: string; threshold_pct: number; projected_pct: number; burn_per_day: number; budget: number };
          const settings = (budgetSettingsRes.data ?? null) as { operator_telegram_chat_id: string | null; alerts_enabled: boolean } | null;

          let telegramMessageId: string | null = null;
          if (settings?.alerts_enabled && settings?.operator_telegram_chat_id && SERVICE_TOKEN) {
            try {
              const emoji = p.threshold_pct === 100 ? "🚨" : "⚠️";
              const text = `${emoji} <b>Lovable budget ${p.threshold_pct}% (projected)</b>\n` +
                `Projected month-end: <b>${p.projected_pct.toFixed(0)}%</b> of ${p.budget} credits\n` +
                `Burn rate (7d): ${p.burn_per_day.toFixed(1)}/day\n` +
                `Month: ${p.year_month}`;
              const res = await fetch(`${SUPABASE_URL}/functions/v1/telegram-send`, {
                method: "POST",
                headers: {
                  "Content-Type": "application/json",
                  "x-service-token": SERVICE_TOKEN,
                  "Authorization": `Bearer ${SERVICE_ROLE}`,
                },
                body: JSON.stringify({
                  chat_id: settings.operator_telegram_chat_id,
                  text,
                  parse_mode: "HTML",
                }),
              });
              if (res.ok) {
                const body = await res.json().catch(() => null) as { result?: { message_id?: number } } | null;
                telegramMessageId = body?.result?.message_id ? String(body.result.message_id) : null;
              } else {
                console.error("telegram-send for budget alert failed", res.status, await res.text().catch(() => ""));
              }
            } catch (e) { console.error("telegram-send budget alert error", e); }
          }

          await sb.from("credit_alerts").insert({
            year_month: p.year_month,
            kind: `budget_projection_${p.threshold_pct}`,
            threshold_pct: p.threshold_pct,
            projected_pct: p.projected_pct,
            burn_per_day: p.burn_per_day,
            budget: p.budget,
            sentinel_finding_id: ins?.id ?? null,
            telegram_message_id: telegramMessageId,
          });
        }

        // Credit runway side-effects: same shape — credit_alerts row + Telegram push.
        if (c.kind === "credit_runway_warn" || c.kind === "credit_runway_critical") {
          const p = c.payload as {
            year_month: string; kind: string; days_runway: number; burn_per_day: number;
            balance: number; estimated_balance_now: number; as_of: string; exhaust_at: string | null;
          };
          const settings = (budgetSettingsRes.data ?? null) as { operator_telegram_chat_id: string | null; alerts_enabled: boolean } | null;
          let telegramMessageId: string | null = null;
          if (settings?.alerts_enabled && settings?.operator_telegram_chat_id && SERVICE_TOKEN) {
            try {
              const emoji = c.kind === "credit_runway_critical" ? "🚨" : "⚠️";
              const exhaust = p.exhaust_at ? new Date(p.exhaust_at).toISOString().slice(0, 10) : "—";
              const text = `${emoji} <b>Credit runway ${p.days_runway.toFixed(1)} days</b>\n` +
                `Estimated balance: <b>${p.estimated_balance_now.toFixed(0)}</b> credits\n` +
                `Burn (21d): ${p.burn_per_day.toFixed(1)}/day · exhaust ~${exhaust}\n` +
                `Last reading: ${p.balance.toFixed(0)} on ${new Date(p.as_of).toISOString().slice(0,10)}`;
              const res = await fetch(`${SUPABASE_URL}/functions/v1/telegram-send`, {
                method: "POST",
                headers: {
                  "Content-Type": "application/json",
                  "x-service-token": SERVICE_TOKEN,
                  "Authorization": `Bearer ${SERVICE_ROLE}`,
                },
                body: JSON.stringify({
                  chat_id: settings.operator_telegram_chat_id,
                  text,
                  parse_mode: "HTML",
                }),
              });
              if (res.ok) {
                const body = await res.json().catch(() => null) as { result?: { message_id?: number } } | null;
                telegramMessageId = body?.result?.message_id ? String(body.result.message_id) : null;
              } else {
                console.error("telegram-send for runway alert failed", res.status, await res.text().catch(() => ""));
              }
            } catch (e) { console.error("telegram-send runway alert error", e); }
          }

          await sb.from("credit_alerts").insert({
            year_month: p.year_month,
            kind: p.kind === "runway_critical" ? "runway_critical" : "runway_warn",
            burn_per_day: p.burn_per_day,
            sentinel_finding_id: ins?.id ?? null,
            telegram_message_id: telegramMessageId,
          });
        }
      }
    }

    // Auto-resolve open findings whose dedupe_key did not re-fire AND aren't event-based (role_grant/secret_age stay).
    const liveKeys = new Set(candidates.map((c) => c.dedupe_key));
    const { data: open } = await sb.from("sentinel_findings")
      .select("id,dedupe_key,kind").eq("status", "open");
    let resolved = 0;
    for (const r of (open ?? [])) {
      if (liveKeys.has((r as any).dedupe_key)) continue;
      // Only auto-resolve transient checks; role_grant must be manually acknowledged.
      if ((r as any).kind === "role_grant") continue;
      await sb.from("sentinel_findings").update({
        status: "resolved", resolved_at: now.toISOString(),
      }).eq("id", (r as any).id);
      resolved++;
    }

    // Daily Telegram heartbeat — if a chat_id is configured but no successful
    // telegram-send in the last 25h, fire a one-line ping so silent outbound
    // breakage surfaces within a day rather than going stale for a week.
    try {
      const { data: alertCfg } = await sb.from("alert_settings")
        .select("operator_telegram_chat_id,enabled").eq("id", true).maybeSingle();
      const chatId = (alertCfg as any)?.operator_telegram_chat_id;
      if (alertCfg?.enabled && chatId && SERVICE_TOKEN) {
        const since25h = new Date(now.getTime() - 25 * 3600_000).toISOString();
        const { data: lastSend } = await sb.from("edge_request_logs")
          .select("created_at").eq("function_name", "telegram-send").eq("status", 200)
          .gte("created_at", since25h).order("created_at", { ascending: false }).limit(1);
        if (!lastSend || lastSend.length === 0) {
          await fetch(`${SUPABASE_URL}/functions/v1/telegram-send`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "Authorization": `Bearer ${SERVICE_ROLE}`,
              "x-service-token": SERVICE_TOKEN,
            },
            body: JSON.stringify({
              chat_id: chatId,
              text: `🟢 AWIP heartbeat · ${now.toISOString().slice(0, 16).replace("T", " ")}Z\nsentinel-tick alive · ${inserted} new · ${updated} updated · ${resolved} resolved`,
              parse_mode: "HTML",
            }),
          }).catch((e) => console.error("heartbeat send failed", e));
        }
      }
    } catch (e) { console.error("heartbeat check failed", e); }

    // Telegram webhook auto-recovery — fire-and-forget. The function probes
    // getWebhookInfo itself and only re-registers if Telegram reports pending
    // updates or a recent last_error_date. Back-off lives inside the function;
    // we just kick it once per tick.
    if (SERVICE_TOKEN) {
      fetch(`${SUPABASE_URL}/functions/v1/telegram-webhook-reregister`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-service-token": SERVICE_TOKEN },
        body: "{}",
      }).catch((e) => console.error("telegram-webhook-reregister kick failed", e));
    }

    await recordRun("ok", 200, `tick: ${inserted}+ ${updated}~ ${resolved}✓ ${autoLinked}🔗`, {
      inserted, updated, resolved, alerts, autoLinked, candidates: candidates.length,
    });
    return json({ ok: true, inserted, updated, resolved, alerts, autoLinked });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await recordRun("error", 500, msg);
    await dispatchAlert(sb, "sentinel-tick", "review_error", msg);
    return json({ error: msg }, 500);
  }
}));
