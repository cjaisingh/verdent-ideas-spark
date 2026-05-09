// Overnight daily plan.
// Pulls open roadmap tasks, recent work-log activity, unresolved findings,
// failing QA probes, recent test runs, and pinned notebook entries; asks GPT-5
// (via Lovable AI Gateway) to produce a focus + 3-7 prioritised tasks for the day,
// plus risks and recommendations. Result stored in `daily_plans` (one per day).

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { pickModel, isNightUTC } from "../_shared/model-policy.ts";
import { withLogger } from "../_shared/logger.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-service-token",
};

const PLANNER_DAYTIME_MODEL = "google/gemini-2.5-flash-lite";

// USD per 1M tokens — Lovable AI Gateway list prices. Keep in sync with src/lib/aiPricing.ts.
const PRICING: Record<string, { in: number; out: number }> = {
  "google/gemini-2.5-flash-lite": { in: 0.10, out: 0.40 },
  "google/gemini-2.5-flash": { in: 0.30, out: 2.50 },
  "google/gemini-2.5-pro": { in: 1.25, out: 10.00 },
  "openai/gpt-5-nano": { in: 0.05, out: 0.40 },
  "openai/gpt-5-mini": { in: 0.25, out: 2.00 },
  "openai/gpt-5": { in: 1.25, out: 10.00 },
};
function priceFor(model: string) {
  return PRICING[model] ?? { in: 0, out: 0 };
}
function costUsd(model: string, promptTok: number, completionTok: number) {
  const p = priceFor(model);
  return (promptTok / 1_000_000) * p.in + (completionTok / 1_000_000) * p.out;
}

Deno.serve(withLogger("daily-plan", async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY")!;
    const SERVICE_TOKEN = Deno.env.get("AWIP_SERVICE_TOKEN");

    const provided = req.headers.get("x-service-token");
    const auth = req.headers.get("authorization") ?? "";
    const triggeredByCron = !!SERVICE_TOKEN && provided === SERVICE_TOKEN;
    const trigger = triggeredByCron ? "cron" : "manual";

    const sb = createClient(SUPABASE_URL, SERVICE_ROLE);
    const startedAt = Date.now();
    const recordRun = async (status: string, status_code: number, message: string, detail: Record<string, unknown> = {}) => {
      try {
        await sb.from("automation_runs").insert({
          job: "daily-plan", trigger, status, status_code,
          duration_ms: Date.now() - startedAt, message, detail,
        });
      } catch (e) { console.error("automation_runs insert failed", e); }
    };
    const maybeAlert = async (reason: string, message: string, payload: Record<string, unknown> = {}) =>
      dispatchAlert(sb, "daily-plan", reason, message, payload);

    if (!triggeredByCron && !auth.startsWith("Bearer ")) {
      await recordRun("error", 401, "Missing service token and no Authorization header.");
      return json({ error: "unauthorized" }, 401);
    }
    if (!LOVABLE_API_KEY) {
      await recordRun("error", 500, "LOVABLE_API_KEY secret is missing.");
      return json({ error: "missing_lovable_api_key" }, 500);
    }

    const sinceISO = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const today = new Date().toISOString().slice(0, 10);

    // Night-cheap policy: 22:00–06:00 UTC forces gemini-2.5-flash-lite (already the default here).
    const PLANNER_MODEL = pickModel(PLANNER_DAYTIME_MODEL);
    const NIGHT_MODE = isNightUTC();

    const [phases, sprints, tasks, workLog, findings, qa, testRuns, notebook] = await Promise.all([
      sb.from("roadmap_phases").select("key, title, status, summary, order").order("order"),
      sb.from("roadmap_sprints").select("key, phase_id, title, status, goal, order").order("order"),
      sb.from("roadmap_tasks").select("key, sprint_id, title, status, owner, module, description, acceptance, order").neq("status", "done").order("order"),
      sb.from("roadmap_work_log").select("created_at, source, summary, issues, fixes, duration_ms")
        .gte("created_at", sinceISO).order("created_at", { ascending: false }).limit(40),
      sb.from("roadmap_review_findings").select("created_at, severity, category, area, title, body, acknowledged")
        .eq("acknowledged", false).order("created_at", { ascending: false }).limit(30),
      sb.from("qa_checks").select("phase_key, criterion, status, note, last_checked_at").neq("status", "pass").limit(40),
      sb.from("test_runs").select("created_at, suite, status, passed, failed, total")
        .gte("created_at", sinceISO).order("created_at", { ascending: false }).limit(10),
      sb.from("notebook_entries").select("title, kind, body, tags, pinned, updated_at")
        .eq("pinned", true).order("updated_at", { ascending: false }).limit(30),
    ]);

    const sample = {
      today,
      phases: phases.data ?? [],
      sprints: sprints.data ?? [],
      open_tasks: tasks.data ?? [],
      recent_work_log: workLog.data ?? [],
      open_findings: findings.data ?? [],
      failing_qa: qa.data ?? [],
      recent_test_runs: testRuns.data ?? [],
      pinned_notebook: notebook.data ?? [],
    };

    const systemPrompt =
      "You are the AWIP Core operator's morning planner. Output ONLY a JSON tool call. " +
      "Pick the single highest-value FOCUS for the next 24h, then 3-7 prioritised tasks " +
      "(reference roadmap task keys when possible), highlight risks (test failures, " +
      "high-severity findings, drift from plan), and give 2-5 recommendations. " +
      "Be concrete. Cite roadmap task keys in the form 'sX.Y/tZ'. Prefer in-flight phases. " +
      "UK English. Markdown for plan_md.";

    const tools = [{
      type: "function",
      function: {
        name: "submit_plan",
        description: "Submit the daily plan",
        parameters: {
          type: "object",
          properties: {
            focus: { type: "string", description: "One sentence: the single thing to ship today." },
            plan_md: { type: "string", description: "Markdown body. Sections: Focus, Today's tasks, Notes." },
            risks: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  title: { type: "string" },
                  detail: { type: "string" },
                  severity: { type: "string", enum: ["low", "medium", "high"] },
                },
                required: ["title", "severity"],
                additionalProperties: false,
              },
            },
            recommendations: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  title: { type: "string" },
                  detail: { type: "string" },
                },
                required: ["title"],
                additionalProperties: false,
              },
            },
          },
          required: ["focus", "plan_md", "risks", "recommendations"],
          additionalProperties: false,
        },
      },
    }];

    const aiStart = Date.now();
    const aiResp = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${LOVABLE_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: PLANNER_MODEL,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: "Plan the next 24h based on this snapshot:\n\n```json\n" + JSON.stringify(sample).slice(0, 60_000) + "\n```" },
        ],
        tools,
        tool_choice: { type: "function", function: { name: "submit_plan" } },
      }),
    });
    const aiLatency = Date.now() - aiStart;

    if (!aiResp.ok) {
      const t = await aiResp.text();
      console.error("AI gateway error", aiResp.status, t);
      const msg = `AI gateway returned ${aiResp.status}: ${t.slice(0, 200)}`;
      const code = aiResp.status === 429 ? 429 : aiResp.status === 402 ? 402 : 500;
      await recordRun("error", code, msg);
      await sb.from("ai_usage_log").insert({
        job: "daily-plan", model: PLANNER_MODEL, trigger,
        status: "error", status_code: aiResp.status, latency_ms: aiLatency,
        error: msg.slice(0, 500), request_ref: { for_date: today, night_mode: NIGHT_MODE },
        price_in_per_mtok: priceFor(PLANNER_MODEL).in,
        price_out_per_mtok: priceFor(PLANNER_MODEL).out,
      });
      await maybeAlert("planner_error", msg, { status: aiResp.status });
      return json({ error: code === 429 ? "rate_limited" : code === 402 ? "credits_exhausted" : "ai_gateway_error" }, code);
    }

    const aiJson = await aiResp.json();
    const usage = aiJson?.usage ?? {};
    const promptTok = usage.prompt_tokens ?? 0;
    const completionTok = usage.completion_tokens ?? 0;
    const cost = costUsd(PLANNER_MODEL, promptTok, completionTok);
    await sb.from("ai_usage_log").insert({
      job: "daily-plan", model: PLANNER_MODEL, trigger,
      status: "ok", status_code: 200, latency_ms: aiLatency,
      prompt_tokens: usage.prompt_tokens ?? null,
      completion_tokens: usage.completion_tokens ?? null,
      total_tokens: usage.total_tokens ?? null,
      cost_usd: Number(cost.toFixed(6)),
      price_in_per_mtok: priceFor(PLANNER_MODEL).in,
      price_out_per_mtok: priceFor(PLANNER_MODEL).out,
      request_ref: { for_date: today, night_mode: NIGHT_MODE },
    });
    const totalTok = usage.total_tokens ?? (promptTok + completionTok);
    const prices = priceFor(PLANNER_MODEL);
    await checkCostThresholds(sb, "daily-plan", cost, maybeAlert, {
      model: PLANNER_MODEL,
      prompt_tokens: promptTok,
      completion_tokens: completionTok,
      total_tokens: totalTok,
      price_in_per_mtok: prices.in,
      price_out_per_mtok: prices.out,
      cost_usd: Number(cost.toFixed(6)),
    });
    const call = aiJson.choices?.[0]?.message?.tool_calls?.[0];
    const args = call?.function?.arguments ? JSON.parse(call.function.arguments) : null;
    if (!args) {
      await recordRun("error", 500, "AI returned no tool call.");
      return json({ error: "no_plan" }, 500);
    }

    const inputs_summary = {
      open_tasks: sample.open_tasks.length,
      open_findings: sample.open_findings.length,
      failing_qa: sample.failing_qa.length,
      recent_work_log: sample.recent_work_log.length,
      pinned_notebook: sample.pinned_notebook.length,
      recent_test_runs: sample.recent_test_runs.length,
    };

    // Upsert by date — one plan per day, latest wins.
    await sb.from("daily_plans").delete().eq("for_date", today);
    const { data: inserted, error } = await sb.from("daily_plans").insert({
      for_date: today,
      model: PLANNER_MODEL,
      focus: String(args.focus ?? "").slice(0, 500),
      plan_md: String(args.plan_md ?? ""),
      risks: Array.isArray(args.risks) ? args.risks : [],
      recommendations: Array.isArray(args.recommendations) ? args.recommendations : [],
      inputs_summary,
    }).select("id").single();

    if (error) {
      console.error("insert daily_plans failed", error);
      await recordRun("error", 500, error.message);
      return json({ error: "insert_failed" }, 500);
    }

    await recordRun("ok", 200, `Daily plan generated for ${today}`, { id: inserted?.id, ...inputs_summary });
    return json({ ok: true, id: inserted?.id, for_date: today });
  } catch (e) {
    console.error(e);
    return json({ error: e instanceof Error ? e.message : "unknown" }, 500);
  }
}));

function json(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

async function dispatchAlert(
  sb: ReturnType<typeof createClient>,
  job: string, reason: string, message: string, payload: Record<string, unknown> = {},
) {
  try {
    const { data: settings } = await sb.from("alert_settings").select("*").eq("id", true).maybeSingle();
    if (!settings || !settings.enabled || !settings.webhook_url) return;
    if (reason === "cost_threshold" && settings.alert_on_cost === false) return;
    const dedupeMin = Math.max(0, Number(settings.dedupe_minutes ?? 0));
    if (dedupeMin > 0) {
      const since = new Date(Date.now() - dedupeMin * 60_000).toISOString();
      const { data: recent } = await sb.from("alert_log")
        .select("id").eq("job", job).eq("reason", reason).eq("delivered", true)
        .gte("created_at", since).limit(1);
      if (recent && recent.length > 0) return;
    }
    const body = JSON.stringify({
      text: `🌅 ${job} · ${reason}\n${message}`,
      job, reason, message, payload, ts: new Date().toISOString(),
    });
    let delivered = false; let status_code: number | null = null; let error: string | null = null;
    try {
      const r = await fetch(settings.webhook_url, { method: "POST", headers: { "Content-Type": "application/json" }, body });
      status_code = r.status; delivered = r.ok;
      if (!r.ok) error = (await r.text()).slice(0, 300);
    } catch (e) { error = e instanceof Error ? e.message : String(e); }
    await sb.from("alert_log").insert({ job, reason, message, delivered, status_code, error, payload });
  } catch (e) { console.error("dispatchAlert failed", e); }
}

// Reads cost thresholds from alert_settings and emits a `cost_threshold` alert
// if either the just-completed run or today's running total for this job exceeds them.
type RunUsage = {
  model: string;
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
  price_in_per_mtok: number;
  price_out_per_mtok: number;
  cost_usd: number;
};

function buildRunBreakdown(u: RunUsage) {
  const inCost = (u.prompt_tokens / 1_000_000) * u.price_in_per_mtok;
  const outCost = (u.completion_tokens / 1_000_000) * u.price_out_per_mtok;
  return {
    model: u.model,
    prompt_tokens: u.prompt_tokens,
    completion_tokens: u.completion_tokens,
    total_tokens: u.total_tokens,
    price_in_per_mtok: u.price_in_per_mtok,
    price_out_per_mtok: u.price_out_per_mtok,
    input_cost_usd: Number(inCost.toFixed(6)),
    output_cost_usd: Number(outCost.toFixed(6)),
    cost_usd: u.cost_usd,
    cost_formula:
      `(${u.prompt_tokens} prompt / 1e6) * $${u.price_in_per_mtok}/Mtok ` +
      `+ (${u.completion_tokens} completion / 1e6) * $${u.price_out_per_mtok}/Mtok ` +
      `= $${inCost.toFixed(6)} + $${outCost.toFixed(6)} = $${(inCost + outCost).toFixed(6)}`,
  };
}

async function checkCostThresholds(
  sb: ReturnType<typeof createClient>,
  job: string,
  runCost: number,
  alert: (reason: string, message: string, payload?: Record<string, unknown>) => Promise<void>,
  usage?: RunUsage,
) {
  try {
    const { data: globalSettings } = await sb.from("alert_settings")
      .select("alert_on_cost,cost_per_run_usd,cost_per_day_usd").eq("id", true).maybeSingle();
    const { data: override } = await sb.from("alert_cost_thresholds")
      .select("alert_on_cost,cost_per_run_usd,cost_per_day_usd").eq("job", job).maybeSingle();

    const alertOn = override?.alert_on_cost ?? globalSettings?.alert_on_cost ?? true;
    if (alertOn === false) return;

    const perRunRaw = override?.cost_per_run_usd ?? globalSettings?.cost_per_run_usd ?? null;
    const perDayRaw = override?.cost_per_day_usd ?? globalSettings?.cost_per_day_usd ?? null;
    const perRun = perRunRaw != null ? Number(perRunRaw) : null;
    const perDay = perDayRaw != null ? Number(perDayRaw) : null;
    const source = (k: "run" | "day") =>
      (k === "run" ? override?.cost_per_run_usd : override?.cost_per_day_usd) != null ? "per_job" : "global";
    const breakdown = usage ? buildRunBreakdown(usage) : undefined;

    if (perRun !== null && perRun > 0 && runCost > perRun) {
      await alert("cost_threshold",
        `Run cost $${runCost.toFixed(4)} exceeded per-run threshold $${perRun.toFixed(4)} for ${job}.`,
        { scope: "per_run", job, run_cost_usd: runCost, threshold_usd: perRun,
          threshold_source: source("run"), run: breakdown });
    }
    if (perDay !== null && perDay > 0) {
      const dayStart = new Date(); dayStart.setUTCHours(0, 0, 0, 0);
      const { data: rows } = await sb.from("ai_usage_log")
        .select("cost_usd").eq("job", job).gte("created_at", dayStart.toISOString());
      const dayTotal = (rows ?? []).reduce((s: number, r: { cost_usd: number | null }) => s + Number(r.cost_usd ?? 0), 0);
      if (dayTotal > perDay) {
        const { data: priorAlerts } = await sb.from("alert_log")
          .select("payload")
          .eq("job", job).eq("reason", "cost_threshold").eq("delivered", true)
          .gte("created_at", dayStart.toISOString());
        const lastAlerted = (priorAlerts ?? []).reduce((m: number, r: { payload: Record<string, unknown> | null }) => {
          const p = r.payload ?? {};
          if ((p as { scope?: string }).scope !== "per_day") return m;
          const v = Number((p as { day_cost_usd?: number | null }).day_cost_usd ?? 0);
          return v > m ? v : m;
        }, 0);
        const isFirstToday = lastAlerted === 0;
        const grewByThreshold = (dayTotal - lastAlerted) >= perDay;
        if (isFirstToday || grewByThreshold) {
          await alert("cost_threshold",
            `Today's spend on ${job} is $${dayTotal.toFixed(4)} (threshold $${perDay.toFixed(4)}${
              isFirstToday ? "" : `, last alert at $${lastAlerted.toFixed(4)}`
            }).`,
            { scope: "per_day", job, day_cost_usd: dayTotal, threshold_usd: perDay,
              threshold_source: source("day"),
              previous_alert_day_cost_usd: isFirstToday ? null : lastAlerted,
              triggering_run: breakdown });
        }
      }
    }
  } catch (e) { console.error("checkCostThresholds failed", e); }
}
