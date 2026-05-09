import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { z } from 'https://esm.sh/zod@3.23.8';
import { withLogger } from "../_shared/logger.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-service-token',
};

const GATEWAY_URL = 'https://connector-gateway.lovable.dev/telegram';
const DEEPGRAM_TTS_URL = 'https://api.deepgram.com/v1/speak';

const BodySchema = z.object({
  chat_id: z.union([z.number(), z.string()]),
  text: z.string().min(1).max(2000),
  voice: z.string().optional(), // e.g. aura-2-orion-en (British male)
  fallback_text: z.boolean().optional().default(true),
});

Deno.serve(withLogger("telegram-send-voice", async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405, headers: corsHeaders });

  const serviceToken = Deno.env.get('AWIP_SERVICE_TOKEN');
  const provided = req.headers.get('x-service-token');
  if (!serviceToken || provided !== serviceToken) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const LOVABLE_API_KEY = Deno.env.get('LOVABLE_API_KEY');
  const TELEGRAM_API_KEY = Deno.env.get('TELEGRAM_API_KEY');
  const DEEPGRAM_API_KEY = Deno.env.get('DEEPGRAM_API_KEY');
  if (!LOVABLE_API_KEY || !TELEGRAM_API_KEY) {
    return new Response(JSON.stringify({ error: 'Telegram connector not configured' }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const parsed = BodySchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return new Response(JSON.stringify({ error: parsed.error.flatten() }), {
      status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
  const { chat_id, text, voice, fallback_text } = parsed.data;

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  // 1) Synthesize speech with Deepgram Aura-2 (OGG/Opus → Telegram voice)
  let voiceBytes: Uint8Array | null = null;
  let ttsError: string | null = null;

  if (DEEPGRAM_API_KEY) {
    try {
      const model = voice ?? 'aura-2-orion-en'; // British-leaning male; swap freely
      const ttsRes = await fetch(`${DEEPGRAM_TTS_URL}?model=${model}&encoding=opus&container=ogg`, {
        method: 'POST',
        headers: {
          Authorization: `Token ${DEEPGRAM_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ text }),
      });
      if (!ttsRes.ok) {
        ttsError = `Deepgram ${ttsRes.status}: ${(await ttsRes.text()).slice(0, 300)}`;
      } else {
        voiceBytes = new Uint8Array(await ttsRes.arrayBuffer());
      }
    } catch (e) {
      ttsError = `Deepgram fetch failed: ${(e as Error).message}`;
    }
  } else {
    ttsError = 'DEEPGRAM_API_KEY not configured';
  }

  // 2) Send as voice note via Telegram (multipart)
  if (voiceBytes && voiceBytes.length > 0) {
    const form = new FormData();
    form.append('chat_id', String(chat_id));
    form.append('voice', new Blob([voiceBytes], { type: 'audio/ogg' }), 'reply.ogg');

    const tgRes = await fetch(`${GATEWAY_URL}/sendVoice`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        'X-Connection-Api-Key': TELEGRAM_API_KEY,
      },
      body: form,
    });
    const tgData = await tgRes.json().catch(() => ({}));

    if (tgRes.ok) {
      try {
        await supabase.from('operator_messages').insert({
          chat_id: typeof chat_id === 'string' ? Number(chat_id) : chat_id,
          direction: 'outbound',
          text: `🔊 ${text}`,
          raw: tgData,
        });
      } catch (e) { console.error('log failed', e); }

      return new Response(JSON.stringify({ ok: true, mode: 'voice', result: tgData.result }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    ttsError = `Telegram sendVoice failed: ${JSON.stringify(tgData).slice(0, 300)}`;
  }

  // 3) Fallback: send as text via existing telegram-send
  if (fallback_text) {
    const sendUrl = `${Deno.env.get('SUPABASE_URL')}/functions/v1/telegram-send`;
    const fbRes = await fetch(sendUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-service-token': serviceToken },
      body: JSON.stringify({ chat_id, text }),
    });
    const fbData = await fbRes.json().catch(() => ({}));
    return new Response(JSON.stringify({
      ok: fbRes.ok, mode: 'text_fallback', tts_error: ttsError, result: fbData,
    }), {
      status: fbRes.ok ? 200 : 502,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  return new Response(JSON.stringify({ ok: false, error: ttsError ?? 'voice send failed' }), {
    status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}));
