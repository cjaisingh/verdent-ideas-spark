// Operator Inbox: layered kind classifier.
//
// Layer 1 — prefix/hashtag rules (deterministic, zero AI cost).
// Layer 2 — LLM fallback via Lovable AI Gateway (cheap model).
// Layer 3 — manual override is handled in the UI, never here.
//
// Returns null when no kind can be determined (caller leaves operator_messages.kind = null).

import { logAiUsage } from "./ai-usage.ts";
import { pickModel } from "./model-policy.ts";

export type InboxKind = "idea" | "research" | "suggestion" | "question" | "chat";
export type KindSource = "prefix" | "llm";

export type InboxKindResult = {
  kind: InboxKind | null;
  kind_source: KindSource | null;
  confidence: number | null;
  summary?: string | null;
};

const PREFIX_RULES: Array<{ re: RegExp; kind: InboxKind }> = [
  { re: /^\s*(?:\/idea\b|#idea\b|idea\s*:)/i, kind: "idea" },
  { re: /^\s*(?:\/research\b|#research\b|research\s*:)/i, kind: "research" },
  { re: /^\s*(?:\/suggest\b|#suggest\b|#suggestion\b|suggestion\s*:)/i, kind: "suggestion" },
  { re: /^\s*(?:\/ask\b|#ask\b)/i, kind: "question" },
  { re: /^\s*\/chat\b/i, kind: "chat" },
];

export function classifyByPrefix(text: string): InboxKindResult | null {
  if (!text) return null;
  for (const r of PREFIX_RULES) {
    if (r.re.test(text)) {
      return { kind: r.kind, kind_source: "prefix", confidence: 1 };
    }
  }
  // Trailing "?" → question (only if no other prefix matched).
  if (/\?\s*$/.test(text.trim())) {
    return { kind: "question", kind_source: "prefix", confidence: 0.8 };
  }
  return null;
}

const AI_URL = "https://ai.gateway.lovable.dev/v1/chat/completions";

const inboxKindTool = {
  type: "function",
  function: {
    name: "classify_inbox_kind",
    description:
      "Classify a short operator message into an inbox kind so it can be triaged or auto-promoted to a discussion action.",
    parameters: {
      type: "object",
      properties: {
        kind: {
          type: "string",
          enum: ["idea", "research", "suggestion", "question", "chat"],
          description:
            "idea = new feature/product thought. research = please look into / dig up info. suggestion = improvement to existing AWIP. question = informational ask, no action needed. chat = small talk, status check, greeting.",
        },
        summary: { type: "string", description: "≤ 80 char summary suitable as an action title." },
        confidence: { type: "number", description: "0..1 confidence." },
      },
      required: ["kind", "summary", "confidence"],
      additionalProperties: false,
    },
  },
} as const;

export async function classifyByLlm(
  text: string,
  // deno-lint-ignore no-explicit-any
  sb: any,
): Promise<InboxKindResult | null> {
  const apiKey = Deno.env.get("LOVABLE_API_KEY");
  if (!apiKey) return null;
  if (!text || text.trim().length < 12) return null;
  const model = pickModel("google/gemini-2.5-flash-lite");
  const started = Date.now();
  let status = 0;
  let error: string | null = null;
  let result: InboxKindResult | null = null;
  try {
    const res = await fetch(AI_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        messages: [
          {
            role: "system",
            content:
              "You triage short operator messages addressed to AWIP, an automation/operator console. Always call classify_inbox_kind. Be strict: chat/question for anything that is not a clear idea, research request, or improvement suggestion.",
          },
          { role: "user", content: text },
        ],
        tools: [inboxKindTool],
        tool_choice: { type: "function", function: { name: "classify_inbox_kind" } },
      }),
    });
    status = res.status;
    if (!res.ok) {
      error = `HTTP ${res.status}`;
      return null;
    }
    const data = await res.json();
    const args = data?.choices?.[0]?.message?.tool_calls?.[0]?.function?.arguments;
    if (!args) {
      error = "no_tool_call";
      return null;
    }
    const parsed = JSON.parse(args);
    result = {
      kind: parsed.kind,
      kind_source: "llm",
      confidence: typeof parsed.confidence === "number" ? parsed.confidence : null,
      summary: parsed.summary ?? null,
    };
    return result;
  } catch (e) {
    error = e instanceof Error ? e.message : "unknown";
    return null;
  } finally {
    try {
      await logAiUsage(sb, {
        job: "route-operator-message:inbox-kind",
        model,
        trigger: "service",
        status: error ? "error" : "ok",
        status_code: status || null,
        latency_ms: Date.now() - started,
        error,
        request_ref: { kind: result?.kind ?? null, conf: result?.confidence ?? null },
      });
    } catch (_) { /* swallow */ }
  }
}

export async function classifyInboxKind(
  text: string,
  // deno-lint-ignore no-explicit-any
  sb: any,
): Promise<InboxKindResult> {
  const p = classifyByPrefix(text);
  if (p) return p;
  const l = await classifyByLlm(text, sb);
  if (l) return l;
  return { kind: null, kind_source: null, confidence: null };
}
