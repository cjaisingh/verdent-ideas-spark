// Copilot voice — server-side WebSocket proxy.
// Browser ↔ this function ↔ Deepgram Voice Agent.
// Deepgram does STT + TTS; we host the LLM "think" step ourselves by intercepting
// `ConversationText` events, calling Lovable AI Gateway (gpt-5-mini) with AWIP tools,
// and feeding the reply back via `InjectAgentMessage`. Tools call awip-api with the
// operator's JWT (passed in the WS open subprotocol) so RLS + audit still apply.
//
// Client connects: wss://<project>.functions.supabase.co/copilot-voice
// First message from client must be JSON: { type: "auth", jwt: "<supabase access token>" }

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const DEEPGRAM_API_KEY = Deno.env.get("DEEPGRAM_API_KEY");
const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const AWIP_API_BASE = `${SUPABASE_URL}/functions/v1/awip-api`;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// ---------- AWIP tools exposed to the LLM ----------
const TOOLS = [
  {
    type: "function",
    function: {
      name: "list_pending_approvals",
      description: "List approval-queue items currently pending operator decision.",
      parameters: { type: "object", properties: {}, additionalProperties: false },
    },
  },
  {
    type: "function",
    function: {
      name: "decide_approval",
      description: "Approve or reject a pending approval by id.",
      parameters: {
        type: "object",
        properties: {
          id: { type: "string", description: "approval_queue.id (UUID)" },
          decision: { type: "string", enum: ["approved", "rejected"] },
          note: { type: "string" },
        },
        required: ["id", "decision"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "list_capabilities",
      description: "List AWIP capabilities, optionally filtered by status.",
      parameters: {
        type: "object",
        properties: { status: { type: "string" } },
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "recent_events",
      description: "Recent OKR/capability events (last 50).",
      parameters: {
        type: "object",
        properties: { limit: { type: "number" } },
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_okr_tree",
      description: "Fetch OKR tree for a tenant.",
      parameters: {
        type: "object",
        properties: { tenant_id: { type: "string" } },
        required: ["tenant_id"],
        additionalProperties: false,
      },
    },
  },
];

const SYSTEM_PROMPT = `You are AWIP Copilot — the operator's hands-free voice assistant while driving.
British English, conversational, brief. Reply in 1-3 short sentences unless asked for detail.
You can inspect AWIP state and act on approvals via the provided tools.
When the operator asks "what's pending" or "anything to look at", call list_pending_approvals.
Never read out UUIDs or long IDs aloud — summarise instead. Confirm before approving anything.
If unsure, ask one short clarifying question.`;

// ---------- AWIP tool dispatcher ----------
async function callAwip(path: string, method: string, jwt: string, body?: unknown) {
  const res = await fetch(`${AWIP_API_BASE}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${jwt}`,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  try { return { status: res.status, data: JSON.parse(text) }; }
  catch { return { status: res.status, data: text }; }
}

async function dispatchTool(name: string, args: any, jwt: string) {
  switch (name) {
    case "list_pending_approvals":
      return callAwip("/approvals?status=pending", "GET", jwt);
    case "decide_approval":
      return callAwip(`/approvals/${args.id}/decide`, "POST", jwt, {
        decision: args.decision, note: args.note,
      });
    case "list_capabilities":
      return callAwip(`/capabilities${args.status ? `?status=${args.status}` : ""}`, "GET", jwt);
    case "recent_events":
      return callAwip(`/events/recent?limit=${args.limit ?? 50}`, "GET", jwt);
    case "get_okr_tree":
      return callAwip(`/okr/tree?tenant_id=${args.tenant_id}`, "GET", jwt);
    default:
      return { status: 400, data: { error: `unknown tool ${name}` } };
  }
}

// ---------- LLM "think" step ----------
async function think(history: any[], jwt: string): Promise<string> {
  const messages = [{ role: "system", content: SYSTEM_PROMPT }, ...history];
  // Up to 3 tool-call rounds.
  for (let round = 0; round < 3; round++) {
    const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "openai/gpt-5-mini",
        messages,
        tools: TOOLS,
        tool_choice: "auto",
      }),
    });
    if (!res.ok) {
      const t = await res.text();
      console.error("LLM error", res.status, t);
      return "Sorry, I'm having trouble reaching the brain right now.";
    }
    const data = await res.json();
    const msg = data.choices?.[0]?.message;
    if (!msg) return "I didn't get a response.";
    if (msg.tool_calls?.length) {
      messages.push(msg);
      for (const tc of msg.tool_calls) {
        let args: any = {};
        try { args = JSON.parse(tc.function.arguments || "{}"); } catch {}
        const result = await dispatchTool(tc.function.name, args, jwt);
        messages.push({
          role: "tool",
          tool_call_id: tc.id,
          content: JSON.stringify(result.data).slice(0, 4000),
        });
      }
      continue;
    }
    return msg.content || "";
  }
  return "I got stuck in a loop. Try rephrasing.";
}

// ---------- Authorize JWT ----------
const supa = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
async function isOperator(jwt: string): Promise<boolean> {
  const { data, error } = await supa.auth.getUser(jwt);
  if (error || !data.user) return false;
  const { data: roles } = await supa
    .from("user_roles").select("role").eq("user_id", data.user.id);
  return !!roles?.some((r: any) => r.role === "operator" || r.role === "admin");
}

// ---------- WebSocket bridge ----------
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const upgrade = req.headers.get("upgrade") || "";
  if (upgrade.toLowerCase() !== "websocket") {
    return new Response("Expected websocket", { status: 426, headers: corsHeaders });
  }
  if (!DEEPGRAM_API_KEY || !LOVABLE_API_KEY) {
    return new Response("server not configured", { status: 500, headers: corsHeaders });
  }

  const { socket: client, response } = Deno.upgradeWebSocket(req);
  let dg: WebSocket | null = null;
  let jwt = "";
  let history: any[] = [];
  let thinking = false;

  client.onmessage = async (ev) => {
    // Client first sends auth, then we open Deepgram.
    if (typeof ev.data === "string") {
      let msg: any;
      try { msg = JSON.parse(ev.data); } catch { return; }

      if (msg.type === "auth") {
        jwt = msg.jwt;
        if (!(await isOperator(jwt))) {
          client.send(JSON.stringify({ type: "error", error: "not_operator" }));
          client.close(4401, "unauthorized");
          return;
        }
        // Open Deepgram Voice Agent socket.
        dg = new WebSocket("wss://agent.deepgram.com/v1/agent/converse", [
          "token", DEEPGRAM_API_KEY,
        ]);
        dg.onopen = () => {
          dg!.send(JSON.stringify({
            type: "Settings",
            audio: {
              input: { encoding: "linear16", sample_rate: 16000 },
              output: { encoding: "linear16", sample_rate: 24000, container: "none" },
            },
            agent: {
              language: "en",
              listen: { provider: { type: "deepgram", model: "nova-3" } },
              think: {
                // We supply replies via InjectAgentMessage; use a no-op provider.
                provider: { type: "open_ai", model: "gpt-4o-mini", temperature: 0.3 },
                prompt: SYSTEM_PROMPT,
              },
              speak: { provider: { type: "deepgram", model: "aura-2-orion-en" } },
              greeting: "Copilot ready.",
            },
          }));
          client.send(JSON.stringify({ type: "ready" }));
        };
        dg.onmessage = async (dev) => {
          if (typeof dev.data === "string") {
            // Forward control events to client (transcripts, agent state).
            client.send(dev.data);
            try {
              const m = JSON.parse(dev.data);
              if (m.type === "ConversationText" && m.role === "user" && !thinking) {
                thinking = true;
                history.push({ role: "user", content: m.content });
                try {
                  const reply = await think(history, jwt);
                  if (reply) {
                    history.push({ role: "assistant", content: reply });
                    dg!.send(JSON.stringify({ type: "InjectAgentMessage", content: reply }));
                  }
                } catch (e) {
                  console.error("think failed", e);
                } finally {
                  thinking = false;
                }
              }
            } catch {}
          } else {
            // Binary audio from Deepgram → forward to client.
            client.send(dev.data);
          }
        };
        dg.onerror = (e) => console.error("dg error", e);
        dg.onclose = () => { try { client.close(); } catch {} };
        return;
      }
    } else if (dg && dg.readyState === WebSocket.OPEN) {
      // Binary mic audio from client → forward to Deepgram.
      dg.send(ev.data);
    }
  };

  client.onclose = () => { try { dg?.close(); } catch {} };
  client.onerror = () => { try { dg?.close(); } catch {} };

  return response;
});
