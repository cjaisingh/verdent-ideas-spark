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
      name: "propose_decision",
      description:
        "Stage an approval decision for operator confirmation. Returns a human-readable summary and a confirmation_token. " +
        "MUST be called before confirm_decision. Read the summary back to the operator and ask them to confirm out loud.",
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
      name: "confirm_decision",
      description:
        "Commit a previously proposed decision. Only call AFTER the operator has explicitly confirmed " +
        "(e.g. 'yes', 'go ahead', 'confirm'). Pass the confirmation_token returned by propose_decision.",
      parameters: {
        type: "object",
        properties: {
          confirmation_token: { type: "string" },
        },
        required: ["confirmation_token"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "cancel_pending_decision",
      description: "Discard a staged decision if the operator says no, cancel, or wants to change it.",
      parameters: {
        type: "object",
        properties: { confirmation_token: { type: "string" } },
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
  {
    type: "function",
    function: {
      name: "list_notebook",
      description: "List notebook entries (thoughts, issues, research, suggestions, todos). Use to discuss what's open or what needs attention.",
      parameters: {
        type: "object",
        properties: {
          kind: { type: "string", enum: ["thought","issue","research","suggestion","todo"] },
          status: { type: "string", enum: ["open","in_progress","resolved","archived"] },
          search: { type: "string" },
          limit: { type: "number" },
        },
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "add_notebook_entry",
      description: "Create a new notebook entry. Use when the operator asks to capture a thought, research note, todo, issue, or suggestion.",
      parameters: {
        type: "object",
        properties: {
          title: { type: "string" },
          body: { type: "string" },
          kind: { type: "string", enum: ["thought","issue","research","suggestion","todo"] },
          status: { type: "string", enum: ["open","in_progress","resolved","archived"] },
          tags: { type: "array", items: { type: "string" } },
          pinned: { type: "boolean" },
        },
        required: ["title", "kind"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "update_notebook_entry",
      description: "Update an existing notebook entry by id (e.g. mark resolved, change status, edit body, pin).",
      parameters: {
        type: "object",
        properties: {
          id: { type: "string" },
          title: { type: "string" },
          body: { type: "string" },
          kind: { type: "string", enum: ["thought","issue","research","suggestion","todo"] },
          status: { type: "string", enum: ["open","in_progress","resolved","archived"] },
          tags: { type: "array", items: { type: "string" } },
          pinned: { type: "boolean" },
        },
        required: ["id"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "remember_lesson",
      description:
        "Save a durable rule the operator wants you to follow on every future turn. " +
        "Call this when the operator says 'learn from this', 'remember that', 'next time…', or 'from now on…'. " +
        "Phrase the lesson as a one-sentence imperative rule. Never store secrets, credentials, or PII.",
      parameters: {
        type: "object",
        properties: {
          lesson: { type: "string", description: "One-sentence rule, ≤500 chars." },
          scope: { type: "string", enum: ["global","notebook","approvals","voice_style"] },
        },
        required: ["lesson"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "list_lessons",
      description: "List active lessons Copilot has been taught.",
      parameters: { type: "object", properties: {}, additionalProperties: false },
    },
  },
  {
    type: "function",
    function: {
      name: "forget_lesson",
      description: "Delete a previously saved lesson by id (when operator says 'forget that' / 'unlearn that').",
      parameters: {
        type: "object",
        properties: { id: { type: "string" } },
        required: ["id"],
        additionalProperties: false,
      },
    },
  },
];

const SYSTEM_PROMPT = `You are AWIP Copilot — the operator's hands-free voice assistant while driving.
British English, conversational, brief. Reply in 1-3 short sentences unless asked for detail.
You can inspect AWIP state and act on approvals via the provided tools.
When the operator asks "what's pending" or "anything to look at", call list_pending_approvals.
Never read out UUIDs or long IDs aloud — summarise instead.

APPROVAL FLOW (two steps, mandatory):
1. When the operator wants to approve or reject something, call propose_decision FIRST.
   Then read the returned summary aloud and ask: "Shall I confirm?" (or similar).
2. Only after the operator says yes / go ahead / confirm, call confirm_decision with the token.
   If they say no, cancel, wait, or change anything, call cancel_pending_decision.
Never call confirm_decision without an immediately preceding explicit verbal confirmation.

NOTEBOOK:
- For "what's in the notebook", "what's open", "what needs doing", call list_notebook (default to status=open).
- When the operator dictates a thought, todo, research note, issue, or suggestion, call add_notebook_entry. Pick the right kind and craft a short title; put the rest in body.
- For "mark X resolved", "pin that", "archive it", call update_notebook_entry. Read the entry's title back when confirming, never the UUID.

LEARNING:
- When the operator says "learn from this", "remember that", "next time…", "from now on…", or otherwise teaches you a preference, call remember_lesson with a single-sentence imperative rule (≤500 chars). Then briefly confirm out loud, e.g. "Got it, I'll remember that." Never store secrets, credentials, or PII.
- For "what have you learned" / "list lessons", call list_lessons.
- For "forget that" / "unlearn …", call forget_lesson with the matching id (look it up via list_lessons first if needed).
- Lessons currently in force are listed under "LESSONS LEARNED" below — honour them on every turn.

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

type StagedDecision = {
  token: string;
  id: string;
  decision: "approved" | "rejected";
  note?: string;
  activity: string;
  risk: string;
  module: string;
  summary: string;
  staged_at: number;
};
type Lesson = { id: string; lesson: string; scope: string; active: boolean };
type Session = {
  jwt: string;
  user_id: string;
  staged: StagedDecision | null;
  lessons: Lesson[];
  model: string;
};

const STAGE_TTL_MS = 5 * 60 * 1000;

function summariseApproval(item: any, decision: string, note?: string): string {
  const activity = item?.activity ?? "unknown activity";
  const risk = item?.risk ?? "unknown";
  const module = item?.requesting_module ?? "unknown module";
  const payloadPreview = item?.intent_payload
    ? JSON.stringify(item.intent_payload).slice(0, 200)
    : "";
  return [
    `About to ${decision === "approved" ? "APPROVE" : "REJECT"} a ${risk}-risk ${activity}`,
    `from ${module}.`,
    payloadPreview ? `Details: ${payloadPreview}.` : "",
    note ? `Note: "${note}".` : "",
    `Confirm to commit.`,
  ].filter(Boolean).join(" ");
}

async function dispatchTool(name: string, args: any, session: Session) {
  const jwt = session.jwt;
  switch (name) {
    case "list_pending_approvals":
      return callAwip("/approvals?status=pending", "GET", jwt);

    case "propose_decision": {
      if (!["approved", "rejected"].includes(args.decision)) {
        return { status: 400, data: { error: "decision must be approved or rejected" } };
      }
      const fetched = await callAwip(`/approvals/${args.id}`, "GET", jwt);
      if (fetched.status !== 200) {
        return { status: fetched.status, data: { error: "could not fetch approval", detail: fetched.data } };
      }
      const item = (fetched.data as any)?.approval ?? fetched.data;
      if (!item || item.status !== "pending") {
        return {
          status: 409,
          data: { error: `approval is not pending (status=${item?.status ?? "unknown"})` },
        };
      }
      const token = crypto.randomUUID();
      const summary = summariseApproval(item, args.decision, args.note);
      session.staged = {
        token,
        id: args.id,
        decision: args.decision,
        note: args.note,
        activity: item.activity,
        risk: item.risk,
        module: item.requesting_module ?? "unknown",
        summary,
        staged_at: Date.now(),
      };
      return {
        status: 200,
        data: {
          confirmation_token: token,
          summary,
          activity: item.activity,
          risk: item.risk,
          module: item.requesting_module,
          decision: args.decision,
          instructions: "Read the summary aloud and ask the operator to confirm. " +
            "Then call confirm_decision with this token only after they say yes.",
        },
      };
    }

    case "confirm_decision": {
      const staged = session.staged;
      if (!staged) {
        return { status: 400, data: { error: "no decision staged. Call propose_decision first." } };
      }
      if (staged.token !== args.confirmation_token) {
        return { status: 400, data: { error: "confirmation_token does not match staged decision" } };
      }
      if (Date.now() - staged.staged_at > STAGE_TTL_MS) {
        session.staged = null;
        return { status: 410, data: { error: "staged decision expired. Re-propose." } };
      }
      const result = await callAwip(`/approvals/${staged.id}/decide`, "POST", jwt, {
        decision: staged.decision, note: staged.note,
      });
      session.staged = null;
      return result;
    }

    case "cancel_pending_decision": {
      const had = !!session.staged;
      session.staged = null;
      return { status: 200, data: { cancelled: had } };
    }

    case "list_capabilities":
      return callAwip(`/capabilities${args.status ? `?status=${args.status}` : ""}`, "GET", jwt);
    case "recent_events":
      return callAwip(`/events/recent?limit=${args.limit ?? 50}`, "GET", jwt);
    case "get_okr_tree":
      return callAwip(`/okr/tree?tenant_id=${args.tenant_id}`, "GET", jwt);
    case "list_notebook": {
      const qs = new URLSearchParams();
      if (args.kind) qs.set("kind", args.kind);
      if (args.status) qs.set("status", args.status);
      if (args.search) qs.set("search", args.search);
      if (args.limit) qs.set("limit", String(args.limit));
      const q = qs.toString();
      return callAwip(`/notebook${q ? `?${q}` : ""}`, "GET", jwt);
    }
    case "add_notebook_entry":
      return callAwip(`/notebook`, "POST", jwt, args);
    case "update_notebook_entry": {
      const { id, ...rest } = args;
      return callAwip(`/notebook/${id}`, "PATCH", jwt, rest);
    }
    case "remember_lesson": {
      const result = await callAwip(`/lessons`, "POST", jwt, {
        lesson: args.lesson, scope: args.scope ?? "global", source: "voice",
      });
      // Refresh local cache so it applies to the very next turn.
      if (result.status === 200 && (result.data as any)?.lesson) {
        session.lessons = [...session.lessons, (result.data as any).lesson];
      }
      return result;
    }
    case "list_lessons":
      return callAwip(`/lessons?active=true`, "GET", jwt);
    case "forget_lesson": {
      const result = await callAwip(`/lessons/${args.id}`, "DELETE", jwt);
      if (result.status === 200) {
        session.lessons = session.lessons.filter(l => l.id !== args.id);
      }
      return result;
    }
    default:
      return { status: 400, data: { error: `unknown tool ${name}` } };
  }
}


// ---------- LLM "think" step ----------
async function think(history: any[], session: Session): Promise<string> {
  const lessonBlock = session.lessons.length
    ? `\n\nLESSONS LEARNED (always honour these unless the operator overrides):\n` +
      session.lessons.map(l => `- ${l.lesson}`).join("\n")
    : "";
  const messages = [{ role: "system", content: SYSTEM_PROMPT + lessonBlock }, ...history];
  // Up to 3 tool-call rounds.
  for (let round = 0; round < 3; round++) {
    const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: session.model || "openai/gpt-5-mini",
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
        const result = await dispatchTool(tc.function.name, args, session);
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
async function authorizeOperator(jwt: string): Promise<{ ok: boolean; user_id?: string }> {
  const { data, error } = await supa.auth.getUser(jwt);
  if (error || !data.user) return { ok: false };
  const { data: roles } = await supa
    .from("user_roles").select("role").eq("user_id", data.user.id);
  const ok = !!roles?.some((r: any) => r.role === "operator" || r.role === "admin");
  return { ok, user_id: ok ? data.user.id : undefined };
}

async function loadOperatorContext(user_id: string): Promise<{ lessons: Lesson[]; model: string }> {
  const [lessonsRes, settingsRes] = await Promise.all([
    supa.from("copilot_lessons").select("id,lesson,scope,active").eq("active", true).order("created_at", { ascending: false }).limit(50),
    supa.from("copilot_settings").select("model").eq("user_id", user_id).maybeSingle(),
  ]);
  return {
    lessons: (lessonsRes.data ?? []) as Lesson[],
    model: (settingsRes.data?.model as string) || "openai/gpt-5-mini",
  };
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
  const session: Session = { jwt: "", user_id: "", staged: null, lessons: [], model: "openai/gpt-5-mini" };
  let history: any[] = [];
  let thinking = false;
  let transcriptId: string | null = null;
  let turnOrd = 0;

  const recordTurn = async (role: "user" | "assistant", content: string, latency_ms?: number) => {
    if (!transcriptId || !content) return;
    try {
      turnOrd += 1;
      await supa.from("copilot_transcript_turns").insert({
        transcript_id: transcriptId, ord: turnOrd, role, content,
        model: role === "assistant" ? session.model : null,
        latency_ms: latency_ms ?? null,
      });
      await supa.from("copilot_transcripts")
        .update({ turn_count: turnOrd, ended_at: new Date().toISOString() })
        .eq("id", transcriptId);
    } catch (e) { console.warn("recordTurn failed", e); }
  };
  let settings: {
    stt_model: string;
    tts_voice: string;
    language: string;
    greeting: string;
    agent_slug?: string | null;
    system_prompt?: string | null;
  } = {
    stt_model: "nova-3",
    tts_voice: "aura-2-orion-en",
    language: "en",
    greeting: "Copilot ready.",
    agent_slug: null,
    system_prompt: null,
  };

  client.onmessage = async (ev) => {
    // Client first sends auth, then we open Deepgram.
    if (typeof ev.data === "string") {
      let msg: any;
      try { msg = JSON.parse(ev.data); } catch { return; }

      // Live TTS swap — Deepgram supports UpdateSpeak on a running converse session.
      if (msg.type === "update_voice" && typeof msg.voice === "string") {
        settings.tts_voice = msg.voice;
        if (dg && dg.readyState === WebSocket.OPEN) {
          try {
            dg.send(JSON.stringify({
              type: "UpdateSpeak",
              speak: { provider: { type: "deepgram", model: msg.voice } },
            }));
          } catch (e) {
            console.warn("UpdateSpeak failed", e);
          }
        }
        return;
      }

      if (msg.type === "auth") {
        session.jwt = msg.jwt;
        const authz = await authorizeOperator(session.jwt);
        if (!authz.ok || !authz.user_id) {
          client.send(JSON.stringify({ type: "error", error: "not_operator" }));
          client.close(4401, "unauthorized");
          return;
        }
        session.user_id = authz.user_id;
        try {
          const ctx = await loadOperatorContext(authz.user_id);
          session.lessons = ctx.lessons;
          session.model = ctx.model;
        } catch (e) {
          console.warn("loadOperatorContext failed", e);
        }
        // Subscribe to live lesson changes so future turns reflect them.
        try {
          supa.channel(`lessons-${authz.user_id}`)
            .on("postgres_changes", { event: "*", schema: "public", table: "copilot_lessons" }, async () => {
              const ctx = await loadOperatorContext(authz.user_id!);
              session.lessons = ctx.lessons;
            })
            .subscribe();
        } catch (e) { console.warn("realtime subscribe failed", e); }
        // Apply per-session settings overrides from client.
        if (msg.settings && typeof msg.settings === "object") {
          settings = { ...settings, ...msg.settings };
        }
        // Open transcript record for this session.
        try {
          const { data: t } = await supa.from("copilot_transcripts").insert({
            user_id: session.user_id,
            agent_slug: settings.agent_slug ?? null,
            model: session.model,
          }).select("id").single();
          transcriptId = t?.id ?? null;
        } catch (e) { console.warn("transcript create failed", e); }
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
              language: settings.language,
              listen: { provider: { type: "deepgram", model: settings.stt_model } },
              // No-op think provider: we generate the actual reply ourselves
              // (see ConversationText handler below) and inject via
              // InjectAgentMessage. This stops Deepgram's built-in brain from
              // also replying, which previously produced two voiced answers.
              think: {
                provider: { type: "open_ai", model: "noop", temperature: 0 },
                endpoint: {
                  url: `${SUPABASE_URL}/functions/v1/copilot-noop-llm/v1/chat/completions`,
                  headers: {},
                },
                prompt: "Respond with an empty string. Another system handles replies.",
              },
              speak: { provider: { type: "deepgram", model: settings.tts_voice } },
              greeting: settings.greeting,
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
                recordTurn("user", m.content);
                const t0 = Date.now();
                try {
                  const reply = await think(history, session);
                  if (reply) {
                    history.push({ role: "assistant", content: reply });
                    recordTurn("assistant", reply, Date.now() - t0);
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
