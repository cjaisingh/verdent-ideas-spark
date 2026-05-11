// Tomorrow Plan refresh: walk every item in a plan and update `auto_done`
// based on the live state of its source (sentinel finding / discussion_action / cron).
// Also recomputes success_criteria[].met using the same rules.
// Auth: operator JWT or x-awip-service-token header.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { withLogger } from "../_shared/logger.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-service-token, x-awip-service-token",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

type Item = {
  id: string;
  source_kind: "sentinel_finding" | "discussion_action" | "cron" | "manual";
  source_ref: string | null;
  auto_done: boolean | null;
  manual_done: boolean;
};

type Criterion = {
  label: string;
  source_kind?: string;
  source_ref?: string;
  met?: boolean;
};

Deno.serve(withLogger("tomorrow-plan-refresh", async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const SERVICE_TOKEN = Deno.env.get("AWIP_SERVICE_TOKEN");
  const sb = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });

  const provided =
    req.headers.get("x-awip-service-token") ?? req.headers.get("x-service-token");
  const auth = req.headers.get("authorization") ?? "";
  const triggeredByCron = !!SERVICE_TOKEN && provided === SERVICE_TOKEN;
  const trigger = triggeredByCron ? "cron" : "manual";
  const startedAt = Date.now();

  const recordRun = async (status: string, status_code: number, message: string, detail: Record<string, unknown> = {}) => {
    try {
      await sb.from("automation_runs").insert({
        job: "tomorrow-plan-refresh",
        trigger, status, status_code,
        duration_ms: Date.now() - startedAt,
        message, detail,
      });
    } catch (e) { console.error("automation_runs insert failed", e); }
  };

  if (!triggeredByCron && !auth.startsWith("Bearer ")) {
    await recordRun("error", 401, "Missing auth.");
    return json({ error: "unauthorized" }, 401);
  }

  let body: { plan_id?: string; plan_date?: string } = {};
  try { body = await req.json(); } catch { /* empty body ok */ }

  try {
    // Resolve target plan(s) — by id, by date, or all active
    let plansQ = sb.from("tomorrow_plans").select("id, plan_date, success_criteria, status").eq("status", "active");
    if (body.plan_id) plansQ = sb.from("tomorrow_plans").select("id, plan_date, success_criteria, status").eq("id", body.plan_id);
    else if (body.plan_date) plansQ = sb.from("tomorrow_plans").select("id, plan_date, success_criteria, status").eq("plan_date", body.plan_date);
    const { data: plans, error: plansErr } = await plansQ;
    if (plansErr) throw plansErr;
    if (!plans || plans.length === 0) {
      await recordRun("ok", 200, "No active plan to refresh.", { trigger });
      return json({ refreshed: 0, plans: [] });
    }

    // Cache lookups
    const since24h = new Date(Date.now() - 24 * 3600 * 1000).toISOString();

    // Pre-fetch open sentinel findings & action statuses & cron successes for all referenced sources
    const allBlocksRes = await sb.from("tomorrow_plan_blocks").select("id, plan_id").in("plan_id", plans.map((p) => p.id));
    const blockIds = (allBlocksRes.data ?? []).map((b: any) => b.id);
    const blockToPlan = new Map<string, string>((allBlocksRes.data ?? []).map((b: any) => [b.id, b.plan_id]));

    const itemsRes = await sb.from("tomorrow_plan_items")
      .select("id, block_id, source_kind, source_ref, auto_done, manual_done")
      .in("block_id", blockIds.length ? blockIds : ["00000000-0000-0000-0000-000000000000"]);
    const items: (Item & { block_id: string })[] = (itemsRes.data ?? []) as any;

    const sentinelRefs = [...new Set(items.filter((i) => i.source_kind === "sentinel_finding" && i.source_ref).map((i) => i.source_ref!))];
    const actionRefs = [...new Set(items.filter((i) => i.source_kind === "discussion_action" && i.source_ref).map((i) => i.source_ref!))];
    const cronRefs = [...new Set(items.filter((i) => i.source_kind === "cron" && i.source_ref).map((i) => i.source_ref!))];

    // Add success-criteria sources too
    for (const p of plans) {
      const crits = (p.success_criteria as Criterion[] | null) ?? [];
      for (const c of crits) {
        if (c.source_ref) {
          if (c.source_kind === "sentinel_finding") sentinelRefs.push(c.source_ref);
          if (c.source_kind === "discussion_action") actionRefs.push(c.source_ref);
          if (c.source_kind === "cron") cronRefs.push(c.source_ref);
        }
      }
    }

    const [openSentinels, actions, cronRuns] = await Promise.all([
      sentinelRefs.length
        ? sb.from("sentinel_findings").select("id, status").in("id", sentinelRefs)
        : Promise.resolve({ data: [] as any[], error: null }),
      actionRefs.length
        ? sb.from("discussion_actions").select("id, status").in("id", actionRefs)
        : Promise.resolve({ data: [] as any[], error: null }),
      cronRefs.length
        ? sb.from("automation_runs").select("job, status, created_at").in("job", cronRefs).gte("created_at", since24h)
        : Promise.resolve({ data: [] as any[], error: null }),
    ]);

    const sentinelById = new Map<string, string>(((openSentinels.data ?? []) as any[]).map((r) => [r.id, r.status]));
    const actionById = new Map<string, string>(((actions.data ?? []) as any[]).map((r) => [r.id, r.status]));
    const cronOk = new Set<string>(
      ((cronRuns.data ?? []) as any[])
        .filter((r) => r.status === "ok" || r.status === "success" || (typeof r.status === "string" && r.status.toLowerCase() === "ok"))
        .map((r) => r.job),
    );

    function evalSource(kind: string, ref?: string | null): boolean | null {
      if (!ref) return null;
      if (kind === "sentinel_finding") {
        const s = sentinelById.get(ref);
        // resolved or row missing → done
        return s === undefined ? true : s === "resolved";
      }
      if (kind === "discussion_action") {
        const s = actionById.get(ref);
        return s === undefined ? true : ["done", "cancelled", "blocked"].includes(s);
      }
      if (kind === "cron") return cronOk.has(ref);
      return null;
    }

    // Update items whose auto_done changed
    let updated = 0;
    const updates: Promise<unknown>[] = [];
    for (const it of items) {
      if (it.source_kind === "manual") continue;
      const next = evalSource(it.source_kind, it.source_ref);
      if (next !== it.auto_done) {
        updated++;
        updates.push(
          sb.from("tomorrow_plan_items")
            .update({ auto_done: next })
            .eq("id", it.id),
        );
      }
    }

    // Recompute success_criteria.met per plan
    for (const p of plans) {
      const crits = ((p.success_criteria as Criterion[] | null) ?? []).map((c) => {
        const met = c.source_kind && c.source_kind !== "manual"
          ? evalSource(c.source_kind, c.source_ref ?? null) ?? false
          : c.met ?? false;
        return { ...c, met };
      });
      updates.push(
        sb.from("tomorrow_plans").update({ success_criteria: crits }).eq("id", p.id),
      );
    }

    await Promise.all(updates);
    await recordRun("ok", 200, "Refresh complete.", {
      plans: plans.length, items: items.length, items_updated: updated,
    });

    return json({
      refreshed: plans.length,
      items_checked: items.length,
      items_updated: updated,
      plans: plans.map((p) => p.id),
    });
  } catch (e) {
    console.error(e);
    await recordRun("error", 500, e instanceof Error ? e.message : "unknown");
    return json({ error: e instanceof Error ? e.message : "unknown" }, 500);
  }
}));
