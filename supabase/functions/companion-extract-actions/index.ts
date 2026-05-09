// Extract actionable follow-ups from a Companion thread transcript.
// Auth: operator JWT. Returns {proposals: [...]}; client decides what to persist.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { pickModel } from "../_shared/model-policy.ts";
import { withLogger } from "../_shared/logger.ts";
import { logAiCall } from "../_shared/ai-usage.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const SYSTEM_PROMPT = `You extract concrete, actionable follow-ups from a discussion between an operator and an AI companion about the AWIP project.
Return STRICT JSON only — no prose, no markdown — matching:
{"actions":[{"title":"<<=80 chars>","details":"<optional 1-3 sentences>","priority":"low|med|high","owner_hint":"<optional, e.g. lovable|operator>","confidence":0.0}]}
Rules:
- Each action must be a discrete next step a human/coding-agent can do (e.g. "Add RLS on companion_messages", not "consider security").
- Skip vague intent or items already completed in the transcript.
- 0-6 actions. If nothing actionable, return {"actions":[]}.
- priority: high = blocks release/security, med = should do soon, low = nice-to-have.
- confidence: 0.0-1.0 — your certainty this is a real, distinct action.`;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(withLogger("companion-extract-actions", async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
    const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) return json({ error: "LOVABLE_API_KEY not configured" }, 500);

    const auth = req.headers.get("Authorization") ?? "";
    if (!auth) return json({ error: "missing authorization" }, 401);

    const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: auth } },
    });
    const { data: userRes } = await userClient.auth.getUser();
    const user = userRes?.user;
    if (!user) return json({ error: "not authenticated" }, 401);
    const { data: hasOp } = await userClient.rpc("has_role", { _user_id: user.id, _role: "operator" });
    if (!hasOp) return json({ error: "operator role required" }, 403);

    const body = await req.json().catch(() => ({}));
    const threadId = String(body?.thread_id ?? "");
    if (!threadId) return json({ error: "thread_id required" }, 400);

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE);
    const { data: thread } = await admin
      .from("companion_threads")
      .select("id, title, agent_kind, created_by")
      .eq("id", threadId)
      .maybeSingle();
    if (!thread) return json({ error: "thread not found" }, 404);
    if (thread.created_by !== user.id) return json({ error: "forbidden" }, 403);

    const { data: msgs } = await admin
      .from("companion_messages")
      .select("role, content, created_at")
      .eq("thread_id", threadId)
      .order("created_at", { ascending: true });

    if (!msgs || msgs.length === 0) return json({ proposals: [] });

    const transcript = msgs
      .map((m: any) => `[${m.role}] ${m.content}`)
      .join("\n\n")
      .slice(0, 16000);

    const model = pickModel("google/gemini-2.5-flash");
    const aiStart = Date.now();
    const upstream = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: `Subject: ${thread.title ?? "(untitled)"} (${thread.agent_kind})\n\nTranscript:\n${transcript}` },
        ],
        response_format: { type: "json_object" },
      }),
    });

    if (!upstream.ok) {
      const t = await upstream.text();
      await logAiCall(admin, { job: "companion-extract-actions", model, trigger: "user", startedAt: aiStart, response: upstream, errorText: t, request_ref: { thread_id: threadId } });
      if (upstream.status === 429) return json({ error: "Rate limited" }, 429);
      if (upstream.status === 402) return json({ error: "AI credits exhausted" }, 402);
      console.error("upstream", upstream.status, t);
      return json({ error: "AI gateway error" }, 502);
    }

    const out = await upstream.json();
    await logAiCall(admin, { job: "companion-extract-actions", model, trigger: "user", startedAt: aiStart, response: upstream, json: out, request_ref: { thread_id: threadId } });
    const content = out?.choices?.[0]?.message?.content ?? "{}";
    let parsed: any = {};
    try { parsed = JSON.parse(content); } catch { parsed = { actions: [] }; }
    const actions = Array.isArray(parsed?.actions) ? parsed.actions : [];

    const proposals = actions.slice(0, 6).map((a: any) => ({
      title: String(a?.title ?? "").slice(0, 200),
      details: a?.details ? String(a.details).slice(0, 2000) : null,
      priority: ["low", "med", "high"].includes(a?.priority) ? a.priority : "med",
      owner_hint: a?.owner_hint ? String(a.owner_hint).slice(0, 80) : null,
      confidence: typeof a?.confidence === "number" ? Math.max(0, Math.min(1, a.confidence)) : null,
    })).filter((p: any) => p.title.length > 0);

    return json({ proposals, thread_id: threadId });
  } catch (e) {
    console.error("companion-extract-actions error", e);
    return json({ error: e instanceof Error ? e.message : "unknown" }, 500);
  }
}));
