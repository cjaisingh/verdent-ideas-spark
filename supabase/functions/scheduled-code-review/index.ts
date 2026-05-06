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

const REVIEWER_MODEL = "openai/gpt-5";

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

    if (!aiResp.ok) {
      const t = await aiResp.text();
      console.error("AI gateway error", aiResp.status, t);
      if (aiResp.status === 429) return json({ error: "rate_limited" }, 429);
      if (aiResp.status === 402) return json({ error: "credits_exhausted" }, 402);
      return json({ error: "ai_gateway_error" }, 500);
    }

    const aiJson = await aiResp.json();
    const call = aiJson.choices?.[0]?.message?.tool_calls?.[0];
    const args = call?.function?.arguments ? JSON.parse(call.function.arguments) : { findings: [] };
    const findings = Array.isArray(args.findings) ? args.findings : [];

    if (findings.length > 0) {
      const rows = findings.map((f: any) => ({
        reviewer_model: REVIEWER_MODEL,
        severity: f.severity ?? "info",
        category: f.category ?? null,
        area: f.area ?? null,
        title: String(f.title).slice(0, 300),
        body: f.body ?? null,
        diff_window_start: sinceISO,
        diff_window_end: untilISO,
      }));
      const { error } = await sb.from("roadmap_review_findings").insert(rows);
      if (error) console.error("insert failed", error);
    }

    return json({ ok: true, count: findings.length, window: { sinceISO, untilISO } });
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
