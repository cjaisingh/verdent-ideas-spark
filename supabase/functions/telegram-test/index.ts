import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { withLogger } from "../_shared/logger.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const GATEWAY_URL = 'https://connector-gateway.lovable.dev/telegram';

Deno.serve(withLogger("telegram-test", async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  const authHeader = req.headers.get('Authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const userClient = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_ANON_KEY')!,
    { global: { headers: { Authorization: authHeader } } },
  );
  const { data: claims, error: authErr } = await userClient.auth.getClaims(authHeader.slice(7));
  if (authErr || !claims?.claims) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  // Operator gate
  const { data: roleRow } = await userClient.rpc('has_role', {
    _user_id: claims.claims.sub, _role: 'operator',
  });
  if (!roleRow) {
    return new Response(JSON.stringify({ error: 'Forbidden' }), {
      status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const LOVABLE_API_KEY = Deno.env.get('LOVABLE_API_KEY');
  const TELEGRAM_API_KEY = Deno.env.get('TELEGRAM_API_KEY');
  if (!LOVABLE_API_KEY || !TELEGRAM_API_KEY) {
    return new Response(JSON.stringify({ error: 'Telegram connector not configured' }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const admin = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  let chatId: number | null = null;
  try {
    const body = await req.json();
    if (typeof body?.chat_id === 'number') chatId = body.chat_id;
  } catch { /* no body */ }

  if (!chatId) {
    const { data: latest } = await admin
      .from('operator_messages')
      .select('chat_id')
      .eq('direction', 'inbound')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    chatId = latest?.chat_id ?? null;
  }

  if (!chatId) {
    return new Response(JSON.stringify({
      error: 'No chat_id known yet. Send any message to the AWIP bot on Telegram first, then retry.',
    }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }

  const text = `🤖 AWIP test ping at ${new Date().toISOString()}`;
  const tgRes = await fetch(`${GATEWAY_URL}/sendMessage`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${LOVABLE_API_KEY}`,
      'X-Connection-Api-Key': TELEGRAM_API_KEY,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ chat_id: chatId, text }),
  });
  const tgData = await tgRes.json();

  if (!tgRes.ok) {
    return new Response(JSON.stringify({ error: tgData }), {
      status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  await admin.from('operator_messages').insert({
    chat_id: chatId, direction: 'outbound', text, raw: tgData,
  });

  return new Response(JSON.stringify({ ok: true, chat_id: chatId, message_id: tgData.result?.message_id }), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}));
