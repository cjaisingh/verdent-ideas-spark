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
  checkOutOfScopeStale,
  checkObservabilityRegistry,
  SENTINEL_CADENCES, type FindingCandidate, type ObservabilityStatusRow,
} from "./checks.ts";
import { recordStep } from "../_shared/steps.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-service-token",
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...corsHeaders, "Content-Type": "application/json" } });

Deno.serve(withLogger("sentinel-tick", async (req, ctx) => {
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
  const reqId = ctx.requestId;

  const recordRun = async (status: string, code: number, msg: string, detail: Record<string, unknown> = {}) => {
    try {
      await sb.from("automation_runs").insert({
        job: "sentinel-tick", trigger, status, status_code: code,
        duration_ms: Date.now() - startedAt, message: msg, detail,
        request_id: reqId,
      });
    } catch (e) { console.error("automation_runs insert failed", e); }
  };

  if (!triggeredByCron && !auth.startsWith("Bearer ")) {
    // Record as "rejected", not "error" — these are hostile/wrong callers,
    // not job failures. job_error_rate filters on status === "error" only,
    // so unauthorized hits no longer pollute the error rate.
    await recordRun("rejected", 401, "Missing auth.");
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

    const truthConflictsRes = await recordStep(sb, {
      job: "sentinel-tick", step_key: "db_scan:truth_conflicts",
      request_id: reqId,
      step_label: "Scan truth_conflicts view", phase_kind: "db_scan",
    }, () => sb.from("truth_conflicts")
      .select("entity,entity_id,field,top_source,next_source").limit(200));

    // Budget projection signals + state
    const ym = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
    const [budgetSignalsRes, budgetSettingsRes, budgetAlertsRes, runwayRes, snapshotAgeRes] = await recordStep(sb, {
      job: "sentinel-tick", step_key: "db_scan:budget_signals",
      request_id: reqId,
      step_label: "Gather budget + credit signals", phase_kind: "db_scan",
    }, () => Promise.all([
      sb.from("v_tool_policy_signals").select("budget,burn_7d_per_day,projected_month_end").maybeSingle(),
      sb.from("credit_settings")
        .select("operator_telegram_chat_id,alerts_enabled")
        .eq("id", true).maybeSingle(),
      sb.from("credit_alerts").select("year_month,threshold_pct,kind").eq("year_month", ym),
      sb.from("v_credit_runway").select("balance,as_of,estimated_balance_now,burn_per_day_21d,days_runway_21d,runway_exhaustion_date_21d").maybeSingle(),
      sb.from("v_credit_snapshot_latest_age").select("latest_as_of,minutes_since_latest,snapshots_24h,entries_since_latest").maybeSingle(),
    ]));

    const monitoredJobs = Object.keys(SENTINEL_CADENCES);
    const [runsRes, edgeRes, voiceEdgeRes, secretsRes, auditRes, feRes, cliRes, allowRes, draftRes, lintRes, stalledStreamsRes, heygenFailedRes, tgWebhookRes, lastApprovalRes, lastSecretsOkRes, authFailLogRes] = await recordStep(sb, {
      job: "sentinel-tick", step_key: "db_scan:monitored_signals",
      request_id: reqId,
      step_label: "Gather runs/edge/secrets/audit/lint/streams", phase_kind: "db_scan",
      detail: { batch_size: 16 },
    }, () => Promise.all([
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
      // Approvals: oldest PENDING row. An empty queue is not a fire — only
      // pending requests that have aged past threshold indicate a broken
      // operator channel (or a delinquent operator).
      sb.from("approval_queue")
        .select("created_at")
        .eq("status", "pending")
        .order("created_at", { ascending: true })
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
    ]));

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

    const [aiJobsRes, aiWorkersRes, aiQueueRes] = await recordStep(sb, {
      job: "sentinel-tick", step_key: "db_scan:ai_workers",
      request_id: reqId,
      step_label: "Scan AI jobs + workers + queue", phase_kind: "db_scan",
    }, () => Promise.all([
      sb.from("ai_jobs").select("id,kind,attempts,heartbeat_at,claimed_at").eq("status","claimed").limit(200),
      sb.from("ai_workers").select("name,enabled,last_seen_at").limit(50),
      sb.from("ai_jobs").select("id", { count: "exact", head: true }).eq("status","queued"),
    ]));

    // Operator Inbox signals.
    const since14d = new Date(now.getTime() - 14 * 24 * 3600_000).toISOString();
    const [inboxClassifyRes, inboxSourcesRes, inboxRecentRes] = await recordStep(sb, {
      job: "sentinel-tick", step_key: "db_scan:inbox_signals",
      request_id: reqId,
      step_label: "Scan operator inbox signals", phase_kind: "db_scan",
    }, () => Promise.all([
      sb.from("ai_usage_log")
        .select("status,created_at")
        .eq("job", "route-operator-message:inbox-kind")
        .gte("created_at", since24h)
        .limit(2000),
      sb.from("operator_inbox_sources")
        .select("id,label,chat_id")
        .eq("enabled", true)
        .limit(200),
      sb.from("operator_messages")
        .select("chat_id")
        .gte("created_at", since14d)
        .not("chat_id", "is", null)
        .limit(5000),
    ]));

    // Out-of-scope auto-logger stale watch (W: out_of_scope_stale).
    const since30d = new Date(now.getTime() - 30 * 24 * 3600_000).toISOString();
    const { data: oosStaleRows } = await recordStep(sb, {
      job: "sentinel-tick", step_key: "db_scan:out_of_scope_stale",
      request_id: reqId,
      step_label: "Scan stale auto-logged discussion_actions", phase_kind: "db_scan",
    }, () => sb
      .from("discussion_actions")
      .select("id, short_num, title, source, source_ref, created_at")
      .in("source", ["plan_footer", "session_summary"])
      .eq("status", "open")
      .gte("created_at", since30d)
      .limit(500));

    const runs = runsRes.data ?? [];
    const edgeLogs = edgeRes.data ?? [];

    // Cron-silence needs ONE row per job (the most recent). Using the same
    // 5000-row runs sample crowded out low-frequency jobs (e.g. weekly
    // lessons-synthesize) and produced false-positive cron_silence findings.
    // v_automation_runs_latest_per_job returns at most one row per job, so
    // the sample is bounded by job count, not row count.
    const { data: latestPerJob } = await recordStep(sb, {
      job: "sentinel-tick", step_key: "db_scan:latest_per_job",
      request_id: reqId,
      step_label: "Scan latest run per monitored job", phase_kind: "db_scan",
    }, () => sb
      .from("v_automation_runs_latest_per_job")
      .select("job,id,status,created_at")
      .in("job", Object.keys(SENTINEL_CADENCES)));

    // Per-check timing: each check runs inside timeCheck() so we can attribute
    // duration, candidates, alerts, retries and queue depth back to a single
    // check function. Tagging each candidate with __check_key lets the persist
    // loop bump per-check counters as alerts fire.
    type PerCheck = {
      duration_ms: number; error: string | null;
      candidates_count: number; kinds: Set<string>;
      alerts: number; retries: number; open_depth: number;
    };
    const perCheck = new Map<string, PerCheck>();
    const tickId = crypto.randomUUID();
    const tagCandidates = (key: string, list: FindingCandidate[]): FindingCandidate[] => {
      for (const c of list) (c as unknown as { __check_key: string }).__check_key = key;
      return list;
    };
    const timeCheck = (key: string, fn: () => FindingCandidate[]): FindingCandidate[] => {
      const t0 = performance.now();
      let result: FindingCandidate[] = [];
      let err: string | null = null;
      try { result = fn(); }
      catch (e) { err = e instanceof Error ? e.message : String(e); }
      const dur = Math.round(performance.now() - t0);
      const kinds = new Set<string>();
      for (const c of result) kinds.add(c.kind);
      perCheck.set(key, {
        duration_ms: dur, error: err,
        candidates_count: result.length, kinds,
        alerts: 0, retries: 0, open_depth: 0,
      });
      return tagCandidates(key, result);
    };

    const candidates: FindingCandidate[] = await recordStep(sb, {
      job: "sentinel-tick", step_key: "compute:run_checks",
      request_id: reqId,
      step_label: "Run all in-memory sentinel checks", phase_kind: "compute",
      detail: { checks: 28 },
    }, async () => [
      ...timeCheck("five_xx_spike", () => checkFiveXxSpike(now, 15, edgeLogs)),
      ...timeCheck("edge_function_error_rate", () => checkEdgeFunctionErrorRate(now, 30, edgeLogs)),
      ...timeCheck("client_transport_error", () => checkClientTransportErrors(now, 30, cliRes.data ?? [])),
      ...timeCheck("voice_pipeline_red", () => checkVoicePipelineRed(now, 60, voiceEdgeRes.data ?? [])),
      ...timeCheck("secret_age", () => checkSecretAge(now, secretsRes.data ?? [])),
      ...timeCheck("role_grant", () => checkAdminGrants(now, 15, auditRes.data ?? [])),
      ...timeCheck("job_error_rate", () => checkJobErrorRate(now, runs)),
      ...timeCheck("frontend_realtime_error", () => checkFrontendRealtimeErrors(now, 30, feRes.data ?? [])),
      ...timeCheck("night_jobs_stalled", () => checkNightJobsStalled(now, reclaimResult)),
      ...timeCheck("allowlist_rejects", () => checkAllowlistRejects(now, allowRes.data ?? [])),
      ...timeCheck("whats_new_drafts_stale", () => checkWhatsNewDraftsStale(now, (draftRes.data ?? []) as { id: string; created_at: string }[])),
      ...timeCheck("lint_delta_failures", () => checkLintDeltaFailures(now, (lintRes.data ?? []) as { id: string; created_at: string; caller: string | null; file_path: string | null; error_class: string | null }[])),
      ...timeCheck("companion_streams_stalled", () => checkCompanionStreamsStalled(now, (stalledStreamsRes.data ?? []) as { id: string; thread_id: string | null; streamed_at: string | null; created_at: string }[])),
      ...timeCheck("heygen_videos_failed", () => checkHeygenVideosFailed(now, (heygenFailedRes.data ?? []) as { id: string; kind: string; error: string | null; created_at: string }[])),
      ...timeCheck("truth_conflicts_unresolved", () => checkTruthConflictsUnresolved(now, (truthConflictsRes.data ?? []) as { entity: string; entity_id: string; field: string; top_source: string | null; next_source: string | null }[])),
      ...timeCheck("budget_projection", () => checkBudgetProjection(
        now,
        (budgetSignalsRes.data ?? null) as { budget: number | null; burn_7d_per_day: number | null; projected_month_end: number | null } | null,
        (budgetAlertsRes.data ?? []) as { year_month: string; threshold_pct: number | null; kind?: string }[],
      )),
      ...timeCheck("credit_runway", () => checkCreditRunway(
        now,
        (runwayRes.data ?? null) as { balance: number | null; as_of: string | null; estimated_balance_now: number | null; burn_per_day_21d: number | null; days_runway_21d: number | null; runway_exhaustion_date_21d: string | null } | null,
        (budgetAlertsRes.data ?? []) as { year_month: string; threshold_pct: number | null; kind?: string }[],
      )),
      ...timeCheck("credit_snapshot_stale", () => checkCreditSnapshotStale(
        now,
        (snapshotAgeRes.data ?? null) as { latest_as_of: string | null; minutes_since_latest: number | null; snapshots_24h: number | null; entries_since_latest: number | null } | null,
        (budgetAlertsRes.data ?? []) as { year_month: string; threshold_pct: number | null; kind?: string }[],
      )),
      ...timeCheck("ai_jobs_stuck", () => checkAiJobsStuck(now, (aiJobsRes.data ?? []) as { id: string; kind: string; attempts: number | null; heartbeat_at: string | null; claimed_at: string | null }[])),
      ...timeCheck("ai_workers_offline", () => checkAiWorkersOffline(now, (aiWorkersRes.data ?? []) as { name: string; enabled: boolean; last_seen_at: string | null }[], aiQueueRes.count ?? 0)),
      ...timeCheck("telegram_webhook_silent", () => checkTelegramWebhookSilent(now, (tgWebhookRes.data as { created_at: string } | null)?.created_at ?? null, 12)),
      ...timeCheck("approvals_stale", () => checkApprovalsStale(now, (lastApprovalRes.data as { created_at: string } | null)?.created_at ?? null, 168)),
      ...timeCheck("secrets_health_stale", () => checkSecretsHealthStale(now, (lastSecretsOkRes.data as { created_at: string } | null)?.created_at ?? null)),
      ...timeCheck("cron_auth_failures_burst", () => checkCronAuthFailuresBurst(now, (authFailLogRes.data ?? []) as { job: string; reason: string; created_at: string }[])),
      ...timeCheck("inbox_kind_classify_failures", () => checkInboxKindClassifyFailures(now, (inboxClassifyRes.data ?? []) as { status: string | null; created_at: string }[])),
      ...timeCheck("inbox_source_silent", () => checkInboxSourceSilent(
        now,
        (inboxSourcesRes.data ?? []) as { id: string; label: string | null; chat_id: number | string }[],
        (inboxRecentRes.data ?? []) as { chat_id: number | string | null }[],
      )),
      ...timeCheck("out_of_scope_stale", () => checkOutOfScopeStale(
        now,
        (oosStaleRows ?? []) as { id: string; short_num: number; title: string; source: string; source_ref: string | null; created_at: string }[],
      )),
    ]);

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
          const r = await dispatchAlert(sb, "sentinel-tick", "high_finding", `${c.kind}: ${c.summary}`, c.payload);
          alerts++;
          const checkKey = (c as unknown as { __check_key?: string }).__check_key;
          if (checkKey) {
            const pc = perCheck.get(checkKey);
            if (pc) {
              pc.alerts += 1;
              pc.retries += Math.max(0, r.attempts - 1);
            }
          }
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

    // Per-check performance rows. Open depth uses the same `open` snapshot
    // we already fetched for auto-resolve, minus rows we just resolved.
    try {
      const wasResolved = (r: { dedupe_key: string; kind: string }) =>
        !liveKeys.has(r.dedupe_key) && r.kind !== "role_grant";
      const openByKind = new Map<string, number>();
      for (const r of (open ?? []) as { dedupe_key: string; kind: string }[]) {
        if (wasResolved(r)) continue;
        openByKind.set(r.kind, (openByKind.get(r.kind) ?? 0) + 1);
      }
      const rows: Array<Record<string, unknown>> = [];
      for (const [key, pc] of perCheck) {
        let depth = 0;
        for (const k of pc.kinds) depth += openByKind.get(k) ?? 0;
        rows.push({
          tick_id: tickId,
          check_key: key,
          duration_ms: pc.duration_ms,
          candidates_emitted: pc.candidates_count,
          alerts_dispatched: pc.alerts,
          alert_retries: pc.retries,
          open_depth_after: depth,
          error: pc.error,
        });
      }
      if (rows.length > 0) {
        await sb.from("sentinel_check_runs").insert(rows);
      }
    } catch (e) { console.error("sentinel_check_runs insert failed", e); }



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
