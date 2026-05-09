import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { z } from 'https://esm.sh/zod@3.23.8';
import { withLogger } from "../_shared/logger.ts";
import { logAiUsage } from "../_shared/ai-usage.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-service-token',
};

const BodySchema = z.object({
  message_id: z.string().uuid().optional(),
  // Or classify ad-hoc text without persisting
  text: z.string().min(1).max(4000).optional(),
  chat_id: z.union([z.number(), z.string()]).optional(),
  requested_by: z.string().optional(),
}).refine((b) => b.message_id || b.text, { message: 'message_id or text required' });

const AI_URL = 'https://ai.gateway.lovable.dev/v1/chat/completions';

const classifyTool = {
  type: 'function',
  function: {
    name: 'classify_operator_intent',
    description:
      'Classify an operator message into a structured activity request the system can route.',
    parameters: {
      type: 'object',
      properties: {
        activity: {
          type: 'string',
          description:
            'Short snake_case verb_noun describing the requested activity, e.g. "send_message", "create_tenant", "query_status", "smalltalk", "unknown".',
        },
        summary: {
          type: 'string',
          description: 'One-sentence human-readable summary of what the operator wants.',
        },
        risk: {
          type: 'string',
          enum: ['low', 'medium', 'high'],
          description: 'Estimated blast radius if executed without approval.',
        },
        payload: {
          type: 'object',
          description: 'Structured arguments extracted from the message.',
          additionalProperties: true,
        },
      },
      required: ['activity', 'summary', 'risk', 'payload'],
      additionalProperties: false,
    },
  },
} as const;

async function classify(text: string) {
  const apiKey = Deno.env.get('LOVABLE_API_KEY');
  if (!apiKey) throw new Error('LOVABLE_API_KEY not configured');
  const model = 'google/gemini-3-flash-preview';
  const startedAt = new Date();
  let issues: string | null = null;
  let tokens_in: number | null = null;
  let tokens_out: number | null = null;
  let result: { activity: string; summary: string; risk: 'low' | 'medium' | 'high'; payload: Record<string, unknown> } | null = null;
  let finishReason: string | null = null;
  let responsePreview: string | null = null;
  let toolCallName: string | null = null;
  let httpStatus: number | null = null;
  try {
    const res = await fetch(AI_URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        messages: [
          {
            role: 'system',
            content:
              'You classify short operator messages addressed to an automation system. Always call the classify_operator_intent tool. Pick activity from a short snake_case verb_noun. If the message is chitchat or unclear, use activity "smalltalk" or "unknown" and risk "low".',
          },
          { role: 'user', content: text },
        ],
        tools: [classifyTool],
        tool_choice: { type: 'function', function: { name: 'classify_operator_intent' } },
      }),
    });
    httpStatus = res.status;
    if (!res.ok) {
      const detail = await res.text();
      issues = `AI gateway ${res.status}: ${detail.slice(0, 500)}`;
      const err = new Error(`AI gateway ${res.status}: ${detail}`);
      (err as any).status = res.status;
      throw err;
    }
    const data = await res.json();
    tokens_in = data.usage?.prompt_tokens ?? null;
    tokens_out = data.usage?.completion_tokens ?? null;
    finishReason = data.choices?.[0]?.finish_reason ?? null;
    const call = data.choices?.[0]?.message?.tool_calls?.[0];
    toolCallName = call?.function?.name ?? null;
    responsePreview = call?.function?.arguments
      ?? data.choices?.[0]?.message?.content
      ?? null;
    if (!call?.function?.arguments) {
      issues = 'No tool call returned';
      throw new Error('No tool call returned');
    }
    result = JSON.parse(call.function.arguments);
    return result!;
  } finally {
    const endedAt = new Date();
    const summary = result
      ? `Classified operator message → ${result.activity} (risk=${result.risk})`
      : 'Operator message classification (failed)';
    autoLog({
      started_at: startedAt.toISOString(),
      ended_at: endedAt.toISOString(),
      duration_ms: endedAt.getTime() - startedAt.getTime(),
      tokens_in, tokens_out,
      model,
      model_provider: 'google',
      summary,
      issues,
      source: 'awip_api',
      author: 'route-operator-message',
      prompt_preview: text,
      response_preview: responsePreview,
      request_meta: {
        endpoint: AI_URL,
        tool_choice: 'classify_operator_intent',
        system: 'classify operator messages',
      },
      response_meta: {
        http_status: httpStatus,
        finish_reason: finishReason,
        tool_call: toolCallName,
      },
    }).catch((e) => console.error('autoLog failed', e));
  }
}

async function autoLog(payload: Record<string, unknown>) {
  const serviceToken = Deno.env.get('AWIP_SERVICE_TOKEN');
  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  if (!serviceToken || !supabaseUrl) return;
  await fetch(`${supabaseUrl}/functions/v1/roadmap-log-work`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-service-token': serviceToken },
    body: JSON.stringify(payload),
  });
}

Deno.serve(withLogger("route-operator-message", async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405, headers: corsHeaders });

  const serviceToken = Deno.env.get('AWIP_SERVICE_TOKEN');
  const provided = req.headers.get('x-service-token');
  if (!serviceToken || provided !== serviceToken) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const parsed = BodySchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return new Response(JSON.stringify({ error: parsed.error.flatten() }), {
      status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  // Resolve text + chat
  let text = parsed.data.text ?? '';
  let chatId: number | string | null = parsed.data.chat_id ?? null;
  let requestedBy = parsed.data.requested_by ?? null;
  let messageId = parsed.data.message_id ?? null;

  if (messageId) {
    const { data: msg, error } = await supabase
      .from('operator_messages')
      .select('id, text, chat_id, raw, intent')
      .eq('id', messageId)
      .maybeSingle();
    if (error || !msg) {
      return new Response(JSON.stringify({ error: 'message not found' }), {
        status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    if (msg.intent) {
      return new Response(JSON.stringify({ ok: true, skipped: 'already_routed', intent: msg.intent }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    text = msg.text ?? '';
    chatId = msg.chat_id;
    const fromUser = (msg.raw as any)?.message?.from ?? (msg.raw as any)?.edited_message?.from;
    requestedBy = requestedBy ?? (fromUser?.username ? `@${fromUser.username}` : String(fromUser?.id ?? 'unknown'));
    if (!text) {
      return new Response(JSON.stringify({ ok: true, skipped: 'no_text' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
  }

  // Classify
  let classification;
  try {
    classification = await classify(text);
  } catch (e) {
    const status = (e as any).status === 429 ? 429 : (e as any).status === 402 ? 402 : 500;
    return new Response(JSON.stringify({ error: (e as Error).message }), {
      status, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  // Lookup policy
  const { data: policy } = await supabase
    .from('activity_policies')
    .select('default_action, conditions, notes')
    .eq('activity', classification.activity)
    .maybeSingle();

  // Decide action: explicit policy wins; otherwise risk-based default.
  const decision = policy?.default_action
    ?? (classification.risk === 'low' ? 'approve' : 'needs_approval');

  const policyTrace = {
    matched: !!policy,
    activity: classification.activity,
    rule_default_action: policy?.default_action ?? null,
    rule_conditions: policy?.conditions ?? null,
    rule_notes: policy?.notes ?? null,
    risk: classification.risk,
    decision,
    reason: policy
      ? `Matched activity_policies rule for "${classification.activity}" → default_action="${policy.default_action}".`
      : `No activity_policies rule for "${classification.activity}". Fell back to risk-based default: risk="${classification.risk}" → ${decision}.`,
    evaluated_at: new Date().toISOString(),
  };

  // Persist intent on the source message (if any)
  if (messageId) {
    await supabase
      .from('operator_messages')
      .update({ intent: classification.activity })
      .eq('id', messageId);
  }

  // Conversational reply for low-risk chitchat / status / unknown — voice note back to operator.
  const conversationalActivities = new Set(['smalltalk', 'query_status', 'unknown']);
  if (decision === 'approve' && chatId && conversationalActivities.has(classification.activity)) {
    try {
      // Gather lightweight operator context
      const [{ data: pending }, { data: recentEvents }] = await Promise.all([
        supabase.from('approval_queue')
          .select('activity, risk, requested_by, created_at')
          .eq('status', 'pending').order('created_at', { ascending: false }).limit(5),
        supabase.from('okr_node_events')
          .select('event_type, created_at').order('created_at', { ascending: false }).limit(5),
      ]);

      const ctx = {
        pending_approvals: pending ?? [],
        recent_okr_events: recentEvents ?? [],
        now: new Date().toISOString(),
      };

      const aiRes = await fetch(AI_URL, {
        method: 'POST',
        headers: { Authorization: `Bearer ${Deno.env.get('LOVABLE_API_KEY')}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'openai/gpt-5-mini',
          messages: [
            { role: 'system', content: 'You are AWIP, the operator\'s automation copilot. Reply briefly and naturally — under 40 words, British English, conversational tone suitable for a voice note while driving. Never read JSON aloud; summarise. If asked about status, use the provided context.' },
            { role: 'user', content: `Operator said: "${text}"\n\nContext:\n${JSON.stringify(ctx)}` },
          ],
        }),
      });
      const aiData = await aiRes.json();
      const reply = aiData?.choices?.[0]?.message?.content?.trim();
      if (reply) {
        const voiceUrl = `${Deno.env.get('SUPABASE_URL')}/functions/v1/telegram-send-voice`;
        await fetch(voiceUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-service-token': serviceToken },
          body: JSON.stringify({ chat_id: chatId, text: reply }),
        }).catch((e) => console.error('telegram-send-voice failed', e));
      }
    } catch (e) {
      console.error('conversational reply failed', e);
    }
  }

  let approvalId: string | null = null;
  if (decision === 'needs_approval' || decision === 'reject') {
    const { data: approval, error: insErr } = await supabase
      .from('approval_queue')
      .insert({
        activity: classification.activity,
        risk: classification.risk,
        intent_payload: {
          ...classification.payload,
          _summary: classification.summary,
          _source_text: text,
          _policy: policyTrace,
        },
        requested_by: requestedBy,
        status: decision === 'reject' ? 'rejected' : 'pending',
        decided_by: decision === 'reject' ? 'policy:auto-reject' : null,
        decided_at: decision === 'reject' ? new Date().toISOString() : null,
      })
      .select('id')
      .single();
    if (insErr) {
      return new Response(JSON.stringify({ error: insErr.message }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    approvalId = approval.id;

    // Ping Telegram for human approval (only when pending)
    if (decision === 'needs_approval' && chatId) {
      const sendUrl = `${Deno.env.get('SUPABASE_URL')}/functions/v1/telegram-send`;
      await fetch(sendUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-service-token': serviceToken,
        },
        body: JSON.stringify({
          chat_id: chatId,
          text: `🛂 Approval needed\n\n• activity: ${classification.activity}\n• risk: ${classification.risk}\n• ${classification.summary}\n\nfrom: ${requestedBy ?? 'unknown'}`,
          approval_id: approvalId,
        }),
      }).catch((e) => console.error('telegram-send failed', e));
    }
  }

  return new Response(JSON.stringify({
    ok: true,
    decision,
    classification,
    approval_id: approvalId,
    policy_matched: !!policy,
  }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
}));
