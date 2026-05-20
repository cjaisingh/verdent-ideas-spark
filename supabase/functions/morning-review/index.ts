// Morning Review: daily backlog hygiene snapshot upserted into public.morning_reviews.
// Triggered by cron at 06:00 UTC (scheduled-morning-review pg_cron job) or by
// an authenticated operator via POST. Deterministic — no AI calls.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { withLogger } from "../_shared/logger.ts";
import { dispatchAlert } from "../_shared/alerts.ts";
import {
  aggregate,
  DEFAULT_JOB_CADENCES,
  type AutomationRun,
  type DiscussionAction,
  type RoadmapTask,
  type Finding,
  type DeferredItem,
  type NightShift,
  type AiUsageRow,
} from "./aggregator.ts";
import { recordStep } from "../_shared/steps.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-service-token",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(withLogger("morning-review", async (req) => {
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

  const recordRun = async (
    status: string,
    status_code: number,
    message: string,
    detail: Record<string, unknown> = {},
  ) => {
    try {
      await sb.from("automation_runs").insert({
        job: "morning-review",
        trigger,
        status,
        status_code,
        duration_ms: Date.now() - startedAt,
        message,
        detail,
      });
    } catch (e) {
      console.error("automation_runs insert failed", e);
    }
  };

  if (!triggeredByCron && !auth.startsWith("Bearer ")) {
    await recordRun("error", 401, "Missing auth.");
    await dispatchAlert(sb, "morning-review", "auth_failed", "morning-review unauthorized");
    return json({ error: "unauthorized" }, 401);
  }

  try {
    const now = new Date();
    const since24h = new Date(now.getTime() - 24 * 3600 * 1000).toISOString();
    const sinceShifts = new Date(now.getTime() - 30 * 3600 * 1000).toISOString();

    // Fetch sources in parallel
    const [
      runsRes,
      actionsRes,
      findingsRes,
      sentinelRes,
      deferredRes,
      shiftsRes,
      aiRes,
    ] = await recordStep(sb, {
      job: "morning-review", step_key: "db_scan:sources",
      step_label: "Gather runs/actions/findings/shifts/ai", phase_kind: "db_scan",
    }, () => Promise.all([
      sb.from("automation_runs")
        .select("job,status,status_code,duration_ms,created_at")
        .gte("created_at", since24h),
      sb.from("discussion_actions")
        .select("id,short_num,title,status,priority,promoted_task_id,created_at,updated_at")
        .eq("status", "open")
        .limit(500),
      sb.from("roadmap_review_findings")
        .select("id,severity,category,title,acknowledged,created_at")
        .eq("acknowledged", false)
        .limit(200),
      sb.from("sentinel_findings")
        .select("id,severity,kind,summary,created_at,status")
        .eq("status", "open")
        .limit(200),
      sb.from("deferred_items")
        .select("id,title,severity,defer_until,status")
        .eq("status", "deferred"),
      sb.from("night_shifts")
        .select("id,status,window_start,window_end,summary")
        .gte("window_start", sinceShifts),
      sb.from("ai_usage_log")
        .select("cost_usd,created_at")
        .gte("created_at", since24h),
    ]);

    const recentRuns: AutomationRun[] = (runsRes.data ?? []) as AutomationRun[];
    const openActions: DiscussionAction[] = (actionsRes.data ?? []) as DiscussionAction[];
    const codeFindings: Finding[] = ((findingsRes.data ?? []) as Array<Record<string, unknown>>)
      .map((f) => ({
        id: String(f.id),
        severity: String(f.severity ?? "info"),
        category: (f.category as string | null) ?? null,
        title: String(f.title ?? ""),
        acknowledged: Boolean(f.acknowledged ?? false),
        created_at: String(f.created_at ?? new Date().toISOString()),
        source: "code_review" as const,
      }));
    const sentinelFindings: Finding[] = ((sentinelRes.data ?? []) as Array<Record<string, unknown>>)
      .map((f) => ({
        id: String(f.id),
        severity: String(f.severity ?? "info"),
        category: (f.kind as string | null) ?? null,
        title: String(f.summary ?? ""),
        acknowledged: false,
        created_at: String(f.created_at ?? new Date().toISOString()),
        source: "sentinel" as const,
      }));
    const findings = [...codeFindings, ...sentinelFindings];
    const deferred: DeferredItem[] = (deferredRes.data ?? []) as DeferredItem[];
    const shifts: NightShift[] = (shiftsRes.data ?? []) as NightShift[];
    const aiUsage: AiUsageRow[] = (aiRes.data ?? []) as AiUsageRow[];

    // Resolve promoted tasks for drift detection
    const promotedIds = openActions.map((a) => a.promoted_task_id).filter(Boolean) as string[];
    const promotedTasks: Record<string, RoadmapTask> = {};
    if (promotedIds.length) {
      const { data: tasks } = await sb.from("roadmap_tasks")
        .select("id,status,updated_at")
        .in("id", promotedIds);
      for (const t of (tasks ?? []) as RoadmapTask[]) promotedTasks[t.id] = t;
    }

    const out = aggregate({
      now,
      jobCadenceMinutes: DEFAULT_JOB_CADENCES,
      recentRuns,
      openActions,
      promotedTasks,
      findings,
      deferred,
      shifts,
      aiUsage,
    });

    const reviewDate = now.toISOString().slice(0, 10);
    const { error: upsertErr } = await sb.from("morning_reviews").upsert({
      review_date: reviewDate,
      kpis: out.kpis,
      stuck_jobs: out.stuck_jobs,
      promotion_drift: out.promotion_drift,
      night_throughput: out.night_throughput,
      open_findings: out.open_findings,
      top_actions: out.top_actions,
      revisit_items: out.revisit_items,
      generated_by: triggeredByCron ? "cron" : "manual",
    }, { onConflict: "review_date" });

    if (upsertErr) {
      await recordRun("error", 500, "upsert failed: " + upsertErr.message);
      await dispatchAlert(sb, "morning-review", "review_error", upsertErr.message);
      return json({ error: upsertErr.message }, 500);
    }

    await recordRun("ok", 200, `review for ${reviewDate}`, {
      stuck_jobs: out.stuck_jobs.length,
      drift: out.promotion_drift.length,
      findings: out.open_findings.length,
      actions: out.top_actions.length,
    });

    return json({ ok: true, review_date: reviewDate, summary: out });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await recordRun("error", 500, msg);
    await dispatchAlert(sb, "morning-review", "review_error", msg);
    return json({ error: msg }, 500);
  }
}));
