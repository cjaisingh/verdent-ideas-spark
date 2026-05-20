// Shared helper: insert into public.ai_usage_log with loud failure logging.
// Use from every edge function that calls Lovable AI Gateway so /admin/ai-usage
// and the AutomationPanel cost rollups stay in sync.
//
// Pricing fields (price_in_per_mtok / price_out_per_mtok / cost_usd) are
// derived from the model name via _shared/cost.ts unless caller overrides.

import { MODEL_PRICING, costFor } from "./cost.ts";

type SbLike = {
  from: (table: string) => {
    insert: (row: Record<string, unknown>) => Promise<{ error: unknown }>;
  };
};

export type AiUsageInput = {
  job: string;                       // function/job name, e.g. "lessons-synthesize"
  model: string;                     // e.g. "google/gemini-2.5-flash"
  trigger?: string;                  // "cron" | "manual" | "user" | "service" ...
  status?: "ok" | "error";
  status_code?: number | null;
  latency_ms?: number | null;
  prompt_tokens?: number | null;
  completion_tokens?: number | null;
  total_tokens?: number | null;
  cost_usd?: number | null;          // override; otherwise computed from model+tokens
  error?: string | null;
  request_ref?: Record<string, unknown> | null;
  task_id?: string | null;           // roadmap_tasks.id when call is attributable to a task
  module?: string | null;            // feature slug; helps the sprint cost rollup
};

/**
 * Insert one ai_usage_log row. Never throws.
 * Failures are logged to console.error so Supabase edge logs surface them.
 */
export async function logAiUsage(sb: SbLike, input: AiUsageInput): Promise<void> {
  const pt = input.prompt_tokens ?? 0;
  const ct = input.completion_tokens ?? Math.max(0, (input.total_tokens ?? 0) - pt);
  const price = MODEL_PRICING[input.model];
  const cost = input.cost_usd ?? Number(costFor(input.model, pt, ct).toFixed(6));

  const row: Record<string, unknown> = {
    job: input.job,
    model: input.model,
    trigger: input.trigger ?? "manual",
    status: input.status ?? "ok",
    status_code: input.status_code ?? null,
    latency_ms: input.latency_ms ?? null,
    prompt_tokens: input.prompt_tokens ?? null,
    completion_tokens: input.completion_tokens ?? null,
    total_tokens: input.total_tokens ?? (pt + ct || null),
    cost_usd: cost,
    price_in_per_mtok: price?.in ?? null,
    price_out_per_mtok: price?.out ?? null,
    error: input.error ?? null,
    request_ref: input.request_ref ?? {},
  };

  try {
    const { error } = await sb.from("ai_usage_log").insert(row);
    if (error) {
      console.error(`[ai-usage] insert failed for job=${input.job} model=${input.model}:`, error);
    }
  } catch (e) {
    console.error(`[ai-usage] threw for job=${input.job} model=${input.model}:`, e);
  }
}

/**
 * Convenience wrapper: pass the upstream Response + parsed JSON and we'll
 * derive status/usage automatically. Returns the parsed JSON unchanged.
 */
export async function logAiCall(
  sb: SbLike,
  args: {
    job: string;
    model: string;
    trigger?: string;
    startedAt: number;
    response: Response;
    json?: { usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number } } | null;
    errorText?: string | null;
    request_ref?: Record<string, unknown> | null;
  },
): Promise<void> {
  const latency = Date.now() - args.startedAt;
  const ok = args.response.ok;
  const usage = args.json?.usage ?? {};
  await logAiUsage(sb, {
    job: args.job,
    model: args.model,
    trigger: args.trigger,
    status: ok ? "ok" : "error",
    status_code: args.response.status,
    latency_ms: latency,
    prompt_tokens: usage.prompt_tokens ?? null,
    completion_tokens: usage.completion_tokens ?? null,
    total_tokens: usage.total_tokens ?? null,
    error: ok ? null : (args.errorText ?? `HTTP ${args.response.status}`).slice(0, 500),
    request_ref: args.request_ref ?? null,
  });
}
