// Cache-warm job. Runs at 00:00 UTC daily. Touches the heaviest read RPCs
// using the service role so morning loads are instant. Each touch is logged
// to public.cache_warm_runs.
//
// Auth: AWIP_SERVICE_TOKEN cron header, OR an authenticated operator JWT.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.0";
import { withLogger } from "../_shared/logger.ts";
import { dispatchAlert } from "../_shared/alerts.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const SERVICE_TOKEN = Deno.env.get("AWIP_SERVICE_TOKEN") ?? "";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-service-token, content-type, x-request-id",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });

type Touch = { route: string; fn: () => Promise<void> };

Deno.serve(withLogger("cache-warm", async (req, ctx) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });

  const sb = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
  const provided = req.headers.get("x-service-token");
  const auth = req.headers.get("authorization") ?? "";
  const triggeredByCron = !!SERVICE_TOKEN && provided === SERVICE_TOKEN;
  const trigger = triggeredByCron ? "cron" : "manual";
  const startedAt = Date.now();

  if (!triggeredByCron && !auth.startsWith("Bearer ")) {
    await dispatchAlert(sb, "cache-warm", "auth_failed", "cache-warm 401");
    return json({ error: "unauthorized" }, 401);
  }

  // Each touch is a small read meant to pre-warm Postgres plan cache + edge module cache.
  const touches: Touch[] = [
    { route: "automation_runs:24h", fn: async () => { await sb.from("automation_runs").select("id").gte("created_at", new Date(Date.now() - 86_400_000).toISOString()).limit(500); } },
    { route: "ai_usage_log:24h", fn: async () => { await sb.from("ai_usage_log").select("id").gte("created_at", new Date(Date.now() - 86_400_000).toISOString()).limit(500); } },
    { route: "sentinel_findings:open", fn: async () => { await sb.from("sentinel_findings").select("id").is("resolved_at", null).limit(200); } },
    { route: "discussion_actions:open", fn: async () => { await sb.from("discussion_actions").select("id").eq("status", "open").limit(200); } },
    { route: "deep_audit_runs:recent", fn: async () => { await sb.from("deep_audit_runs").select("id").order("started_at", { ascending: false }).limit(20); } },
    { route: "morning_reviews:recent", fn: async () => { await sb.from("morning_reviews").select("id").order("review_date", { ascending: false }).limit(7); } },
    { route: "daily_snapshots:recent", fn: async () => { await sb.from("daily_snapshots").select("id").order("snapshot_date", { ascending: false }).limit(14); } },
    { route: "analytics_daily_cost:30d", fn: async () => { await sb.from("analytics_daily_cost").select("rollup_date").gte("rollup_date", new Date(Date.now() - 30 * 86_400_000).toISOString().slice(0, 10)).limit(60); } },
  ];

  const results: Record<string, unknown>[] = [];
  let oks = 0, fails = 0;

  for (const t of touches) {
    const tStart = Date.now();
    try {
      await t.fn();
      const dur = Date.now() - tStart;
      results.push({ route: t.route, ms: dur, ok: true });
      oks++;
      await sb.from("cache_warm_runs").insert({ route: t.route, started_at: new Date(tStart).toISOString(), duration_ms: dur, ok: true });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      const dur = Date.now() - tStart;
      results.push({ route: t.route, ms: dur, ok: false, error: msg });
      fails++;
      await sb.from("cache_warm_runs").insert({ route: t.route, started_at: new Date(tStart).toISOString(), duration_ms: dur, ok: false, error: msg });
    }
  }

  ctx.attach("touches", touches.length);
  ctx.attach("ok", oks);
  ctx.attach("fail", fails);

  await sb.from("automation_runs").insert({
    job: "cache-warm", trigger,
    status: fails === 0 ? "ok" : "error", status_code: fails === 0 ? 200 : 500,
    duration_ms: Date.now() - startedAt,
    message: `Warmed ${oks}/${touches.length} routes`,
    detail: { results },
  });

  return json({ ok: fails === 0, results });
}));
