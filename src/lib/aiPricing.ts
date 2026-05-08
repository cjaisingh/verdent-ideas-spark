// USD per 1M tokens — Lovable AI Gateway list prices (approximate, used for estimation only).
// Update when gateway pricing changes.
export type ModelPricing = { in: number; out: number };

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

// Pre-change baseline used to compute the "estimated cost had we kept the old model".
export const JOB_BASELINE_MODEL: Record<string, string> = {
  "daily-plan": "openai/gpt-5",
  "scheduled-code-review": "openai/gpt-5",
  "qa-validate": "openai/gpt-5",
  "night-agent-open": "openai/gpt-5",
  "night-agent-close": "openai/gpt-5",
};

export function costFor(model: string, promptTok: number, completionTok: number): number {
  const p = MODEL_PRICING[model];
  if (!p) return 0;
  return (promptTok / 1_000_000) * p.in + (completionTok / 1_000_000) * p.out;
}

export function fmtUsd(n: number): string {
  if (!isFinite(n) || n === 0) return "$0.0000";
  if (n < 0.01) return `$${n.toFixed(4)}`;
  if (n < 1) return `$${n.toFixed(3)}`;
  return `$${n.toFixed(2)}`;
}

export function fmtTok(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return `${n}`;
}
