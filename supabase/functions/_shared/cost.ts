// Cost estimation for Lovable AI Gateway calls — mirror of src/lib/aiPricing.ts.
// Use to attach { cost_usd, prompt_tokens, completion_tokens, model } to any
// automation_runs.detail payload so the cost_actuals_30d view can roll it up.

export type ModelPricing = { in: number; out: number }; // USD per 1M tokens

export const MODEL_PRICING: Record<string, ModelPricing> = {
  "google/gemini-2.5-flash-lite": { in: 0.10, out: 0.40 },
  "google/gemini-2.5-flash": { in: 0.30, out: 2.50 },
  "google/gemini-2.5-pro": { in: 1.25, out: 10.00 },
  "google/gemini-3-flash-preview": { in: 0.30, out: 2.50 },
  "google/gemini-3.1-pro-preview": { in: 1.25, out: 10.00 },
  "openai/gpt-5-nano": { in: 0.05, out: 0.40 },
  "openai/gpt-5-mini": { in: 0.25, out: 2.00 },
  "openai/gpt-5": { in: 1.25, out: 10.00 },
  "openai/gpt-5.2": { in: 1.25, out: 10.00 },
};

export function costFor(model: string, promptTok: number, completionTok: number): number {
  const p = MODEL_PRICING[model];
  if (!p) return 0;
  return (promptTok / 1_000_000) * p.in + (completionTok / 1_000_000) * p.out;
}

/** Build the standard cost fields to merge into automation_runs.detail. */
export function costDetail(
  model: string,
  usage: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number } | null | undefined,
): { model: string; prompt_tokens: number; completion_tokens: number; cost_usd: number } {
  const pt = usage?.prompt_tokens ?? 0;
  const ct = usage?.completion_tokens ?? Math.max(0, (usage?.total_tokens ?? 0) - pt);
  return {
    model,
    prompt_tokens: pt,
    completion_tokens: ct,
    cost_usd: Number(costFor(model, pt, ct).toFixed(6)),
  };
}
