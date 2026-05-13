// Daily lessons synthesiser. Runs 05:30 UTC over the trailing 24h across
// the operator-facing signal set: discussion threads, companion chat,
// morning review triage, OKR/capability events, plus the weekly synth's
// existing inputs (sentinel/qa/automation/night proposals/code review).
//
// Writes lessons with cadence='daily' and a per-lesson `source` tag so
// /admin/lessons-loop can slice "client signals" (chat+triage+discussion)
// from system signals.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { withLogger } from "../_shared/logger.ts";
import { dispatchAlert } from "../_shared/alerts.ts";
import { pickModel } from "../_shared/model-policy.ts";
import { logAiCall } from "../_shared/ai-usage.ts";
import { dedupeLessons } from "../lessons-synthesize/dedupe.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-service-token",
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...corsHeaders, "Content-Type": "application/json" } });

const SOURCES = ["discussion", "chat", "triage", "event", "automation", "review", "mixed"] as const;
type Source = typeof SOURCES[number];

const PROMPT = `You synthesise *durable rules* (lessons) from the last 24h of operational + human signals
for an autonomous-engineering substrate. You will receive JSON arrays grouped by signal type:
- discussion_threads: debates and decisions in operator discussions
- companion_chat: questions the operator/users asked the AI assistant (proxy for client perspective)
- triage_decisions: which morning-review panels the operator Focused / Skipped / Done / Revisit (strongest signal of what mattered)
- okr_events + capability_events: what shipped or shifted today
- sentinel + qa + automation_errors + night_proposals + code_review: system signals

Return STRICT JSON: { "lessons": [{ "category": string, "severity": "low|medium|high|critical",
"title": short imperative, "recommendation": one-paragraph rule,
"source": "discussion"|"chat"|"triage"|"event"|"automation"|"review"|"mixed",
"evidence": [{"source": string, "id": string}] }] }

Rules for the daily pass:
- Aim for 0–6 lessons. Quality over quantity. If today is quiet, return { "lessons": [] }.
- Each lesson must be GENERAL (not "fix bug X"), reusable, and de-dupable across days.
- Tag \`source\` with the dominant signal type. Use "mixed" only if 3+ types contributed.
- Prefer lessons rooted in chat/triage/discussion when possible — these are the freshest "client perspective" signals.`;

Deno.serve(withLogger("lessons-daily-synth", async (req) => {
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
        job: "lessons-daily-synth", trigger, status, status_code: code,
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
    const since = new Date(now.getTime() - 24 * 3600 * 1000).toISOString();

    const [
      discussions, chat, triage, okrEvts, capEvts,
      sentinelF, qa, errs, props, codeF, awipReviews,
    ] = await Promise.all([
      sb.from("roadmap_finding_discussion_messages").select("id,discussion_id,role,source,body,created_at").gte("created_at", since).limit(150),
      sb.from("companion_messages").select("id,thread_id,role,content,created_at").gte("created_at", since).limit(200),
      sb.from("morning_review_triage").select("id,item_kind,item_ref,state,note,set_at").gte("set_at", since).is("cleared_at", null).limit(150),
      sb.from("okr_node_events").select("id,node_id,event_type,payload,created_at").gte("created_at", since).limit(100),
      sb.from("capability_events").select("id,capability_id,event_type,payload,created_at").gte("created_at", since).limit(100),
      sb.from("sentinel_findings").select("id,kind,severity,summary,payload,first_seen_at").gte("first_seen_at", since).limit(80),
      sb.from("qa_checks").select("id,name,status,detail,created_at").eq("status", "fail").gte("created_at", since).limit(80),
      sb.from("automation_runs").select("id,job,status,message,created_at").eq("status", "error").gte("created_at", since).limit(80),
      sb.from("night_proposals").select("id,kind,summary,payload,created_at").gte("created_at", since).limit(80),
      sb.from("roadmap_review_findings").select("id,severity,category,title,body,created_at").gte("created_at", since).limit(50),
      sb.from("awip_review_findings").select("id,severity,title,summary,created_at").gte("created_at", since).limit(50),
    ]);

    const inputs = {
      discussion_threads: discussions.data ?? [],
      companion_chat: (chat.data ?? []).map((m: { role: string; content: string; thread_id: string; created_at: string }) => ({
        thread_id: m.thread_id, role: m.role,
        content: typeof m.content === "string" ? m.content.slice(0, 600) : m.content,
        at: m.created_at,
      })),
      triage_decisions: triage.data ?? [],
      okr_events: okrEvts.data ?? [],
      capability_events: capEvts.data ?? [],
      sentinel_findings: sentinelF.data ?? [],
      qa_failures: qa.data ?? [],
      automation_errors: errs.data ?? [],
      night_proposals: props.data ?? [],
      code_review_findings: codeF.data ?? [],
      awip_review_findings: awipReviews.data ?? [],
    };

    const totalSignals = Object.values(inputs).reduce((s, v) => s + (v as unknown[]).length, 0);
    if (totalSignals === 0) {
      await recordRun("ok", 200, "no signals — skipped synthesis", { signals: 0, window_h: 24 });
      return json({ ok: true, lessons: 0, reason: "no_signals" });
    }

    const model = pickModel("google/gemini-2.5-flash");
    const aiStart = Date.now();
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
      await logAiCall(sb, { job: "lessons-daily-synth", model, trigger, startedAt: aiStart, response: aiRes, errorText: t, request_ref: { signals: totalSignals } });
      await recordRun("error", aiRes.status, "ai gateway error", { body: t.slice(0, 500) });
      await dispatchAlert(sb, "lessons-daily-synth", "review_error",
        `ai gateway ${aiRes.status}: ${t.slice(0, 200)}`, { status: aiRes.status });
      return json({ error: "ai_error", status: aiRes.status }, 502);
    }
    const aiJson = await aiRes.json();
    await logAiCall(sb, { job: "lessons-daily-synth", model, trigger, startedAt: aiStart, response: aiRes, json: aiJson, request_ref: { signals: totalSignals } });
    const content: string = aiJson?.choices?.[0]?.message?.content ?? "{}";
    let parsed: { lessons?: Array<Record<string, unknown>> } = {};
    try { parsed = JSON.parse(content); } catch { /* keep empty */ }
    const raw = Array.isArray(parsed.lessons) ? parsed.lessons : [];

    // Normalise via shared dedupe, then re-attach source from raw payload.
    const norm = dedupeLessons(raw as Parameters<typeof dedupeLessons>[0]);
    const sourceByKey = new Map<string, Source>();
    for (const r of raw) {
      const cat = String(r.category ?? "general").trim();
      const title = String(r.title ?? "").trim();
      if (!title) continue;
      const key = `${cat.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 80)}::${title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 80)}`;
      const src = String(r.source ?? "mixed") as Source;
      sourceByKey.set(key, (SOURCES as readonly string[]).includes(src) ? src : "mixed");
    }

    let inserted = 0, updated = 0;
    for (const l of norm) {
      const src = sourceByKey.get(l.dedupe_key) ?? "mixed";
      const { data: existing } = await sb.from("lessons")
        .select("id,status,occurrences").eq("dedupe_key", l.dedupe_key).maybeSingle();
      if (existing) {
        await sb.from("lessons").update({
          severity: l.severity, recommendation: l.recommendation, evidence: l.evidence,
          source_window_start: since, source_window_end: now.toISOString(),
          source: src, occurrences: (existing.occurrences ?? 1) + 1,
          status: existing.status === "rejected" ? "rejected" : existing.status,
        }).eq("id", existing.id);
        updated++;
      } else {
        await sb.from("lessons").insert({
          category: l.category, severity: l.severity, title: l.title,
          recommendation: l.recommendation, evidence: l.evidence,
          dedupe_key: l.dedupe_key, status: "proposed",
          cadence: "daily", source: src, occurrences: 1,
          source_window_start: since, source_window_end: now.toISOString(),
        });
        inserted++;
      }
    }

    await recordRun("ok", 200, `daily synth ${norm.length} (i${inserted}/u${updated})`, {
      signals: totalSignals, inserted, updated, model, window_h: 24,
    });
    return json({ ok: true, inserted, updated, total: norm.length, model, signals: totalSignals });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await recordRun("error", 500, msg);
    await dispatchAlert(sb, "lessons-daily-synth", "review_error", msg);
    return json({ error: msg }, 500);
  }
}));
