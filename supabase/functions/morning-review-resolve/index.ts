// Resolve a morning-review panel discussion as Fix / Cancel / Escalate.
// Auth: operator JWT. Single endpoint that:
//   - "fix": create or append a discussion_actions job (deduped by morning_review_panel_ref)
//   - "cancel": close discussion with a reason note, no job
//   - "escalate": same as fix + risk='high', priority='high', plus a sentinel_findings row
// Always closes the discussion with the chosen outcome and stamps panel triage server-side.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { withLogger } from "../_shared/logger.ts";
import { logAiUsage } from "../_shared/ai-usage.ts";
import { pickModel } from "../_shared/model-policy.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

type Action = "fix" | "cancel" | "escalate";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

async function summarizeChat(
  apiKey: string,
  panelTitle: string | null,
  panelRef: string,
  messages: { role: string; body: string }[],
): Promise<{ summary: string; model: string }> {
  const model = pickModel("google/gemini-3-flash-preview");
  if (!apiKey || messages.length === 0) {
    return { summary: "", model };
  }
  const transcript = messages.map((m) => `${m.role.toUpperCase()}: ${m.body}`).join("\n");
  const prompt = `Summarize this morning-review panel discussion as exactly 3 bullets, each on its own line, prefixed with "- ":
1. The problem
2. The proposed action / fix
3. The owner or next step (write "operator" if unknown)

Panel: ${panelTitle ?? panelRef}

Discussion:
${transcript.slice(0, 6000)}`;
  try {
    const r = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: "You write concise, concrete operator notes. No preamble." },
          { role: "user", content: prompt },
        ],
      }),
    });
    if (!r.ok) return { summary: "", model };
    const j = await r.json();
    const text = j?.choices?.[0]?.message?.content ?? "";
    return { summary: String(text).trim(), model };
  } catch {
    return { summary: "", model };
  }
}

Deno.serve(withLogger("morning-review-resolve", async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405);

  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
    const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY") ?? "";

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
    const action = String(body?.action ?? "") as Action;
    const reason = String(body?.reason ?? "").trim();
    const titleOverride = String(body?.title ?? "").trim();
    const dueAtIso: string | null = body?.due_at ? String(body.due_at) : null;
    if (!discussionId) return json({ error: "discussion_id required" }, 400);
    if (!["fix", "cancel", "escalate"].includes(action)) {
      return json({ error: "action must be fix|cancel|escalate" }, 400);
    }
    if (action === "cancel" && reason.length === 0) {
      return json({ error: "reason required for cancel" }, 400);
    }

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE);

    const { data: disc, error: dErr } = await admin
      .from("morning_review_discussions")
      .select("id, review_id, panel_ref, panel_title, closed_at")
      .eq("id", discussionId)
      .maybeSingle();
    if (dErr || !disc) return json({ error: "discussion not found" }, 404);
    if (disc.closed_at) return json({ error: "discussion already closed" }, 409);

    const panelRef = disc.panel_ref as string;
    const panelTitle = (disc.panel_title as string | null) ?? panelRef;

    const { data: review } = await admin
      .from("morning_reviews")
      .select("id, review_date")
      .eq("id", disc.review_id)
      .maybeSingle();
    const reviewDate = review?.review_date ?? null;

    let actionId: string | null = null;
    let shortNum: number | null = null;
    let findingId: string | null = null;
    let triageState: "focus" | "revisit" | "done" | "skip" | null = null;
    let outcome: "fixed" | "cancelled" | "escalated" = "fixed";

    if (action === "cancel") {
      outcome = "cancelled";
      triageState = "done";
      await admin.from("morning_review_discussion_messages").insert({
        discussion_id: discussionId,
        role: "system",
        body: `Cancelled: ${reason}`,
      });
    } else {
      // Fix or Escalate: build a summary + details and upsert a discussion_action.
      const { data: msgs } = await admin
        .from("morning_review_discussion_messages")
        .select("role, body, created_at")
        .eq("discussion_id", discussionId)
        .order("created_at", { ascending: true });

      const sumStart = Date.now();
      const { summary, model: sumModel } = await summarizeChat(
        LOVABLE_API_KEY, panelTitle, panelRef, msgs ?? [],
      );
      if (summary) {
        await logAiUsage(admin, {
          job: "morning-review-resolve", model: sumModel, trigger: "user",
          status: "ok", status_code: 200, latency_ms: Date.now() - sumStart,
          prompt_tokens: Math.ceil((msgs ?? []).reduce((s, m) => s + (m.body?.length ?? 0), 0) / 4),
          completion_tokens: Math.ceil(summary.length / 4),
          request_ref: { discussion_id: discussionId, panel_ref: panelRef, action },
        }).catch(() => {});
      }

      const lastSix = (msgs ?? []).slice(-6)
        .map((m: any) => `[${m.role}] ${String(m.body).slice(0, 400)}`)
        .join("\n");
      const detailsBlock = [
        `Panel: ${panelTitle} (${panelRef})`,
        reviewDate ? `Morning Review: ${reviewDate}` : null,
        `Discussion: morning_review_discussions/${discussionId}`,
        "",
        summary ? `Summary:\n${summary}` : null,
        "",
        lastSix ? `Last turns:\n${lastSix}` : null,
      ].filter(Boolean).join("\n");

      const isEscalate = action === "escalate";
      outcome = isEscalate ? "escalated" : "fixed";
      triageState = "revisit";

      // Dedupe: existing open job for the same panel?
      const { data: existing } = await admin
        .from("discussion_actions")
        .select("id, short_num, details")
        .eq("morning_review_panel_ref", panelRef)
        .eq("status", "open")
        .maybeSingle();

      if (existing) {
        const appended = `${existing.details ?? ""}\n\n--- additional resolution ${new Date().toISOString()} (${action}) ---\n${detailsBlock}`;
        const patch: Record<string, unknown> = { details: appended.slice(0, 16000) };
        if (isEscalate) {
          patch.risk = "high";
          patch.priority = "high";
          patch.night_eligible = false;
          patch.night_override_reason = null;
        }
        await admin.from("discussion_actions").update(patch).eq("id", existing.id);
        actionId = existing.id;
        shortNum = existing.short_num;
      } else {
        const titleBase = titleOverride
          || `[MR ${reviewDate ?? ""}] ${panelTitle}`.replace(/\s+/g, " ").trim();
        const ins: Record<string, unknown> = {
          title: titleBase.slice(0, 240),
          details: detailsBlock.slice(0, 16000),
          status: "open",
          priority: isEscalate ? "high" : "med",
          risk: isEscalate ? "high" : "med",
          night_eligible: !isEscalate,
          source: "manual",
          subject_type: "morning_review_panel",
          subject_id: disc.review_id,
          morning_review_panel_ref: panelRef,
          created_by: user.id,
          owner: user.email ?? null,
          due_at: dueAtIso,
        };
        const { data: created, error: insErr } = await admin
          .from("discussion_actions")
          .insert(ins)
          .select("id, short_num")
          .single();
        if (insErr || !created) {
          return json({ error: insErr?.message ?? "could not create job" }, 500);
        }
        actionId = created.id;
        shortNum = created.short_num;
      }

      // Echo into the chat history
      await admin.from("morning_review_discussion_messages").insert({
        discussion_id: discussionId,
        role: "system",
        body: isEscalate
          ? `Escalated as job #${shortNum} (risk=high, priority=high).`
          : `Queued as job #${shortNum}.`,
      });

      if (isEscalate && actionId) {
        const dedupe = `operator_escalation:${actionId}`;
        const { data: f } = await admin
          .from("sentinel_findings")
          .upsert({
            kind: "operator_escalation",
            severity: "high",
            subject_ref: { discussion_action_id: actionId, short_num: shortNum, panel_ref: panelRef },
            summary: `Operator escalation: ${panelTitle} → job #${shortNum}`,
            payload: { reviewDate, source: "morning-review-resolve" },
            status: "open",
            dedupe_key: dedupe,
            last_seen_at: new Date().toISOString(),
          }, { onConflict: "dedupe_key" })
          .select("id")
          .single();
        findingId = f?.id ?? null;
      }
    }

    // Close the discussion
    await admin.from("morning_review_discussions")
      .update({ closed_at: new Date().toISOString(), outcome })
      .eq("id", discussionId);

    // Stamp panel triage server-side
    if (triageState) {
      await admin.from("morning_review_triage").insert({
        item_kind: "panel",
        item_ref: panelRef,
        state: triageState,
        set_by: user.id,
        note: action,
      });
    }

    return json({ outcome, action_id: actionId, short_num: shortNum, finding_id: findingId });
  } catch (e) {
    console.error("morning-review-resolve error", e);
    return json({ error: e instanceof Error ? e.message : "unknown error" }, 500);
  }
}));
