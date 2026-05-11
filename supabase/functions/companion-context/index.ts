// companion-context: returns a compact live AWIP state snapshot for the Companion to inject
// per-turn so the model knows what Lovable is working on, the operator's queue, and platform health.
// Auth: operator JWT only (read-only, never writes).
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { withLogger } from "../_shared/logger.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...corsHeaders, "Content-Type": "application/json" } });

// In-memory cache shared per function instance, ~30s TTL.
let cache: { at: number; data: unknown } | null = null;
const TTL_MS = 30_000;

Deno.serve(withLogger("companion-context", async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  // Auth: must be a signed-in operator/admin.
  const auth = req.headers.get("Authorization") ?? "";
  if (!auth.startsWith("Bearer ")) return json({ error: "unauthorized" }, 401);

  const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: auth } },
    auth: { persistSession: false },
  });
  const { data: u, error: ue } = await userClient.auth.getUser();
  if (ue || !u.user) return json({ error: "unauthorized" }, 401);
  const { data: roles } = await userClient.from("user_roles").select("role").eq("user_id", u.user.id);
  if (!roles?.some((r) => r.role === "operator" || r.role === "admin")) {
    return json({ error: "operator_required" }, 403);
  }

  // Cached?
  if (cache && Date.now() - cache.at < TTL_MS) {
    return json({ ok: true, cached: true, ...(cache.data as object) });
  }

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });
  const t0 = Date.now();
  const since24 = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
  const since7d = new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString();
  const today = new Date().toISOString().slice(0, 10);

  try {
    const [
      activeTasksR, recentChangesR, lastReviewR, overnightR,
      openActionsR, deferredR, pendingApprovalsR,
      morningR, sentinelR, deepAuditR, autoRunsR,
      cost24R, cost7dR,
      roadmapAggR,
    ] = await Promise.all([
      admin.from("roadmap_tasks")
        .select("id,key,title,owner,module,status,updated_at")
        .eq("status", "in_progress")
        .order("updated_at", { ascending: false }).limit(8),
      admin.from("roadmap_task_activity")
        .select("task_id,field,new_value,author_label,created_at")
        .order("created_at", { ascending: false }).limit(10),
      admin.from("automation_runs")
        .select("created_at,status,duration_ms,detail")
        .eq("job", "scheduled-code-review")
        .order("created_at", { ascending: false }).limit(1).maybeSingle(),
      admin.from("roadmap_phase_overnight_runs")
        .select("status,phase_key,scheduled_for,started_at,finished_at")
        .order("requested_at", { ascending: false }).limit(8),
      admin.from("discussion_actions")
        .select("short_num,title,priority,owner,source,night_eligible,created_at")
        .not("status", "in", "(done,rejected,cancelled)")
        .order("priority", { ascending: false })
        .order("created_at", { ascending: false }).limit(8),
      admin.from("deferred_items")
        .select("title,reason,severity,defer_until")
        .eq("status", "deferred")
        .lte("defer_until", today).limit(8),
      admin.from("approval_queue").select("id", { count: "exact", head: true })
        .eq("status", "pending"),
      admin.from("morning_reviews")
        .select("review_date,kpis,stuck_jobs,top_actions,open_findings")
        .order("review_date", { ascending: false }).limit(1).maybeSingle(),
      admin.from("sentinel_findings")
        .select("severity")
        .eq("status", "open"),
      admin.from("deep_audit_runs")
        .select("cadence,started_at,finished_at,status,summary")
        .order("started_at", { ascending: false }).limit(1).maybeSingle(),
      admin.from("automation_runs")
        .select("status,job")
        .gte("created_at", since24),
      admin.from("ai_usage_log").select("cost_usd").gte("created_at", since24),
      admin.from("ai_usage_log").select("cost_usd").gte("created_at", since7d),
      admin.from("roadmap_tasks").select("status"),
    ]);

    // Sentinel by severity
    const sevCounts = { critical: 0, high: 0, medium: 0, low: 0, info: 0 };
    for (const r of sentinelR.data ?? []) {
      const k = (r as { severity: string }).severity as keyof typeof sevCounts;
      if (k in sevCounts) sevCounts[k]++;
    }

    // Automation 24h
    const runs24 = autoRunsR.data ?? [];
    const fail24 = runs24.filter((r) => r.status !== "ok" && r.status !== "success").length;

    // Cost
    const sum = (rows: { cost_usd: number | null }[] | null) =>
      Number(((rows ?? []).reduce((s, r) => s + Number(r.cost_usd ?? 0), 0)).toFixed(4));

    // Roadmap aggregate
    const roadmap = { in_progress: 0, todo: 0, blocked: 0, done: 0 };
    for (const r of roadmapAggR.data ?? []) {
      const s = (r as { status: string }).status;
      if (s in roadmap) (roadmap as Record<string, number>)[s]++;
    }

    // Overnight buckets
    const overnight = {
      queued: 0, running: 0, last_run: null as null | { phase_key: string; status: string; finished_at: string | null },
    };
    for (const r of overnightR.data ?? []) {
      if (r.status === "queued") overnight.queued++;
      if (r.status === "running") overnight.running++;
    }
    const lastDone = (overnightR.data ?? []).find((r) => r.status !== "queued" && r.status !== "running");
    if (lastDone) overnight.last_run = { phase_key: lastDone.phase_key, status: lastDone.status, finished_at: lastDone.finished_at };

    // Last code-review summary
    const lastCodeReview = lastReviewR.data
      ? {
          ran_at: lastReviewR.data.created_at,
          status: lastReviewR.data.status,
          duration_ms: lastReviewR.data.duration_ms,
          findings: (lastReviewR.data.detail as { findings_inserted?: number } | null)?.findings_inserted ?? null,
          severity_counts: (lastReviewR.data.detail as { severity_counts?: Record<string, number> } | null)?.severity_counts ?? null,
        }
      : null;

    const data = {
      generated_at: new Date().toISOString(),
      window_hours: 24,
      built_in_ms: Date.now() - t0,
      lovable_focus: {
        active_tasks: activeTasksR.data ?? [],
        recent_changes: recentChangesR.data ?? [],
        last_code_review: lastCodeReview,
        overnight,
      },
      operator_queue: {
        open_actions: openActionsR.data ?? [],
        deferred_due_today: deferredR.data ?? [],
        pending_approvals: pendingApprovalsR.count ?? 0,
      },
      health: {
        last_morning_review: morningR.data ?? null,
        sentinel_open: sevCounts,
        deep_audit_latest: deepAuditR.data ?? null,
        automation_24h: {
          runs: runs24.length,
          failures: fail24,
        },
        ai_cost_24h_usd: sum(cost24R.data),
        ai_cost_7d_usd: sum(cost7dR.data),
      },
      roadmap_summary: roadmap,
    };
    cache = { at: Date.now(), data };
    return json({ ok: true, cached: false, ...data });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : "snapshot_failed" }, 500);
  }
}));
