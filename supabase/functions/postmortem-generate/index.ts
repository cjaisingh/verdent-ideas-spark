// Auto-postmortem generator.
// Daily cron: finds phases/sprints whose planned end has passed without
// reaching done/shipped/cancelled, drafts a prose postmortem per slip,
// inserts into public.postmortems (idempotent on (kind,id,slipped_on)).

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { withLogger } from "../_shared/logger.ts";
import { pickModel } from "../_shared/model-policy.ts";
import { logAiCall } from "../_shared/ai-usage.ts";
import { dispatchAlert } from "../_shared/alerts.ts";
import type { PostmortemDraft, PostmortemInput, EvidenceItem } from "../_shared/contracts/postmortem-generate.ts";
import { recordStep } from "../_shared/steps.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-service-token",
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...corsHeaders, "Content-Type": "application/json" } });

const DONE = new Set(["done", "shipped", "cancelled"]);

const PROMPT = `You write concise engineering postmortems for AWIP Core. You receive ONE slipped phase or sprint with surrounding evidence (linked discussion actions, sentinel findings, failed overnight runs, recent events, and a chronological "evidence" array of observable spikes/errors/findings).

Return STRICT JSON:
{
  "root_cause": "<one paragraph naming the dominant cause>",
  "contributing_factors": ["<short bullet>", ...],   // 0–5 items
  "timeline": [{"at": "<ISO>", "what": "<short phrase>"}],
  "what_changed": "<one paragraph on remediation already observable in the data>"
}

Rules:
- Be specific and grounded in the evidence given. EVERY claim in root_cause and contributing_factors should be defensible from the evidence array — if it isn't, hedge or omit it.
- The timeline you return should reference real events from the evidence array (same timestamps where possible).
- No blame, no speculation beyond what the data supports.
- Don't propose fixes or actions — that's a separate loop.
- UK English. Plain prose, no markdown headings inside the strings.`;

type SubjectRow = {
  kind: "phase" | "sprint";
  id: string;
  label: string;
  status: string;
  ends_on: string;
};

async function gatherSlippedSubjects(
  sb: ReturnType<typeof createClient>,
): Promise<SubjectRow[]> {
  const today = new Date().toISOString().slice(0, 10);
  const out: SubjectRow[] = [];

  // Sprints: direct ends_on
  const { data: sprints } = await sb
    .from("roadmap_sprints")
    .select("id,key,title,status,ends_on")
    .lt("ends_on", today)
    .not("ends_on", "is", null);
  for (const s of sprints ?? []) {
    const r = s as { id: string; key: string; title: string; status: string; ends_on: string };
    if (DONE.has(String(r.status))) continue;
    out.push({ kind: "sprint", id: r.id, label: `${r.key} — ${r.title}`, status: r.status, ends_on: r.ends_on });
  }

  // Phases: virtual end = max(child sprint ends_on)
  const { data: phases } = await sb
    .from("roadmap_phases")
    .select("id,key,title,status");
  for (const p of phases ?? []) {
    const r = p as { id: string; key: string; title: string; status: string };
    if (DONE.has(String(r.status))) continue;
    const { data: child } = await sb
      .from("roadmap_sprints")
      .select("ends_on")
      .eq("phase_id", r.id)
      .not("ends_on", "is", null)
      .order("ends_on", { ascending: false })
      .limit(1);
    const maxEnd = (child?.[0] as { ends_on?: string } | undefined)?.ends_on;
    if (!maxEnd || maxEnd >= today) continue;
    out.push({ kind: "phase", id: r.id, label: `${r.key} — ${r.title}`, status: r.status, ends_on: maxEnd });
  }

  return out;
}

function daysBetween(end: string, today: string): number {
  const a = new Date(end + "T00:00:00Z").getTime();
  const b = new Date(today + "T00:00:00Z").getTime();
  return Math.max(0, Math.round((b - a) / 86400000));
}

async function buildInput(
  sb: ReturnType<typeof createClient>,
  s: SubjectRow,
  today: string,
): Promise<PostmortemInput> {
  const since = new Date(s.ends_on + "T00:00:00Z");
  since.setUTCDate(since.getUTCDate() - 14); // 2 weeks of context before slip
  const sinceIso = since.toISOString();

  const ctx: PostmortemInput["context"] = {};

  if (s.kind === "phase") {
    const { data: kids } = await sb
      .from("roadmap_sprints")
      .select("id,key,status,ends_on")
      .eq("phase_id", s.id)
      .order("order", { ascending: true });
    ctx.sprintsUnderPhase = (kids ?? []) as PostmortemInput["context"]["sprintsUnderPhase"];
  }

  const { data: findings } = await sb
    .from("sentinel_findings")
    .select("id,kind,severity,summary,first_seen_at")
    .gte("first_seen_at", sinceIso)
    .limit(30);
  ctx.sentinelFindings = (findings ?? []) as PostmortemInput["context"]["sentinelFindings"];

  const { data: runs } = await sb
    .from("roadmap_phase_overnight_runs")
    .select("id,status,requested_at,finished_at,error_message")
    .in("status", ["failed", "auto_blocked"])
    .gte("requested_at", sinceIso)
    .limit(20);
  ctx.failedOvernightRuns = (runs ?? []).map((r) => ({
    id: (r as { id: string }).id,
    status: (r as { status: string }).status,
    requested_at: (r as { requested_at: string }).requested_at,
    finished_at: (r as { finished_at: string | null }).finished_at,
    error: (r as { error_message?: string | null }).error_message ?? null,
  }));

  const { data: actions } = await sb
    .from("discussion_actions")
    .select("id,title,status,priority,created_at")
    .gte("created_at", sinceIso)
    .order("created_at", { ascending: false })
    .limit(25);
  ctx.linkedActions = (actions ?? []) as PostmortemInput["context"]["linkedActions"];

  return {
    subject: {
      kind: s.kind,
      id: s.id,
      label: s.label,
      status: s.status,
      ends_on: s.ends_on,
      days_late: daysBetween(s.ends_on, today),
    },
    context: ctx,
  };
}

Deno.serve(withLogger("postmortem-generate", async (req, ctx) => {
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
  const reqId = ctx.requestId;

  const recordRun = async (status: string, code: number, msg: string, detail: Record<string, unknown> = {}) => {
    try {
      await sb.from("automation_runs").insert({
        job: "postmortem-generate", trigger, status, status_code: code,
        duration_ms: Date.now() - startedAt, message: msg, detail,
        request_id: reqId,
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
    const today = new Date().toISOString().slice(0, 10);
    const slipped = await recordStep(sb, {
      job: "postmortem-generate", step_key: "db_scan:slipped_subjects",
      request_id: reqId,
      step_label: "Find slipped phases + sprints", phase_kind: "db_scan",
    }, () => gatherSlippedSubjects(sb));

    if (slipped.length === 0) {
      await recordRun("ok", 200, "no slipped subjects");
      return json({ ok: true, drafted: 0, skipped: 0, reason: "no_slips" });
    }

    const model = pickModel("google/gemini-2.5-flash");
    let drafted = 0, skipped = 0, errors = 0;

    for (const s of slipped) {
      // Idempotency
      const { data: existing } = await sb
        .from("postmortems")
        .select("id")
        .eq("subject_kind", s.kind)
        .eq("subject_id", s.id)
        .eq("slipped_on", s.ends_on)
        .maybeSingle();
      if (existing) { skipped++; continue; }

      const input = await recordStep(sb, {
        job: "postmortem-generate", step_key: "db_scan:context",
        request_id: reqId,
        step_label: `Gather context for ${s.kind} ${s.label}`, phase_kind: "db_scan",
        detail: { subject_kind: s.kind, subject_id: s.id },
      }, () => buildInput(sb, s, today));
      const aiStart = Date.now();
      const aiRes = await recordStep(sb, {
        job: "postmortem-generate", step_key: "ai_call:gateway",
        request_id: reqId,
        step_label: `Draft postmortem (${model})`, phase_kind: "ai_call",
        detail: { model, subject_kind: s.kind, subject_id: s.id },
      }, () => fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
        method: "POST",
        headers: { Authorization: `Bearer ${LOVABLE_API_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model,
          messages: [
            { role: "system", content: PROMPT },
            { role: "user", content: JSON.stringify(input) },
          ],
          response_format: { type: "json_object" },
        }),
      }));
      if (!aiRes.ok) {
        const t = await aiRes.text();
        await logAiCall(sb, { job: "postmortem-generate", model, trigger, startedAt: aiStart, response: aiRes, errorText: t, request_ref: { subject_kind: s.kind, subject_id: s.id } });
        errors++;
        continue;
      }
      const aiJson = await aiRes.json();
      await logAiCall(sb, { job: "postmortem-generate", model, trigger, startedAt: aiStart, response: aiRes, json: aiJson, request_ref: { subject_kind: s.kind, subject_id: s.id } });
      const content: string = aiJson?.choices?.[0]?.message?.content ?? "{}";
      let draft: Partial<PostmortemDraft> = {};
      try { draft = JSON.parse(content); } catch { /* empty */ }

      const { error: insErr } = await sb.from("postmortems").insert({
        subject_kind: s.kind,
        subject_id: s.id,
        subject_label: s.label,
        slipped_on: s.ends_on,
        days_late: input.subject.days_late,
        root_cause: typeof draft.root_cause === "string" ? draft.root_cause : null,
        contributing_factors: Array.isArray(draft.contributing_factors) ? draft.contributing_factors : [],
        timeline: Array.isArray(draft.timeline) ? draft.timeline : [],
        what_changed: typeof draft.what_changed === "string" ? draft.what_changed : null,
        status: "draft",
        model,
      });
      if (insErr) { errors++; console.error("insert failed", insErr); continue; }
      drafted++;
    }

    await recordRun("ok", 200, `drafted ${drafted}, skipped ${skipped}, errors ${errors}`, {
      drafted, skipped, errors, candidates: slipped.length, model,
    });
    return json({ ok: true, drafted, skipped, errors, candidates: slipped.length, model });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await recordRun("error", 500, msg);
    await dispatchAlert(sb, "postmortem-generate", "review_error", msg);
    return json({ error: msg }, 500);
  }
}));
