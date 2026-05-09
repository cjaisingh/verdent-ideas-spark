import { withLogger } from "../_shared/logger.ts";
// No-op OpenAI-compatible chat completions endpoint.
// Used as Deepgram Voice Agent's `think` provider so its built-in brain stays
// silent. The real reply is generated server-side in copilot-voice and spoken
// via InjectAgentMessage. Supports both streaming (SSE) and non-streaming.

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(withLogger("copilot-noop-llm", async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  let stream = false;
  try {
    const body = await req.json();
    stream = !!body?.stream;
  } catch { /* ignore */ }

  const id = `chatcmpl-noop-${crypto.randomUUID()}`;
  const created = Math.floor(Date.now() / 1000);

  if (stream) {
    const encoder = new TextEncoder();
    const sse = new ReadableStream({
      start(controller) {
        const first = {
          id, object: "chat.completion.chunk", created, model: "noop",
          choices: [{ index: 0, delta: { role: "assistant", content: "" }, finish_reason: null }],
        };
        const done = {
          id, object: "chat.completion.chunk", created, model: "noop",
          choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
        };
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(first)}\n\n`));
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(done)}\n\n`));
        controller.enqueue(encoder.encode(`data: [DONE]\n\n`));
        controller.close();
      },
    });
    return new Response(sse, {
      headers: {
        ...corsHeaders,
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        "Connection": "keep-alive",
      },
    });
  }

  return new Response(JSON.stringify({
    id, object: "chat.completion", created, model: "noop",
    choices: [{ index: 0, message: { role: "assistant", content: "" }, finish_reason: "stop" }],
    usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
  }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
}));
