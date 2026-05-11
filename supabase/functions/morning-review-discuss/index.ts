// SSE streaming chat for a Morning Review panel discussion.
// Auth: operator JWT. Persists assistant turns into morning_review_discussion_messages.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { withLogger } from "../_shared/logger.ts";
import { logAiUsage } from "../_shared/ai-usage.ts";
import { pickModel } from "../_shared/model-policy.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const SYSTEM_PROMPT = `You are AWIP's morning-review copilot, helping the operator triage one panel of today's review.
Be concise, concrete, and push toward one of four outcomes: mirror as a tracked action, defer, mark done, or skip.
When useful, ask one focused question. When you have enough context, recommend an outcome with a one-line rationale.`;

// Build a focused context string per panel kind
function panelContext(panelRef: string, review: any): string {
  const base = `Morning Review for ${review.review_date}.\nPanel: ${panelRef}.\n`;
  switch (panelRef) {
    case "stuck-cron-jobs":
      return base + `Stuck cron jobs (job, expected_within_minutes, silent_for_minutes):\n` +
        JSON.stringify(review.stuck_jobs ?? [], null, 2);
    case "promotion-drift":
      return base + `Promotion-vs-shipping drift items:\n` +
        JSON.stringify(review.promotion_drift ?? [], null, 2);
    case "night-throughput":
      return base + `Night throughput summary:\n` +
        JSON.stringify(review.night_throughput ?? {}, null, 2);
    case "open-findings":
      return base + `Open findings (medium+):\n` +
        JSON.stringify((review.open_findings ?? []).slice(0, 20), null, 2);
    case "top-actions":
      return base + `Top open actions:\n` +
        JSON.stringify(review.top_actions ?? [], null, 2);
    case "revisit":
      return base + `Deferred items now due:\n` +
        JSON.stringify(review.revisit_items ?? [], null, 2);
    default:
      return base + `Raw review payload:\n` + JSON.stringify(review, null, 2).slice(0, 4000);
  }
}

Deno.serve(withLogger("morning-review-discuss", async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
    const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) return json({ error: "LOVABLE_API_KEY not configured" }, 500);

    const authHeader = req.headers.get("Authorization") ?? "";
    if (!authHeader) return json({ error: "missing authorization" }, 401);

    const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userRes } = await userClient.auth.getUser();
    const user = userRes?.user;
    if (!user) return json({ error: "not authenticated" }, 401);
    const { data: hasOp } = await userClient.rpc("has_role", { _user_id: user.id, _role: "operator" });
    const { data: hasAdmin } = await userClient.rpc("has_role", { _user_id: user.id, _role: "admin" });
    if (!hasOp && !hasAdmin) return json({ error: "operator role required" }, 403);

    const body = await req.json().catch(() => ({}));
    const discussionId = String(body?.discussion_id ?? "");
    const userMessage = String(body?.user_message ?? "").trim();
    if (!discussionId) return json({ error: "discussion_id required" }, 400);
    if (!userMessage) return json({ error: "user_message required" }, 400);

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE);

    const { data: disc, error: dErr } = await admin
      .from("morning_review_discussions")
      .select("id, review_id, panel_ref, panel_title")
      .eq("id", discussionId)
      .maybeSingle();
    if (dErr || !disc) return json({ error: "discussion not found" }, 404);

    const { data: review } = await admin
      .from("morning_reviews")
      .select("*")
      .eq("id", disc.review_id)
      .maybeSingle();
    if (!review) return json({ error: "review not found" }, 404);

    const { data: history } = await admin
      .from("morning_review_discussion_messages")
      .select("role, body")
      .eq("discussion_id", discussionId)
      .order("created_at", { ascending: true })
      .limit(40);

    await admin.from("morning_review_discussion_messages").insert({
      discussion_id: discussionId,
      role: "user",
      body: userMessage,
    });

    const messages = [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "system", content: panelContext(disc.panel_ref, review) },
      ...(history ?? []).map((h: any) => ({ role: h.role, content: h.body })),
      { role: "user", content: userMessage },
    ];

    const MODEL = pickModel("google/gemini-2.5-pro");
    const aiStart = Date.now();
    const upstream = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ model: MODEL, messages, stream: true }),
    });

    if (!upstream.ok || !upstream.body) {
      const text = await upstream.text();
      await logAiUsage(admin, {
        job: "morning-review-discuss", model: MODEL, trigger: "user",
        status: "error", status_code: upstream.status, latency_ms: Date.now() - aiStart,
        error: text.slice(0, 500), request_ref: { discussion_id: discussionId },
      });
      if (upstream.status === 429) return json({ error: "Rate limit exceeded, please try again shortly." }, 429);
      if (upstream.status === 402) return json({ error: "AI credits exhausted. Add credits in workspace settings." }, 402);
      console.error("upstream error", upstream.status, text);
      return json({ error: "AI gateway error" }, 502);
    }

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
              } catch { /* partial */ }
            }
          }
        } catch (e) {
          console.error("stream error", e);
        } finally {
          controller.close();
          if (assistantText.trim().length > 0) {
            await admin.from("morning_review_discussion_messages").insert({
              discussion_id: discussionId,
              role: "assistant",
              body: assistantText,
              model: MODEL,
            });
          }
          const promptChars = messages.reduce((s, m) => s + (m.content?.length ?? 0), 0);
          await logAiUsage(admin, {
            job: "morning-review-discuss", model: MODEL, trigger: "user",
            status: "ok", status_code: 200, latency_ms: Date.now() - aiStart,
            prompt_tokens: Math.ceil(promptChars / 4),
            completion_tokens: Math.ceil(assistantText.length / 4),
            request_ref: { discussion_id: discussionId, panel_ref: disc.panel_ref, streamed: true, approx: true },
          });
        }
      },
    });

    return new Response(stream, {
      headers: { ...corsHeaders, "Content-Type": "text/event-stream" },
    });
  } catch (e) {
    console.error("morning-review-discuss error", e);
    return json({ error: e instanceof Error ? e.message : "unknown error" }, 500);
  }
}));

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
