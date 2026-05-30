// Nightly analytics rollup. Runs at 23:00 UTC daily.
// Backfills the last 7 days into:
//   analytics_daily_ai_usage  (per job + model)
//   analytics_daily_automation (per job)
//   analytics_daily_cost      (per day total)
//
// Idempotent: each row is unique on (rollup_date [, job, model]) and we upsert.
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

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status, headers: { ...cors, "Content-Type": "application/json" },
  });
}

function pct(arr: number[], p: number): number | null {
  if (!arr.length) return null;
  const sorted = [...arr].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return Math.round(sorted[idx]);
}

function dayBounds(d: Date): { from: string; to: string; date: string } {
  const start = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 0, 0, 0));
  const end = new Date(start.getTime() + 24 * 3600 * 1000);
  return {
    from: start.toISOString(),
    to: end.toISOString(),
    date: start.toISOString().slice(0, 10),
  };
}

Deno.serve(withLogger("nightly-rollup-analytics", async (req, ctx) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });

  const sb = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
  const { requireCronOrOperator } = await import("../_shared/operator-auth.ts");
  const authRes = await requireCronOrOperator(req);
  const trigger = authRes.ok && authRes.triggeredByCron ? "cron" : "manual";
  const startedAt = Date.now();

  if (!authRes.ok) {
    if (authRes.status === 401) {
      await dispatchAlert(sb, "nightly-rollup-analytics", "auth_failed", "rollup-analytics 401");
    }
    return json({ error: authRes.error }, authRes.status);
  }

  try {
    const url = new URL(req.url);
    const days = Math.min(30, Math.max(1, Number(url.searchParams.get("days") ?? 7)));
    const targets: { from: string; to: string; date: string }[] = [];
    const now = new Date();
    for (let i = 0; i < days; i++) {
      const d = new Date(now.getTime() - i * 24 * 3600 * 1000);
      targets.push(dayBounds(d));
    }

    let aiRows = 0, autoRows = 0, costRows = 0;

    for (const day of targets) {
      // ---- analytics_daily_ai_usage ----
      const { data: ai } = await sb
        .from("ai_usage_log")
        .select("job, model, status, cost_usd, prompt_tokens, completion_tokens, latency_ms")
        .gte("created_at", day.from).lt("created_at", day.to)
        .limit(10000);

      const aiBuckets = new Map<string, { job: string; model: string; calls: number; errors: number; cost: number; pt: number; ct: number; lats: number[] }>();
      for (const r of ai ?? []) {
        const k = `${r.job}::${r.model}`;
        const b = aiBuckets.get(k) ?? { job: r.job, model: r.model, calls: 0, errors: 0, cost: 0, pt: 0, ct: 0, lats: [] as number[] };
        b.calls++;
        if (r.status !== "ok") b.errors++;
        b.cost += Number(r.cost_usd ?? 0);
        b.pt += Number(r.prompt_tokens ?? 0);
        b.ct += Number(r.completion_tokens ?? 0);
        if (r.latency_ms != null) b.lats.push(Number(r.latency_ms));
        aiBuckets.set(k, b);
      }

      const aiUpserts = [...aiBuckets.values()].map((b) => ({
        rollup_date: day.date,
        job: b.job, model: b.model,
        calls: b.calls, errors: b.errors,
        cost_usd: Number(b.cost.toFixed(6)),
        prompt_tokens: b.pt, completion_tokens: b.ct,
        p50_latency_ms: pct(b.lats, 50),
        p95_latency_ms: pct(b.lats, 95),
        computed_at: new Date().toISOString(),
      }));
      if (aiUpserts.length) {
        const { error } = await sb.from("analytics_daily_ai_usage")
          .upsert(aiUpserts, { onConflict: "rollup_date,job,model" });
        if (error) throw error;
        aiRows += aiUpserts.length;
      }

      // ---- analytics_daily_automation ----
      const { data: au } = await sb
        .from("automation_runs")
        .select("job, status, duration_ms")
        .gte("created_at", day.from).lt("created_at", day.to)
        .limit(20000);

      const autoBuckets = new Map<string, { runs: number; errors: number; durs: number[] }>();
      for (const r of au ?? []) {
        const b = autoBuckets.get(r.job) ?? { runs: 0, errors: 0, durs: [] as number[] };
        b.runs++;
        if (r.status === "error" || r.status === "failed") b.errors++;
        if (r.duration_ms != null) b.durs.push(Number(r.duration_ms));
        autoBuckets.set(r.job, b);
      }
      const autoUpserts = [...autoBuckets.entries()].map(([job, b]) => ({
        rollup_date: day.date,
        job,
        runs: b.runs, errors: b.errors,
        error_rate: b.runs ? Number((b.errors / b.runs).toFixed(4)) : 0,
        avg_duration_ms: b.durs.length ? Math.round(b.durs.reduce((a, c) => a + c, 0) / b.durs.length) : null,
        p95_duration_ms: pct(b.durs, 95),
        computed_at: new Date().toISOString(),
      }));
      if (autoUpserts.length) {
        const { error } = await sb.from("analytics_daily_automation")
          .upsert(autoUpserts, { onConflict: "rollup_date,job" });
        if (error) throw error;
        autoRows += autoUpserts.length;
      }

      // ---- analytics_daily_cost (rollup of rollup) ----
      const totalCost = aiUpserts.reduce((acc, r) => acc + Number(r.cost_usd), 0);
      const totalCalls = aiUpserts.reduce((acc, r) => acc + r.calls, 0);
      const totalErrors = aiUpserts.reduce((acc, r) => acc + r.errors, 0);
      const top = [...aiBuckets.values()].sort((a, b) => b.cost - a.cost)[0];

      const { error: costErr } = await sb.from("analytics_daily_cost").upsert([{
        rollup_date: day.date,
        ai_cost_usd: Number(totalCost.toFixed(6)),
        ai_calls: totalCalls,
        ai_errors: totalErrors,
        top_job: top?.job ?? null,
        top_job_cost_usd: top ? Number(top.cost.toFixed(6)) : null,
        computed_at: new Date().toISOString(),
      }], { onConflict: "rollup_date" });
      if (costErr) throw costErr;
      costRows++;
    }

    ctx.attach("days", days);
    ctx.attach("ai_rows", aiRows);
    ctx.attach("auto_rows", autoRows);

    await sb.from("automation_runs").insert({
      job: "nightly-rollup-analytics", trigger, status: "ok", status_code: 200,
      duration_ms: Date.now() - startedAt,
      message: `Rolled up ${days} day(s)`,
      detail: { days, ai_rows: aiRows, auto_rows: autoRows, cost_rows: costRows },
    });

    return json({ ok: true, days, ai_rows: aiRows, auto_rows: autoRows, cost_rows: costRows });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await sb.from("automation_runs").insert({
      job: "nightly-rollup-analytics", trigger, status: "error", status_code: 500,
      duration_ms: Date.now() - startedAt, message: msg, detail: {},
    });
    await dispatchAlert(sb, "nightly-rollup-analytics", "review_error", msg);
    return json({ error: msg }, 500);
  }
}));
