// Companion cloud chat proxy: streams from Lovable AI Gateway as SSE.
// Auth: operator JWT. Returns OpenAI-compatible SSE chunks (data: {...}\n\n + [DONE]).
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { pickModel } from "../_shared/model-policy.ts";
import { logAiUsage } from "../_shared/ai-usage.ts";
import { withLogger } from "../_shared/logger.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const ALLOWED_MODELS = new Set([
  "google/gemini-3-flash-preview",
  "google/gemini-3.1-flash-lite-preview",
  "google/gemini-3.1-pro-preview",
  "google/gemini-2.5-pro",
  "google/gemini-2.5-flash",
  "google/gemini-2.5-flash-lite",
  "openai/gpt-5",
  "openai/gpt-5-mini",
  "openai/gpt-5-nano",
  "openai/gpt-5.2",
]);

Deno.serve(withLogger("companion-cloud-chat", async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "method_not_allowed" }), {
      status: 405,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // Auth: operator JWT only (no service-token path — this is interactive).
  const authHeader = req.headers.get("Authorization") ?? "";
  const jwt = authHeader.replace(/^Bearer\s+/i, "");
  if (!jwt) {
    return new Response(JSON.stringify({ error: "unauthorized" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
    { global: { headers: { Authorization: `Bearer ${jwt}` } } },
  );
  const { data: userData, error: userErr } = await supabase.auth.getUser();
  if (userErr || !userData.user) {
    return new Response(JSON.stringify({ error: "unauthorized" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  let body: { model?: string; messages?: Array<{ role: string; content: string }> };
  try { body = await req.json(); } catch {
    return new Response(JSON.stringify({ error: "invalid_json" }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
  const messages = body.messages ?? [];
  if (!Array.isArray(messages) || messages.length === 0) {
    return new Response(JSON.stringify({ error: "messages_required" }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
  const requested = body.model ?? "google/gemini-2.5-flash";
  const safeRequested = ALLOWED_MODELS.has(requested) ? requested : "google/gemini-2.5-flash";
  // Night window forces cheapest model — same policy as every other AI job.
  const model = pickModel(safeRequested);

  const apiKey = Deno.env.get("LOVABLE_API_KEY");
  if (!apiKey) {
    return new Response(JSON.stringify({ error: "lovable_api_key_missing" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const admin = createClient(Deno.env.get("SUPABASE_URL")!, SERVICE_ROLE, { auth: { persistSession: false } });

  const aiStart = Date.now();
  const upstream = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({ model, messages, stream: true }),
  });

  if (!upstream.ok || !upstream.body) {
    const txt = await upstream.text().catch(() => "");
    await logAiUsage(admin, {
      job: "companion-cloud-chat", model, trigger: "user",
      status: "error", status_code: upstream.status, latency_ms: Date.now() - aiStart,
      error: txt.slice(0, 500), request_ref: { user_id: userData.user.id, streamed: true },
    });
    const status = upstream.status === 429 || upstream.status === 402 ? upstream.status : 502;
    return new Response(JSON.stringify({
      error: "gateway_error",
      status: upstream.status,
      detail: txt.slice(0, 500),
      model,
    }), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }

  // Tee the SSE stream so we can count assistant chars for approx usage logging.
  const promptChars = messages.reduce((s, m) => s + (m.content?.length ?? 0), 0);
  let completionChars = 0;
  const decoder = new TextDecoder();
  const transform = new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      try {
        const text = decoder.decode(chunk, { stream: true });
        for (const line of text.split("\n")) {
          if (!line.startsWith("data: ")) continue;
          const data = line.slice(6).trim();
          if (!data || data === "[DONE]") continue;
          try {
            const j = JSON.parse(data);
            const delta = j?.choices?.[0]?.delta?.content;
            if (typeof delta === "string") completionChars += delta.length;
          } catch { /* partial */ }
        }
      } catch { /* ignore */ }
      controller.enqueue(chunk);
    },
    flush() {
      // Fire-and-forget: log approximate usage when stream ends.
      logAiUsage(admin, {
        job: "companion-cloud-chat", model, trigger: "user",
        status: "ok", status_code: 200, latency_ms: Date.now() - aiStart,
        prompt_tokens: Math.ceil(promptChars / 4),
        completion_tokens: Math.ceil(completionChars / 4),
        request_ref: { user_id: userData.user.id, streamed: true, approx: true },
      });
    },
  });

  return new Response(upstream.body.pipeThrough(transform), {
    headers: {
      ...corsHeaders,
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      "X-Companion-Model": model,
    },
  });
}));
