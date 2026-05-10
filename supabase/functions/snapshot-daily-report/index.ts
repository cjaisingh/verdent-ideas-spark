// Daily snapshot report. Runs at 23:30 UTC daily.
// Writes one row per kind (system + contract) into public.daily_snapshots,
// keyed by snapshot_date so re-runs upsert.
//
// Auth: AWIP_SERVICE_TOKEN cron header, OR an authenticated operator JWT.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.0";
import { withLogger } from "../_shared/logger.ts";
import { dispatchAlert } from "../_shared/alerts.ts";
import { pickModel } from "../_shared/model-policy.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const SERVICE_TOKEN = Deno.env.get("AWIP_SERVICE_TOKEN") ?? "";
const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY") ?? "";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-service-token, content-type, x-request-id",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });

async function aiBrief(summaryText: string): Promise<{ brief: string; model: string; cost: number }> {
  if (!LOVABLE_API_KEY) return { brief: "", model: "", cost: 0 };
  const model = pickModel("google/gemini-2.5-flash");
  try {
    const resp = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${LOVABLE_API_KEY}` },
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: "You are AWIP's overnight summarizer. Be terse, factual, max 4 sentences. No bullet points, no markdown headers." },
          { role: "user", content: `Summarize the AWIP daily snapshot below for an operator reading at 06:00 UTC. Surface what changed, what's red, and what to look at first.\n\n${summaryText}` },
        ],
      }),
    });
    if (!resp.ok) return { brief: "", model, cost: 0 };
    const data = await resp.json();
    const brief = data?.choices?.[0]?.message?.content ?? "";
    const usage = data?.usage ?? {};
    // Approx cost — actual cost is logged by ai_usage_log if a wrapper is used; here we just record 0 + model.
    const cost = Number(usage?.total_tokens ?? 0) * 0.0000001;
    return { brief, model, cost };
  } catch {
    return { brief: "", model, cost: 0 };
  }
}

async function buildSystemSnapshot(sb: ReturnType<typeof createClient>, since: string): Promise<{ payload: Record<string, unknown>; summary: string }> {
  const [runsRes, aiRes, sentRes, defRes, audRes] = await Promise.all([
    sb.from("automation_runs").select("job,status,duration_ms").gte("created_at", since).limit(5000),
    sb.from("ai_usage_log").select("job,cost_usd,status").gte("created_at", since).limit(5000),
    sb.from("sentinel_findings").select("severity,title").is("resolved_at", null).limit(500),
    sb.from("deferred_items").select("id").lte("defer_until", new Date().toISOString().slice(0, 10)).eq("status", "deferred").limit(500),
    sb.from("deep_audit_runs").select("status,started_at").gte("started_at", since).order("started_at", { ascending: false }).limit(5),
  ]);

  const runs = runsRes.data ?? [];
  const ai = aiRes.data ?? [];
  const sent = sentRes.data ?? [];
  const deferred = defRes.data ?? [];

  const totalRuns = runs.length;
  const errorRuns = runs.filter((r: any) => r.status === "error" || r.status === "failed").length;
  const errorRate = totalRuns ? errorRuns / totalRuns : 0;
  const aiCost = ai.reduce((acc: number, r: any) => acc + Number(r.cost_usd ?? 0), 0);
  const aiCalls = ai.length;
  const sentBySev = sent.reduce<Record<string, number>>((acc: any, f: any) => {
    acc[f.severity] = (acc[f.severity] ?? 0) + 1; return acc;
  }, {});

  const payload = {
    automation: { total_runs: totalRuns, error_runs: errorRuns, error_rate: Number(errorRate.toFixed(3)) },
    ai: { calls: aiCalls, cost_usd: Number(aiCost.toFixed(4)) },
    sentinel_open: sentBySev,
    deferred_due_today: deferred.length,
    last_audits: audRes.data ?? [],
  };
  const summary = `System (24h): ${totalRuns} automation runs, ${errorRuns} errors (${(errorRate * 100).toFixed(1)}%). AI: ${aiCalls} calls, $${aiCost.toFixed(4)}. Open sentinel: ${JSON.stringify(sentBySev)}. Deferred items due today: ${deferred.length}.`;
  return { payload, summary };
}

async function buildContractSnapshot(sb: ReturnType<typeof createClient>, since: string): Promise<{ payload: Record<string, unknown>; summary: string }> {
  const [okrRes, capRes, drRes] = await Promise.all([
    sb.from("okr_node_events").select("event_type").gte("created_at", since).limit(5000),
    sb.from("capability_events").select("event_type, capability_id").gte("created_at", since).limit(5000),
    // Drift: open promoted actions not done after 72h
    sb.from("discussion_actions")
      .select("id,promoted_task_id,status,updated_at")
      .not("promoted_task_id", "is", null)
      .neq("status", "done")
      .lte("updated_at", new Date(Date.now() - 72 * 3600 * 1000).toISOString())
      .limit(500),
  ]);

  const okrCounts = (okrRes.data ?? []).reduce<Record<string, number>>((a: any, r: any) => {
    a[r.event_type] = (a[r.event_type] ?? 0) + 1; return a;
  }, {});
  const capCounts = (capRes.data ?? []).reduce<Record<string, number>>((a: any, r: any) => {
    a[r.event_type] = (a[r.event_type] ?? 0) + 1; return a;
  }, {});
  const drift = (drRes.data ?? []).length;

  const payload = { okr_events: okrCounts, capability_events: capCounts, promotion_drift_count: drift };
  const summary = `Contract (24h): OKR mutations ${JSON.stringify(okrCounts)}; capability events ${JSON.stringify(capCounts)}; promoted-but-not-done >72h: ${drift}.`;
  return { payload, summary };
}

Deno.serve(withLogger("snapshot-daily-report", async (req, ctx) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });

  const sb = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
  const provided = req.headers.get("x-service-token");
  const auth = req.headers.get("authorization") ?? "";
  const triggeredByCron = !!SERVICE_TOKEN && provided === SERVICE_TOKEN;
  const trigger = triggeredByCron ? "cron" : "manual";
  const startedAt = Date.now();

  if (!triggeredByCron && !auth.startsWith("Bearer ")) {
    await dispatchAlert(sb, "snapshot-daily-report", "auth_failed", "snapshot 401");
    return json({ error: "unauthorized" }, 401);
  }

  try {
    const today = new Date().toISOString().slice(0, 10);
    const since = new Date(Date.now() - 24 * 3600 * 1000).toISOString();

    const sys = await buildSystemSnapshot(sb, since);
    const contract = await buildContractSnapshot(sb, since);

    const sysAi = await aiBrief(sys.summary);
    const conAi = await aiBrief(contract.summary);

    const upserts = [
      {
        snapshot_date: today, kind: "system",
        payload: sys.payload, summary: sys.summary,
        ai_brief: sysAi.brief || null, ai_model: sysAi.model || null,
        ai_cost_usd: sysAi.cost || null,
        generated_at: new Date().toISOString(),
      },
      {
        snapshot_date: today, kind: "contract",
        payload: contract.payload, summary: contract.summary,
        ai_brief: conAi.brief || null, ai_model: conAi.model || null,
        ai_cost_usd: conAi.cost || null,
        generated_at: new Date().toISOString(),
      },
    ];
    const { error } = await sb.from("daily_snapshots").upsert(upserts, { onConflict: "snapshot_date,kind" });
    if (error) throw error;

    ctx.attach("snapshot_date", today);
    await sb.from("automation_runs").insert({
      job: "snapshot-daily-report", trigger, status: "ok", status_code: 200,
      duration_ms: Date.now() - startedAt,
      message: `Snapshots written for ${today}`,
      detail: { date: today, kinds: ["system", "contract"] },
    });
    return json({ ok: true, snapshot_date: today });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await sb.from("automation_runs").insert({
      job: "snapshot-daily-report", trigger, status: "error", status_code: 500,
      duration_ms: Date.now() - startedAt, message: msg, detail: {},
    });
    await dispatchAlert(sb, "snapshot-daily-report", "review_error", msg);
    return json({ error: msg }, 500);
  }
}));
