// Sentinel Agent — runs every 15 min; writes to public.sentinel_findings.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { withLogger } from "../_shared/logger.ts";
import { dispatchAlert } from "../_shared/alerts.ts";
import {
  checkCronSilence, checkFiveXxSpike, checkSecretAge, checkAdminGrants, checkJobErrorRate,
  checkFrontendRealtimeErrors, checkEdgeFunctionErrorRate, checkClientTransportErrors,
  checkVoicePipelineRed, checkNightJobsStalled, checkAllowlistRejects,
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

    const [runsRes, edgeRes, voiceEdgeRes, secretsRes, auditRes, feRes, cliRes, allowRes] = await Promise.all([
      sb.from("automation_runs").select("id,job,status,created_at").gte("created_at", since15d),
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
        .gte("created_at", new Date(now.getTime() - 24 * 3600 * 1000).toISOString())
        .limit(2000),
    ]);

    // Slice 1: reclaim stalled night workers (10-min staleness threshold).
    let reclaimResult: Record<string, number> = {};
    try {
      const { data: r } = await sb.rpc("reclaim_stale_night_jobs", { _stale_minutes: 10 });
      reclaimResult = (r as Record<string, number>) ?? {};
    } catch (e) {
      console.error("reclaim_stale_night_jobs failed", e);
    }

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
    ];

    let inserted = 0, updated = 0, alerts = 0;
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
        await sb.from("sentinel_findings").insert({
          kind: c.kind, severity: c.severity, summary: c.summary,
          dedupe_key: c.dedupe_key, subject_ref: c.subject_ref, payload: c.payload,
          status: "open",
        });
        inserted++;
        if (c.severity === "high" || c.severity === "critical") {
          await dispatchAlert(sb, "sentinel-tick", "high_finding", `${c.kind}: ${c.summary}`, c.payload);
          alerts++;
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

    await recordRun("ok", 200, `tick: ${inserted}+ ${updated}~ ${resolved}✓`, {
      inserted, updated, resolved, alerts, candidates: candidates.length,
    });
    return json({ ok: true, inserted, updated, resolved, alerts });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await recordRun("error", 500, msg);
    await dispatchAlert(sb, "sentinel-tick", "review_error", msg);
    return json({ error: msg }, 500);
  }
}));
