import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { z } from 'https://esm.sh/zod@3.23.8';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-service-token',
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

Deno.serve(async (req) => {
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

  const tgRes = await fetch(`${GATEWAY_URL}/sendMessage`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${LOVABLE_API_KEY}`,
      'X-Connection-Api-Key': TELEGRAM_API_KEY,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ chat_id, text, parse_mode, reply_markup }),
  });
  const tgData = await tgRes.json();

  if (!tgRes.ok) {
    return new Response(JSON.stringify({ error: tgData }), {
      status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  // Log outbound + link telegram_message_id to approval row
  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );
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
    console.error('logging failed', e);
  }

  return new Response(JSON.stringify({ ok: true, result: tgData.result }), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
});
