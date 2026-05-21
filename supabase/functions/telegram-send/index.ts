import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { z } from 'https://esm.sh/zod@3.23.8';
import { withLogger } from "../_shared/logger.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-service-token, x-caller, x-force-fail',
};

const GATEWAY_URL = 'https://connector-gateway.lovable.dev/telegram';

const BodySchema = z.object({
  chat_id: z.union([z.number(), z.string()]),
  text: z.string().min(1).max(4096),
  parse_mode: z.enum(['HTML', 'Markdown', 'MarkdownV2']).optional(),
  approval_id: z.string().uuid().optional(),
  // If approval_id is set, inline approve/reject buttons are attached automatically.
  reply_markup: z.any().optional(),
});

Deno.serve(withLogger("telegram-send", async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405, headers: corsHeaders });
  }

  // Service-token auth (internal-only helper)
  const serviceToken = Deno.env.get('AWIP_SERVICE_TOKEN');
  const provided = req.headers.get('x-service-token');
  if (!serviceToken || provided !== serviceToken) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const LOVABLE_API_KEY = Deno.env.get('LOVABLE_API_KEY');
  const TELEGRAM_API_KEY = Deno.env.get('TELEGRAM_API_KEY');
  if (!LOVABLE_API_KEY || !TELEGRAM_API_KEY) {
    return new Response(JSON.stringify({ error: 'Connector not configured' }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const parsed = BodySchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return new Response(JSON.stringify({ error: parsed.error.flatten() }), {
      status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
  const { chat_id, text, parse_mode, approval_id } = parsed.data;
  let reply_markup = parsed.data.reply_markup;

  if (approval_id && !reply_markup) {
    reply_markup = {
      inline_keyboard: [[
        { text: '✅ Approve', callback_data: `approve:${approval_id}` },
        { text: '❌ Reject',  callback_data: `reject:${approval_id}` },
      ]],
    };
  }

  // Hash payload for dedup correlation (chat_id + text)
  const payloadBytes = new TextEncoder().encode(`${chat_id}|${text}`);
  const payloadHash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', payloadBytes)))
    .map((b) => b.toString(16).padStart(2, '0')).join('').slice(0, 32);
  const caller = req.headers.get('x-caller') ?? 'unknown';
  const forceFail = req.headers.get('x-force-fail') === '1';

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  let tgRes: Response;
  let tgData: { result?: { message_id?: number }; description?: string } = {};
  let httpStatus = 0;
  let sendError: string | null = null;

  try {
    if (forceFail) {
      throw new Error('x-force-fail header set');
    }
    tgRes = await fetch(`${GATEWAY_URL}/sendMessage`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${LOVABLE_API_KEY}`,
        'X-Connection-Api-Key': TELEGRAM_API_KEY,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ chat_id, text, parse_mode, reply_markup }),
    });
    httpStatus = tgRes.status;
    tgData = await tgRes.json();
    if (!tgRes.ok) sendError = typeof tgData?.description === 'string' ? tgData.description : `http_${httpStatus}`;
  } catch (e) {
    sendError = e instanceof Error ? e.message : String(e);
  }

  const status = sendError ? (httpStatus > 0 ? 'failed' : 'error') : 'success';

  // ALWAYS log to telegram_send_log (success, failed, error) — sentinels depend on this
  await supabase.from('telegram_send_log').insert({
    chat_id: String(chat_id),
    payload_hash: payloadHash,
    status,
    http_status: httpStatus || null,
    error: sendError,
    caller,
  }).then(({ error }) => { if (error) console.error('telegram_send_log insert failed', error); });

  if (sendError) {
    return new Response(JSON.stringify({ error: sendError, telegram: tgData }), {
      status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  // Link telegram_message_id to approval row + log inbound mirror
  try {
    const messageId = tgData.result?.message_id;
    await supabase.from('operator_messages').insert({
      chat_id: typeof chat_id === 'string' ? Number(chat_id) : chat_id,
      direction: 'outbound',
      text,
      raw: tgData,
    });
    if (approval_id && messageId) {
      await supabase.from('approval_queue')
        .update({ telegram_message_id: messageId })
        .eq('id', approval_id);
    }
  } catch (e) {
    console.error('operator_messages logging failed', e);
  }

  return new Response(JSON.stringify({ ok: true, result: tgData.result }), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}));
