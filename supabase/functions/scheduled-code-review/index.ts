// Weekly AI code review.
// Cross-vendor on purpose: the Lovable coding agent is Anthropic Claude,
// so this reviewer uses OpenAI GPT-5 via Lovable AI Gateway.
//
// Inputs (optional, for ad-hoc invocation): { since?: ISO date }
// Behaviour: pulls work-log + skip activity + roadmap task changes since `since`
// (defaults to 7 days), asks GPT-5 to flag risks/regressions/inconsistencies,
// writes findings to roadmap_review_findings.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-service-token",
};

const REVIEWER_MODEL = "google/gemini-2.5-flash";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY")!;
    const SERVICE_TOKEN = Deno.env.get("AWIP_SERVICE_TOKEN");

    // Allow cron (service token) OR an authenticated operator.
    const provided = req.headers.get("x-service-token");
    const auth = req.headers.get("authorization") ?? "";
    const triggeredByCron = !!SERVICE_TOKEN && provided === SERVICE_TOKEN;
    const trigger = triggeredByCron ? "cron" : "manual";
    const sbLog = createClient(SUPABASE_URL, SERVICE_ROLE);
    const startedAt = Date.now();
    const recordRun = async (status: string, status_code: number, message: string, detail: Record<string, unknown> = {}) => {
      try {
        await sbLog.from("automation_runs").insert({
          job: "scheduled-code-review", trigger, status, status_code,
          duration_ms: Date.now() - startedAt, message, detail,
        });
      } catch (e) { console.error("automation_runs insert failed", e); }
    };
    const maybeAlert = async (reason: string, message: string, payload: Record<string, unknown> = {}) => {
      await dispatchAlert(sbLog, "scheduled-code-review", reason, message, payload);
    };

    if (!triggeredByCron && !auth.startsWith("Bearer ")) {
      await recordRun("error", 401, !SERVICE_TOKEN
        ? "AWIP_SERVICE_TOKEN secret is missing in Lovable Cloud — cron cannot authenticate."
        : "Missing service token and no Authorization header.");
      return json({ error: "unauthorized" }, 401);
    }
    if (!LOVABLE_API_KEY) {
      await recordRun("error", 500, "LOVABLE_API_KEY secret is missing — cannot reach AI gateway.");
      return json({ error: "missing_lovable_api_key" }, 500);
    }

    const body = req.method === "POST" ? await req.json().catch(() => ({})) : {};
    const sinceISO: string =
      body.since ?? new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const untilISO = new Date().toISOString();

    const sb = createClient(SUPABASE_URL, SERVICE_ROLE);

    const [logs, skips, taskActivity] = await Promise.all([
      sb.from("roadmap_work_log").select("created_at, source, model, summary, issues, fixes, duration_ms, tokens_total")
        .gte("created_at", sinceISO).order("created_at", { ascending: false }).limit(80),
      sb.from("roadmap_autolog_skips").select("created_at, source, reason, summary")
        .gte("created_at", sinceISO).order("created_at", { ascending: false }).limit(40),
      sb.from("roadmap_task_activity").select("created_at, task_id, field, old_value, new_value, author_label")
        .gte("created_at", sinceISO).order("created_at", { ascending: false }).limit(120),
    ]);

    const sample = {
      window: { since: sinceISO, until: untilISO },
      work_log: logs.data ?? [],
      skips: skips.data ?? [],
      task_activity: taskActivity.data ?? [],
    };

    const systemPrompt =
      "You are a senior staff engineer reviewing one week of activity on an operator platform. " +
      "Output ONLY a JSON tool call with concrete findings. Each finding is one of: risk, regression, " +
      "inconsistency, missing_test, security, drift_from_plan, hygiene. Be specific — cite the data. " +
      "If everything looks fine, return an empty list. Do not invent code; only reason from the provided activity.";

    const tools = [{
      type: "function",
      function: {
        name: "submit_findings",
        description: "Submit code-review findings",
        parameters: {
          type: "object",
          properties: {
            findings: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  title: { type: "string" },
                  body: { type: "string" },
                  severity: { type: "string", enum: ["info", "low", "medium", "high"] },
                  category: { type: "string", enum: ["risk", "regression", "inconsistency", "missing_test", "security", "drift_from_plan", "hygiene"] },
                  area: { type: "string" },
                },
                required: ["title", "body", "severity", "category"],
                additionalProperties: false,
              },
            },
          },
          required: ["findings"],
          additionalProperties: false,
        },
      },
    }];

    const aiStart = Date.now();
    const aiResp = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${LOVABLE_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: REVIEWER_MODEL,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: "Review the following week of activity:\n\n```json\n" + JSON.stringify(sample).slice(0, 60_000) + "\n```" },
        ],
        tools,
        tool_choice: { type: "function", function: { name: "submit_findings" } },
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
        job: "scheduled-code-review", model: REVIEWER_MODEL, trigger,
        status: "error", status_code: aiResp.status, latency_ms: aiLatency,
        error: msg.slice(0, 500),
        request_ref: { window_start: sinceISO, window_end: untilISO },
      });
      await maybeAlert("review_error", msg, { status: aiResp.status });
      return json({ error: code === 429 ? "rate_limited" : code === 402 ? "credits_exhausted" : "ai_gateway_error" }, code);
    }

    const aiJson = await aiResp.json();
    const usage = aiJson?.usage ?? {};
    const call = aiJson.choices?.[0]?.message?.tool_calls?.[0];
    const args = call?.function?.arguments ? JSON.parse(call.function.arguments) : { findings: [] };
    const findings = Array.isArray(args.findings) ? args.findings : [];

    await sb.from("ai_usage_log").insert({
      job: "scheduled-code-review", model: REVIEWER_MODEL, trigger,
      status: "ok", status_code: 200, latency_ms: aiLatency,
      prompt_tokens: usage.prompt_tokens ?? null,
      completion_tokens: usage.completion_tokens ?? null,
      total_tokens: usage.total_tokens ?? null,
      request_ref: { window_start: sinceISO, window_end: untilISO, findings_count: findings.length },
    });

    let highCount = 0;
    if (findings.length > 0) {
      const rows = findings.map((f: any) => {
        if (f.severity === "high") highCount++;
        return {
          reviewer_model: REVIEWER_MODEL,
          severity: f.severity ?? "info",
          category: f.category ?? null,
          area: f.area ?? null,
          title: String(f.title).slice(0, 300),
          body: f.body ?? null,
          diff_window_start: sinceISO,
          diff_window_end: untilISO,
        };
      });
      const { error } = await sb.from("roadmap_review_findings").insert(rows);
      if (error) console.error("insert failed", error);
    }

    if (highCount > 0) {
      await maybeAlert("high_finding", `${highCount} new high-severity finding(s) from code review`, { high_count: highCount, total: findings.length });
    }

    await recordRun("ok", 200, `${findings.length} findings recorded`, { findings_count: findings.length });
    return json({ ok: true, count: findings.length, findings_count: findings.length, window: { sinceISO, untilISO } });
  } catch (e) {
    console.error(e);
    return json({ error: e instanceof Error ? e.message : "unknown" }, 500);
  }
});

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
    const flagMap: Record<string, string> = {
      review_error: "alert_on_review_error",
      high_finding: "alert_on_high_finding",
      test_fail: "alert_on_test_fail",
      qa_fail: "alert_on_qa_fail",
    };
    const flag = flagMap[reason];
    if (flag && settings[flag] === false) return;
    const dedupeMin = Math.max(0, Number(settings.dedupe_minutes ?? 0));
    if (dedupeMin > 0) {
      const since = new Date(Date.now() - dedupeMin * 60_000).toISOString();
      const { data: recent } = await sb.from("alert_log")
        .select("id").eq("job", job).eq("reason", reason).eq("delivered", true)
        .gte("created_at", since).limit(1);
      if (recent && recent.length > 0) return;
    }
    const body = JSON.stringify({
      text: `🚨 ${job} · ${reason}\n${message}`,
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
