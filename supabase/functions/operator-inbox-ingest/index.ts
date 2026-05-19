// Operator Inbox — manual paste + manual re-classify entrypoint.
//
// POST /operator-inbox-ingest
//   { text: string, source?: 'manual_paste' }            — create a new operator_messages row, classify, auto-promote
//   { message_id: uuid, kind: InboxKind | null }         — manual kind override; promotes/demotes accordingly
//
// Auth: operator JWT only (no service token — this is a UI affordance).

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { z } from "https://esm.sh/zod@3.23.8";
import { withLogger } from "../_shared/logger.ts";
import { classifyInboxKind, type InboxKind } from "../_shared/classifyInboxKind.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const PasteSchema = z.object({
  text: z.string().min(1).max(8000),
  source: z.literal("manual_paste").optional(),
});
const KindEnum = z.enum(["idea", "research", "suggestion", "question", "chat"]);
const ReclassifySchema = z.object({
  message_id: z.string().uuid(),
  kind: KindEnum.nullable().optional(),
  action: z.enum(["promote", "unpromote"]).optional(),
}).refine((v) => v.kind !== undefined || v.action !== undefined, {
  message: "kind or action required",
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

const MANUAL_PASTE_CHAT_ID = -1;

Deno.serve(withLogger("operator-inbox-ingest", async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const ANON = Deno.env.get("SUPABASE_ANON_KEY")!;

  const auth = req.headers.get("authorization") ?? "";
  if (!auth.startsWith("Bearer ")) return json({ error: "unauthorized" }, 401);

  const userClient = createClient(SUPABASE_URL, ANON, { global: { headers: { Authorization: auth } } });
  const token = auth.replace(/^Bearer\s+/i, "");
  const { data: claims } = await userClient.auth.getClaims(token);
  const userId = claims?.claims?.sub as string | undefined;
  if (!userId) return json({ error: "unauthorized" }, 401);

  const sb = createClient(SUPABASE_URL, SERVICE);
  const { data: isOperator } = await sb.rpc("has_role", { _user_id: userId, _role: "operator" });
  if (!isOperator) return json({ error: "forbidden" }, 403);

  const body = await req.json().catch(() => ({}));

  // Reclassify / promote / unpromote path
  if ("message_id" in body) {
    const parsed = ReclassifySchema.safeParse(body);
    if (!parsed.success) return json({ error: parsed.error.flatten() }, 400);

    const { data: msg } = await sb
      .from("operator_messages")
      .select("id, text, kind, promoted_action_id, chat_id, raw")
      .eq("id", parsed.data.message_id)
      .maybeSingle();
    if (!msg) return json({ error: "not_found" }, 404);

    // Unpromote: cancel the linked action and clear pointer
    if (parsed.data.action === "unpromote") {
      let cancelled_action_id: string | null = null;
      if (msg.promoted_action_id) {
        await sb
          .from("discussion_actions")
          .update({ status: "cancelled" })
          .eq("id", msg.promoted_action_id);
        cancelled_action_id = msg.promoted_action_id as string;
      }
      await sb
        .from("operator_messages")
        .update({ promoted_action_id: null })
        .eq("id", msg.id);
      return json({ ok: true, unpromoted: true, cancelled_action_id, promoted_action_id: null });
    }

    // Apply kind change if provided (skip when only `action: promote` was sent)
    const newKind = parsed.data.kind !== undefined ? parsed.data.kind : (msg.kind as InboxKind | null);
    if (parsed.data.kind !== undefined) {
      await sb
        .from("operator_messages")
        .update({
          kind: parsed.data.kind,
          kind_source: "manual",
          kind_confidence: 1,
        })
        .eq("id", parsed.data.message_id);
    }

    // Promote logic:
    // - explicit { action: 'promote' } promotes regardless of kind (uses current/new kind for details)
    // - kind change to actionable auto-promotes if not already promoted
    const actionable = new Set(["idea", "research", "suggestion"]);
    const shouldPromote =
      parsed.data.action === "promote"
        ? !msg.promoted_action_id
        : (!!newKind && actionable.has(newKind) && !msg.promoted_action_id);

    let promoted_action_id = msg.promoted_action_id as string | null;
    if (shouldPromote) {
      const fromUser = (msg.raw as any)?.message?.from
        ?? (msg.raw as any)?.channel_post?.from
        ?? null;
      const fromTag = fromUser?.username ? `@${fromUser.username}` : "manual";
      const text = msg.text ?? "";
      const promoteNote = parsed.data.action === "promote"
        ? "_promoted manually by operator (forced)_"
        : "_promoted manually by operator_";
      const { data: inserted, error: insErr } = await sb
        .from("discussion_actions")
        .insert({
          subject_type: "operator_message",
          subject_id: msg.id,
          title: text.slice(0, 80) || "(operator inbox)",
          details: [text, "", promoteNote, `_kind: ${newKind ?? "unspecified"}_`].join("\n"),
          status: "open",
          priority: "med",
          risk: "low",
          source: "operator_inbox",
          owner: fromTag,
        })
        .select("id")
        .maybeSingle();
      if (inserted?.id) {
        promoted_action_id = inserted.id;
        await sb.from("operator_messages").update({ promoted_action_id }).eq("id", msg.id);
      } else if (insErr && /duplicate|unique/i.test(insErr.message)) {
        const { data: existing } = await sb
          .from("discussion_actions")
          .select("id")
          .eq("subject_type", "operator_message")
          .eq("subject_id", msg.id)
          .maybeSingle();
        promoted_action_id = existing?.id ?? null;
        if (promoted_action_id) {
          await sb.from("operator_messages").update({ promoted_action_id }).eq("id", msg.id);
        }
      }
    }

    return json({ ok: true, kind: newKind, promoted_action_id });
  }

  // Paste path
  const parsed = PasteSchema.safeParse(body);
  if (!parsed.success) return json({ error: parsed.error.flatten() }, 400);

  // Make sure the synthetic manual_paste source exists in operator_inbox_sources.
  await sb.from("operator_inbox_sources").upsert({
    chat_id: MANUAL_PASTE_CHAT_ID,
    kind: "dm",
    label: "Manual paste",
    enabled: true,
    notes: "Operator-pasted text from /operator-inbox UI",
  }, { onConflict: "chat_id" });

  // Synthetic update_id: negative ts to avoid clashes with real Telegram update_ids.
  const synthUpdateId = -Date.now();
  const { data: inserted, error } = await sb
    .from("operator_messages")
    .insert({
      update_id: synthUpdateId,
      chat_id: MANUAL_PASTE_CHAT_ID,
      direction: "inbound",
      source: "manual_paste",
      text: parsed.data.text,
      raw: { _manual_paste: true, pasted_by: userId },
    })
    .select("id")
    .maybeSingle();
  if (error || !inserted) return json({ error: error?.message ?? "insert_failed" }, 500);

  // Classify + auto-promote inline (no need to bounce through route-operator-message)
  const kindResult = await classifyInboxKind(parsed.data.text, sb);
  let promoted_action_id: string | null = null;
  if (kindResult.kind) {
    await sb
      .from("operator_messages")
      .update({
        kind: kindResult.kind,
        kind_source: kindResult.kind_source,
        kind_confidence: kindResult.confidence,
      })
      .eq("id", inserted.id);

    const actionable = new Set(["idea", "research", "suggestion"]);
    if (actionable.has(kindResult.kind)) {
      const summary = kindResult.summary ?? parsed.data.text;
      const { data: act, error: insErr } = await sb
        .from("discussion_actions")
        .insert({
          subject_type: "operator_message",
          subject_id: inserted.id,
          title: (summary || parsed.data.text).slice(0, 80),
          details: [parsed.data.text, "", "_pasted manually by operator_", `_kind: ${kindResult.kind} (${kindResult.kind_source})_`].join("\n"),
          status: "open",
          priority: "med",
          risk: "low",
          source: "operator_inbox",
          owner: "manual",
        })
        .select("id")
        .maybeSingle();
      promoted_action_id = act?.id ?? null;
      if (promoted_action_id) {
        await sb.from("operator_messages").update({ promoted_action_id }).eq("id", inserted.id);
      } else if (insErr) {
        console.error("paste auto-promote failed", insErr);
      }
    }
  }

  return json({
    ok: true,
    message_id: inserted.id,
    kind: kindResult.kind,
    kind_source: kindResult.kind_source,
    promoted_action_id,
  });
}));
