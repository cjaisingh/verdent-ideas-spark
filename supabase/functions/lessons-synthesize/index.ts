// Lessons-Learned Loop (W4).
// Weekly synthesis: pull last 7 days of findings, qa failures, automation errors,
// night proposals → ask Lovable AI Gateway for `proposed` lessons → upsert into public.lessons.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { withLogger } from "../_shared/logger.ts";
import { dispatchAlert } from "../_shared/alerts.ts";
import { pickModel } from "../_shared/model-policy.ts";
import { logAiCall } from "../_shared/ai-usage.ts";
import { dedupeLessons } from "./dedupe.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-service-token",
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...corsHeaders, "Content-Type": "application/json" } });

const PROMPT = `You synthesise *durable rules* (lessons) from the last 7 days of operational signals
for an autonomous-engineering substrate. You will be given JSON arrays of:
- code-review findings, sentinel findings, qa failures, automation_runs errors, night proposals.

Return STRICT JSON: { "lessons": [{ "category": string, "severity": "low|medium|high|critical",
"title": short imperative, "recommendation": one-paragraph rule, "evidence": [{"source": string, "id": string}] }] }
Aim for 3–8 lessons. Each lesson must be GENERAL (not "fix bug X"), reusable, and de-dupable across weeks.
Skip noise; if signals are quiet, return { "lessons": [] }.`;

Deno.serve(withLogger("lessons-synthesize", async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
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
        job: "lessons-synthesize", trigger, status, status_code: code,
        duration_ms: Date.now() - startedAt, message: msg, detail,
      });
    } catch (e) { console.error("automation_runs insert failed", e); }
  };

  if (!triggeredByCron && !auth.startsWith("Bearer ")) {
    await recordRun("error", 401, "Missing auth.");
    return json({ error: "unauthorized" }, 401);
  }
  if (!LOVABLE_API_KEY) {
    await recordRun("error", 500, "LOVABLE_API_KEY missing.");
    return json({ error: "missing_lovable_api_key" }, 500);
  }

  try {
    const now = new Date();
    const since = new Date(now.getTime() - 7 * 24 * 3600 * 1000).toISOString();

    const [codeF, sentinelF, qa, errs, props] = await Promise.all([
      sb.from("roadmap_review_findings").select("id,severity,category,title,body,created_at").gte("created_at", since).limit(100),
      sb.from("sentinel_findings").select("id,kind,severity,summary,payload,first_seen_at").gte("first_seen_at", since).limit(100),
      sb.from("qa_checks").select("id,name,status,detail,created_at").eq("status", "fail").gte("created_at", since).limit(100),
      sb.from("automation_runs").select("id,job,status,message,created_at").eq("status", "error").gte("created_at", since).limit(100),
      sb.from("night_proposals").select("id,kind,summary,payload,created_at").gte("created_at", since).limit(100),
    ]);

    const inputs = {
      code_review_findings: codeF.data ?? [],
      sentinel_findings: sentinelF.data ?? [],
      qa_failures: qa.data ?? [],
      automation_errors: errs.data ?? [],
      night_proposals: props.data ?? [],
    };

    const totalSignals = Object.values(inputs).reduce((s, v) => s + (v as unknown[]).length, 0);
    if (totalSignals === 0) {
      await recordRun("ok", 200, "no signals — skipped synthesis", { signals: 0 });
      return json({ ok: true, lessons: 0, reason: "no_signals" });
    }

    const model = pickModel("google/gemini-2.5-flash");
    const aiRes = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${LOVABLE_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: PROMPT },
          { role: "user", content: JSON.stringify(inputs) },
        ],
        response_format: { type: "json_object" },
      }),
    });
    if (!aiRes.ok) {
      const t = await aiRes.text();
      await recordRun("error", aiRes.status, "ai gateway error", { body: t.slice(0, 500) });
      await dispatchAlert(sb, "lessons-synthesize", "review_error",
        `ai gateway ${aiRes.status}: ${t.slice(0, 200)}`, { status: aiRes.status });
      return json({ error: "ai_error", status: aiRes.status }, 502);
    }
    const aiJson = await aiRes.json();
    const content: string = aiJson?.choices?.[0]?.message?.content ?? "{}";
    let parsed: { lessons?: unknown[] } = {};
    try { parsed = JSON.parse(content); } catch { /* keep empty */ }
    const raw = Array.isArray(parsed.lessons) ? parsed.lessons : [];
    const norm = dedupeLessons(raw as Parameters<typeof dedupeLessons>[0]);

    let inserted = 0, updated = 0;
    for (const l of norm) {
      const { data: existing } = await sb.from("lessons")
        .select("id,status").eq("dedupe_key", l.dedupe_key).maybeSingle();
      if (existing) {
        await sb.from("lessons").update({
          severity: l.severity, recommendation: l.recommendation, evidence: l.evidence,
          source_window_start: since, source_window_end: now.toISOString(),
          status: existing.status === "rejected" ? "rejected" : existing.status,
        }).eq("id", existing.id);
        updated++;
      } else {
        await sb.from("lessons").insert({
          category: l.category, severity: l.severity, title: l.title,
          recommendation: l.recommendation, evidence: l.evidence,
          dedupe_key: l.dedupe_key, status: "proposed",
          source_window_start: since, source_window_end: now.toISOString(),
        });
        inserted++;
      }
    }

    await recordRun("ok", 200, `synthesised ${norm.length} (i${inserted}/u${updated})`, {
      signals: totalSignals, inserted, updated, model,
    });
    return json({ ok: true, inserted, updated, total: norm.length, model });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await recordRun("error", 500, msg);
    await dispatchAlert(sb, "lessons-synthesize", "review_error", msg);
    return json({ error: msg }, 500);
  }
}));
