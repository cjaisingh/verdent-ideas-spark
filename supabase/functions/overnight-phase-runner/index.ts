// overnight-phase-runner
// Picks queued roadmap_phase_overnight_runs rows during the 22:00–06:00 UTC window
// and generates an observation-only AI plan for each phase using the night-cheap
// model (gemini-2.5-flash-lite, forced via pickModel). Result is stored on the run row;
// no roadmap state is changed. Operator reviews/accepts in the morning.
//
// Auth: x-service-token (cron) or operator JWT (manual trigger from UI).
// Body: { run_id?: string }  // if omitted, processes all due queued rows.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { pickModel, isNightUTC } from "../_shared/model-policy.ts";
import { dispatchAlert } from "../_shared/alerts.ts";
import { withLogger } from "../_shared/logger.ts";
import { recordStep } from "../_shared/steps.ts";
import { getPhaseBinding, rejectEnvelope } from "../_shared/contracts/phase-contract-map.ts";
import { OvernightResponseEnvelopeSchema } from "../_shared/contracts/overnight-envelope.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-service-token",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const SERVICE_TOKEN = Deno.env.get("AWIP_SERVICE_TOKEN");
const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY")!;

const PRICING: Record<string, { in: number; out: number }> = {
  "google/gemini-2.5-flash-lite": { in: 0.10, out: 0.40 },
  "google/gemini-2.5-flash": { in: 0.30, out: 2.50 },
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status, headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

async function heartbeat(sb: ReturnType<typeof createClient>, runId: string) {
  await sb.from("roadmap_phase_overnight_runs")
    .update({ heartbeat_at: new Date().toISOString() })
    .eq("id", runId).eq("status", "running");
}

async function processRun(sb: ReturnType<typeof createClient>, runId: string, reqId: string) {
  const { data: run } = await sb
    .from("roadmap_phase_overnight_runs")
    .select("id, phase_id, phase_key, status, attempts, max_retries")
    .eq("id", runId).maybeSingle();
  if (!run) return { run_id: runId, skipped: "not_found" };
  if (run.status !== "queued") return { run_id: runId, skipped: `status_${run.status}` };

  const model = pickModel("google/gemini-2.5-flash-lite", { force: true });
  const nowIso = new Date().toISOString();
  const attempts = (run.attempts ?? 0) + 1;

  // Mark running + bump attempts + initial heartbeat
  await sb.from("roadmap_phase_overnight_runs").update({
    status: "running", started_at: nowIso, heartbeat_at: nowIso,
    attempts, model,
  }).eq("id", runId).eq("status", "queued");

  // Periodic heartbeat while AI call is in flight
  const hbTimer = setInterval(() => { heartbeat(sb, runId).catch(() => {}); }, 30_000);

  try {
    // Defense in depth: require an existing signoff
    const { count: signoffs } = await sb
      .from("roadmap_phase_signoffs")
      .select("id", { count: "exact", head: true })
      .eq("phase_id", run.phase_id);
    if (!signoffs || signoffs === 0) {
      throw new Error("phase has no signoff — refusing to run");
    }

    const [{ data: phase }, { data: sprints }, { data: tasks }] = await Promise.all([
      sb.from("roadmap_phases").select("key, title, summary, status").eq("id", run.phase_id).maybeSingle(),
      sb.from("roadmap_sprints").select("key, title, status, goal").eq("phase_id", run.phase_id),
      sb.from("roadmap_tasks").select("key, title, status, owner, module, description, acceptance, sprint_id"),
    ]);
    const sprintIds = new Set((sprints ?? []).map((s: any) => s.key));
    const phaseTasks = (tasks ?? []).filter((t: any) => t.sprint_id && sprintIds.has(t.sprint_id));

    const sample = { phase, sprints: sprints ?? [], tasks: phaseTasks.slice(0, 60) };
    const binding = getPhaseBinding(run.phase_key);

    const baseSystem =
      "You are an observation-only night agent. Given an approved roadmap phase, " +
      "produce a concise next-morning briefing: " +
      "(1) one-paragraph health summary, (2) top 3 risks, (3) top 5 recommended next actions. " +
      "Do NOT propose changes to the roadmap itself; the operator decides.";

    const systemPrompt = binding
      ? [
          baseSystem,
          "",
          `This phase is governed by the ${binding.phaseKey} retrieval contract.`,
          `Data shape: ${binding.contract.shape}.`,
          `Store: ${binding.contract.store}.`,
          `Token budget: ${binding.contract.tokenBudget}.`,
          `Fallback rule: ${binding.contract.fallback}.`,
          binding.adrs.length ? `Open ADRs: ${binding.adrs.join(", ")}.` : "No open ADRs.",
          "Guard rails (must be respected — your output will be rejected if you propose violating any):",
          ...binding.guardrails.map((g) => `- ${g}`),
          "",
          "Return STRICT JSON with EXACTLY these keys:",
          "  contract_acknowledged: string  // must equal the store or declaredBy value above",
          "  guardrails_respected:  string[] // non-empty subset of the guard rails verbatim",
          "  would_violate:         string[] // anything you considered but rejected",
          "  summary:               string",
          "  risks:                 string[] (≤10)",
          "  recommendations:       string[] (≤10)",
        ].join("\n")
      : baseSystem +
        " Return STRICT JSON: {summary:string, risks:string[], recommendations:string[]}.";

    const charBudget = binding ? Math.max(8_000, binding.contract.tokenBudget * 4) : 40_000;

    const aiStart = Date.now();
    const aiResp = await recordStep(sb, {
      job: "overnight-phase-runner", step_key: "ai_call:gateway",
      request_id: reqId,
      step_label: `Night plan via ${model}`, phase_kind: "ai_call",
      detail: { run_id: runId, model, phase_key: run.phase_key, phase_binding: binding?.phaseKey ?? null },
    }, () => fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${LOVABLE_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: "```json\n" + JSON.stringify(sample).slice(0, charBudget) + "\n```" },
        ],
        response_format: { type: "json_object" },
      }),
    }));
    const aiLatency = Date.now() - aiStart;

    if (!aiResp.ok) {
      const t = await aiResp.text();
      throw new Error(`AI gateway ${aiResp.status}: ${t.slice(0, 200)}`);
    }

    const aiJson = await aiResp.json();
    const usage = aiJson?.usage ?? {};
    const promptTok = usage.prompt_tokens ?? 0;
    const completionTok = usage.completion_tokens ?? 0;
    const prices = PRICING[model] ?? { in: 0, out: 0 };
    const cost = (promptTok / 1_000_000) * prices.in + (completionTok / 1_000_000) * prices.out;

    let parsed: any = {};
    try { parsed = JSON.parse(aiJson?.choices?.[0]?.message?.content ?? "{}"); } catch { parsed = {}; }

    const phaseBindingRef = binding
      ? { phaseKey: binding.phaseKey, contractStore: binding.contract.store, adrs: binding.adrs }
      : null;

    await sb.from("ai_usage_log").insert({
      job: "overnight-phase-runner",
      model, trigger: "cron",
      status: "ok", status_code: 200, latency_ms: aiLatency,
      prompt_tokens: promptTok, completion_tokens: completionTok,
      total_tokens: usage.total_tokens ?? promptTok + completionTok,
      cost_usd: Number(cost.toFixed(6)),
      price_in_per_mtok: prices.in, price_out_per_mtok: prices.out,
      request_ref: { run_id: runId, phase_key: run.phase_key, night_mode: isNightUTC(), phase_binding: phaseBindingRef },
    });

    // Contract-bound phases: hard-validate the envelope. Failure → auto_blocked
    // with no retry — the AI ignored a load-bearing contract.
    if (binding) {
      const parseRes = OvernightResponseEnvelopeSchema.safeParse(parsed);
      let reason: string | null = null;
      if (!parseRes.success) {
        reason = `envelope schema invalid: ${parseRes.error.issues.map((i) => i.path.join(".") + ":" + i.message).join("; ").slice(0, 300)}`;
      } else {
        reason = rejectEnvelope(binding, parseRes.data);
      }
      if (reason) {
        clearInterval(hbTimer);
        await sb.from("roadmap_phase_overnight_runs").update({
          status: "auto_blocked",
          finished_at: new Date().toISOString(),
          heartbeat_at: null,
          last_error: `contract envelope rejected: ${reason}`.slice(0, 500),
          error: `contract envelope rejected: ${reason}`.slice(0, 500),
          result: { phase_binding: phaseBindingRef, raw: parsed, model, cost_usd: Number(cost.toFixed(6)) },
        }).eq("id", runId);
        await dispatchAlert(sb, "overnight-phase-runner-15m", "contract_envelope_rejected",
          `phase ${run.phase_key} run ${runId} blocked — ${reason}`,
          { run_id: runId, phase_key: run.phase_key, phase_binding: phaseBindingRef });
        return { run_id: runId, status: "auto_blocked", reason };
      }
      const env = parseRes.data;
      clearInterval(hbTimer);
      await sb.from("roadmap_phase_overnight_runs").update({
        status: "done",
        finished_at: new Date().toISOString(),
        heartbeat_at: new Date().toISOString(),
        result: {
          summary: env.summary.slice(0, 4000),
          risks: env.risks.slice(0, 10),
          recommendations: env.recommendations.slice(0, 10),
          contract_acknowledged: env.contract_acknowledged,
          guardrails_respected: env.guardrails_respected,
          would_violate: env.would_violate,
          phase_binding: phaseBindingRef,
          model, cost_usd: Number(cost.toFixed(6)),
          prompt_tokens: promptTok, completion_tokens: completionTok,
        },
      }).eq("id", runId);
      return { run_id: runId, status: "done", model, cost_usd: Number(cost.toFixed(6)), phase_binding: binding.phaseKey };
    }

    // Unbound phases (phase-1..4): preserve original behaviour.
    clearInterval(hbTimer);
    await sb.from("roadmap_phase_overnight_runs").update({
      status: "done",
      finished_at: new Date().toISOString(),
      heartbeat_at: new Date().toISOString(),
      result: {
        summary: String(parsed.summary ?? "").slice(0, 4000),
        risks: Array.isArray(parsed.risks) ? parsed.risks.slice(0, 10) : [],
        recommendations: Array.isArray(parsed.recommendations) ? parsed.recommendations.slice(0, 10) : [],
        model, cost_usd: Number(cost.toFixed(6)),
        prompt_tokens: promptTok, completion_tokens: completionTok,
      },
    }).eq("id", runId);

    return { run_id: runId, status: "done", model, cost_usd: Number(cost.toFixed(6)) };
  } catch (err) {
    clearInterval(hbTimer);
    const msg = err instanceof Error ? err.message : String(err);
    const willRetry = attempts < (run.max_retries ?? 3);
    const patch: Record<string, unknown> = {
      status: willRetry ? "queued" : "auto_blocked",
      heartbeat_at: null,
      last_error: msg.slice(0, 500),
      error: msg.slice(0, 500),
    };
    if (willRetry) patch.started_at = null;
    else patch.finished_at = new Date().toISOString();
    await sb.from("roadmap_phase_overnight_runs").update(patch).eq("id", runId);
    return { run_id: runId, status: willRetry ? "requeued" : "auto_blocked", attempts, error: msg };
  }
}

Deno.serve(withLogger("overnight-phase-runner", async (req, ctx) => {
  const reqId = ctx.requestId;
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const provided = req.headers.get("x-service-token");
  const auth = req.headers.get("authorization") ?? "";
  const triggeredBySvc = !!SERVICE_TOKEN && provided === SERVICE_TOKEN;
  const sb = createClient(SUPABASE_URL, SERVICE_ROLE);

  if (!triggeredBySvc && !auth.startsWith("Bearer ")) {
    // Make the auth failure visible — this is exactly what was silently swallowing
    // every cron tick when the AWIP_SERVICE_TOKEN row in app_secrets was missing.
    const reason = !provided
      ? "missing x-service-token header (cron secret not populated?)"
      : !SERVICE_TOKEN
        ? "AWIP_SERVICE_TOKEN env var not set on edge function"
        : "service token mismatch";
    const job = "overnight-phase-runner-15m";
    const detail = { provided_present: !!provided, service_token_env_present: !!SERVICE_TOKEN };
    await sb.from("automation_runs").insert({
      job, trigger: "cron", status: "error", status_code: 401,
      message: reason, detail,
      request_id: reqId,
    });
    await dispatchAlert(sb, job, "auth_failed", `${job} 401 — ${reason}`, detail);
    return json({ error: "unauthorized", reason }, 401);
  }
  const body = req.method === "POST" ? await req.json().catch(() => ({})) : {};
  const explicitRun = body?.run_id ? String(body.run_id) : null;

  // Cron: only act inside the night window unless an explicit run_id was supplied.
  // Still log a heartbeat to automation_runs so sentinel-tick's cron-silence
  // check sees the cron is alive (otherwise daytime ticks 06:00–22:00 UTC look
  // like a 16-hour silence and trip a high finding).
  if (triggeredBySvc && !explicitRun && !isNightUTC()) {
    await sb.from("automation_runs").insert({
      job: "overnight-phase-runner-15m",
      trigger: "cron",
      status: "ok",
      status_code: 200,
      duration_ms: 0,
      message: "skipped: outside_night_window",
      detail: { utc_hour: new Date().getUTCHours(), skipped: true },
      request_id: reqId,
    });
    return json({ skipped: "outside_night_window", utc_hour: new Date().getUTCHours() });
  }

  let runIds: string[];
  if (explicitRun) {
    runIds = [explicitRun];
  } else {
    const today = new Date().toISOString().slice(0, 10);
    const { data: rows } = await sb
      .from("roadmap_phase_overnight_runs")
      .select("id")
      .eq("status", "queued")
      .lte("scheduled_for", today)
      .order("requested_at", { ascending: true })
      .limit(20);
    runIds = (rows ?? []).map((r: any) => r.id);
  }

  const startedAt = Date.now();
  const trigger = triggeredBySvc ? "cron" : "manual";
  const recordRun = async (status: string, status_code: number, message: string, detail: Record<string, unknown>) => {
    try {
      await sb.from("automation_runs").insert({
        job: "overnight-phase-runner-15m", trigger, status, status_code,
        duration_ms: Date.now() - startedAt, message, detail,
        request_id: reqId,
      });
    } catch (e) { console.error("automation_runs insert failed", e); }
  };

  if (runIds.length === 0) {
    await recordRun("ok", 200, "no queued runs", { processed: 0 });
    return json({ processed: 0, results: [] });
  }

  const results = [];
  for (const id of runIds) {
    results.push(await processRun(sb, id));
  }
  const failed = results.filter((r: any) => r.status === "failed").length;
  await recordRun(
    failed === 0 ? "ok" : "partial",
    failed === 0 ? 200 : 207,
    `${results.length} run(s) processed${failed ? ` · ${failed} failed` : ""}`,
    { processed: results.length, failed, run_ids: runIds, explicit: !!explicitRun },
  );
  return json({ processed: results.length, results });
}));
