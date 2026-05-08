// SSE streaming chat with Gemini 2.5 Pro for a discussion thread on a code-review finding.
// Auth: operator JWT. Persists assistant turns into roadmap_finding_discussion_messages.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const SYSTEM_PROMPT = `You are Copilot, a senior staff engineer triaging a code-review finding with the operator.
Be concise, concrete, and push toward a recordable decision: accept_risk, mitigate, convert_to_task, or dismiss.
When useful, ask one focused question. When you have enough context, propose a decision and a one-line rationale.`;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
    const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) {
      return json({ error: "LOVABLE_API_KEY not configured" }, 500);
    }

    const authHeader = req.headers.get("Authorization") ?? "";
    if (!authHeader) return json({ error: "missing authorization" }, 401);

    // Validate operator role using a user-scoped client
    const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userRes } = await userClient.auth.getUser();
    const user = userRes?.user;
    if (!user) return json({ error: "not authenticated" }, 401);
    const { data: hasOp } = await userClient.rpc("has_role", {
      _user_id: user.id,
      _role: "operator",
    });
    if (!hasOp) return json({ error: "operator role required" }, 403);

    const body = await req.json().catch(() => ({}));
    const discussionId = String(body?.discussion_id ?? "");
    const userMessage = String(body?.user_message ?? "").trim();
    if (!discussionId) return json({ error: "discussion_id required" }, 400);
    if (!userMessage) return json({ error: "user_message required" }, 400);

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE);

    // Load discussion + finding
    const { data: disc, error: dErr } = await admin
      .from("roadmap_finding_discussions")
      .select("id, finding_id, mode")
      .eq("id", discussionId)
      .maybeSingle();
    if (dErr || !disc) return json({ error: "discussion not found" }, 404);
    if (disc.mode !== "copilot") return json({ error: "discussion is not in copilot mode" }, 400);

    const { data: finding } = await admin
      .from("roadmap_review_findings")
      .select("id, title, body, severity, category, area, reviewer_model, reviewed_at")
      .eq("id", disc.finding_id)
      .maybeSingle();
    if (!finding) return json({ error: "finding not found" }, 404);

    // Load last 30 messages
    const { data: history } = await admin
      .from("roadmap_finding_discussion_messages")
      .select("role, body")
      .eq("discussion_id", discussionId)
      .order("created_at", { ascending: true })
      .limit(30);

    // Persist incoming user message
    await admin.from("roadmap_finding_discussion_messages").insert({
      discussion_id: discussionId,
      role: "user",
      source: "text",
      body: userMessage,
    });

    const findingContext = `Finding under review:
- Title: ${finding.title}
- Severity: ${finding.severity}
- Category: ${finding.category ?? "—"} / Area: ${finding.area ?? "—"}
- Reviewer model: ${finding.reviewer_model}
- Reviewed at: ${finding.reviewed_at}

Body:
${finding.body ?? "(no body)"}`;

    const messages = [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "system", content: findingContext },
      ...(history ?? []).map((h: any) => ({
        role: h.role === "copilot" ? "assistant" : h.role === "system" ? "system" : "user",
        content: h.body,
      })),
      { role: "user", content: userMessage },
    ];

    const upstream = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-pro",
        messages,
        stream: true,
        reasoning: { effort: "medium" },
      }),
    });

    if (!upstream.ok || !upstream.body) {
      if (upstream.status === 429) return json({ error: "Rate limit exceeded, please try again shortly." }, 429);
      if (upstream.status === 402) return json({ error: "AI credits exhausted. Add credits in workspace settings." }, 402);
      const text = await upstream.text();
      console.error("upstream error", upstream.status, text);
      return json({ error: "AI gateway error" }, 502);
    }

    // Tee the stream: pass tokens through to client AND collect for persistence.
    const reader = upstream.body.getReader();
    const decoder = new TextDecoder();
    const encoder = new TextEncoder();
    let assistantText = "";

    const stream = new ReadableStream({
      async start(controller) {
        let buffer = "";
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            const chunk = decoder.decode(value, { stream: true });
            buffer += chunk;
            controller.enqueue(encoder.encode(chunk));

            // Parse SSE lines for assistant text accumulation
            let nl: number;
            while ((nl = buffer.indexOf("\n")) !== -1) {
              let line = buffer.slice(0, nl);
              buffer = buffer.slice(nl + 1);
              if (line.endsWith("\r")) line = line.slice(0, -1);
              if (!line.startsWith("data: ")) continue;
              const data = line.slice(6).trim();
              if (data === "[DONE]") continue;
              try {
                const parsed = JSON.parse(data);
                const delta = parsed?.choices?.[0]?.delta?.content;
                if (typeof delta === "string") assistantText += delta;
              } catch {/* partial */}
            }
          }
        } catch (e) {
          console.error("stream error", e);
        } finally {
          controller.close();
          if (assistantText.trim().length > 0) {
            await admin.from("roadmap_finding_discussion_messages").insert({
              discussion_id: discussionId,
              role: "copilot",
              source: "text",
              body: assistantText,
              model: "google/gemini-2.5-pro",
            });
          }
        }
      },
    });

    return new Response(stream, {
      headers: { ...corsHeaders, "Content-Type": "text/event-stream" },
    });
  } catch (e) {
    console.error("finding-discuss-copilot error", e);
    return json({ error: e instanceof Error ? e.message : "unknown error" }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
