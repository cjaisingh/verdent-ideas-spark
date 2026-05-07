// No-op OpenAI-compatible chat completions endpoint.
// Used as Deepgram Voice Agent's `think` provider so its built-in brain stays
// silent. The real reply is generated server-side in copilot-voice and spoken
// via InjectAgentMessage.

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve((req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const body = {
    id: `chatcmpl-noop-${crypto.randomUUID()}`,
    object: "chat.completion",
    created: Math.floor(Date.now() / 1000),
    model: "noop",
    choices: [{
      index: 0,
      message: { role: "assistant", content: "" },
      finish_reason: "stop",
    }],
    usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
  };
  return new Response(JSON.stringify(body), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
