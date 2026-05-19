import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { withLogger } from "../_shared/logger.ts";
import { logAiUsage } from "../_shared/ai-usage.ts";

async function deriveSecret(apiKey: string): Promise<string> {
  const data = new TextEncoder().encode(`telegram-webhook:${apiKey}`);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return btoa(String.fromCharCode(...new Uint8Array(digest)))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function safeEqual(a: string | null, b: string): boolean {
  if (!a || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

const GATEWAY_URL = 'https://connector-gateway.lovable.dev/telegram';
const AI_URL = 'https://ai.gateway.lovable.dev/v1/chat/completions';

async function tgAnswerCallback(callbackQueryId: string, text: string) {
  const LOVABLE_API_KEY = Deno.env.get('LOVABLE_API_KEY');
  const TELEGRAM_API_KEY = Deno.env.get('TELEGRAM_API_KEY');
  if (!LOVABLE_API_KEY || !TELEGRAM_API_KEY) return;
  await fetch(`${GATEWAY_URL}/answerCallbackQuery`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${LOVABLE_API_KEY}`,
      'X-Connection-Api-Key': TELEGRAM_API_KEY,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ callback_query_id: callbackQueryId, text }),
  }).catch(() => {});
}

// Download Telegram voice file via gateway and return base64 + mime
async function fetchVoiceBase64(fileId: string): Promise<{ base64: string; mime: string } | null> {
  const LOVABLE_API_KEY = Deno.env.get('LOVABLE_API_KEY');
  const TELEGRAM_API_KEY = Deno.env.get('TELEGRAM_API_KEY');
  if (!LOVABLE_API_KEY || !TELEGRAM_API_KEY) return null;

  const meta = await fetch(`${GATEWAY_URL}/getFile`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${LOVABLE_API_KEY}`,
      'X-Connection-Api-Key': TELEGRAM_API_KEY,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ file_id: fileId }),
  });
  const metaJson = await meta.json().catch(() => ({}));
  const filePath = metaJson?.result?.file_path;
  if (!meta.ok || !filePath) {
    console.error('getFile failed', meta.status, metaJson);
    return null;
  }

  const dl = await fetch(`${GATEWAY_URL}/file/${filePath}`, {
    headers: {
      'Authorization': `Bearer ${LOVABLE_API_KEY}`,
      'X-Connection-Api-Key': TELEGRAM_API_KEY,
    },
  });
  if (!dl.ok) {
    console.error('file download failed', dl.status);
    return null;
  }
  const buf = new Uint8Array(await dl.arrayBuffer());
  // base64 encode
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < buf.length; i += chunk) {
    binary += String.fromCharCode(...buf.subarray(i, i + chunk));
  }
  const base64 = btoa(binary);
  const mime = filePath.endsWith('.ogg') || filePath.endsWith('.oga')
    ? 'audio/ogg'
    : filePath.endsWith('.mp3') ? 'audio/mpeg'
    : filePath.endsWith('.m4a') ? 'audio/mp4'
    : filePath.endsWith('.wav') ? 'audio/wav'
    : 'audio/ogg';
  return { base64, mime };
}

// Transcribe audio via Lovable AI Gateway / Gemini 2.5 Flash
async function transcribeAudio(base64: string, mime: string): Promise<string | null> {
  const apiKey = Deno.env.get('LOVABLE_API_KEY');
  if (!apiKey) return null;
  const model = 'google/gemini-2.5-flash';
  const startedAt = Date.now();
  try {
    const res = await fetch(AI_URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        messages: [
          {
            role: 'system',
            content: 'You are a verbatim transcription engine. Return ONLY the spoken text in the audio, no commentary, no quotes, no formatting. If silent or unclear, return an empty string.',
          },
          {
            role: 'user',
            content: [
              { type: 'text', text: 'Transcribe this audio.' },
              { type: 'input_audio', input_audio: { data: base64, format: mime.split('/')[1] } },
            ],
          },
        ],
      }),
    });
    if (!res.ok) {
      const err = await res.text();
      console.error('transcribe failed', res.status, err.slice(0, 300));
      try {
        const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });
        await logAiUsage(sb, {
          job: 'telegram-webhook:transcribe', model, trigger: 'service',
          status: 'error', status_code: res.status, latency_ms: Date.now() - startedAt,
          error: err.slice(0, 500),
          request_ref: { mime, audio_bytes: Math.round((base64.length * 3) / 4) },
        });
      } catch (e) { console.error('ai_usage_log mirror failed', e); }
      return null;
    }
    const data = await res.json();
    const text = (data?.choices?.[0]?.message?.content ?? '').toString().trim();

    // Mirror to ai_usage_log for the cost dashboard.
    try {
      const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });
      await logAiUsage(sb, {
        job: 'telegram-webhook:transcribe', model, trigger: 'service',
        status: 'ok', status_code: 200, latency_ms: Date.now() - startedAt,
        prompt_tokens: data?.usage?.prompt_tokens ?? null,
        completion_tokens: data?.usage?.completion_tokens ?? null,
        total_tokens: data?.usage?.total_tokens ?? null,
        request_ref: { mime, audio_bytes: Math.round((base64.length * 3) / 4), chars: text.length },
      });
    } catch (e) { console.error('ai_usage_log mirror failed', e); }

    // Best-effort autoLog (legacy roadmap-log-work mirror)
    const serviceToken = Deno.env.get('AWIP_SERVICE_TOKEN');
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    if (serviceToken && supabaseUrl) {
      fetch(`${supabaseUrl}/functions/v1/roadmap-log-work`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-service-token': serviceToken },
        body: JSON.stringify({
          started_at: new Date(startedAt).toISOString(),
          ended_at: new Date().toISOString(),
          duration_ms: Date.now() - startedAt,
          tokens_in: data.usage?.prompt_tokens ?? null,
          tokens_out: data.usage?.completion_tokens ?? null,
          model,
          model_provider: 'google',
          summary: `Voice transcription (${text.length} chars)`,
          source: 'awip_api',
          author: 'telegram-webhook:voice',
          response_preview: text.slice(0, 200),
          request_meta: { mime, audio_bytes: Math.round((base64.length * 3) / 4) },
        }),
      }).catch(() => {});
    }
    return text || null;
  } catch (e) {
    console.error('transcribe exception', e);
    return null;
  }
}

Deno.serve(withLogger("telegram-webhook", async (req, ctx) => {
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });

  const TELEGRAM_API_KEY = Deno.env.get('TELEGRAM_API_KEY');
  if (!TELEGRAM_API_KEY) return new Response('Misconfigured', { status: 500 });

  const expected = await deriveSecret(TELEGRAM_API_KEY);
  const actual = req.headers.get('X-Telegram-Bot-Api-Secret-Token');
  if (!safeEqual(actual, expected)) return new Response('Unauthorized', { status: 401 });

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  let update: any;
  try { update = await req.json(); } catch { return new Response('Bad JSON', { status: 400 }); }

  // Slice 4: default-deny allowlist. Silently drop messages from any chat_id
  // not present in public.platform_allowlist (platform='telegram'). Telegram
  // expects 200 from webhooks; returning 4xx would cause retries.
  const incomingChat =
    update.callback_query?.message?.chat ??
    update.message?.chat ??
    update.edited_message?.chat ??
    update.channel_post?.chat ??
    update.edited_channel_post?.chat ??
    null;
  const incomingChatId = incomingChat?.id ?? null;
  if (incomingChatId != null) {
    const { data: allowed } = await supabase.rpc('is_principal_allowed', {
      _platform: 'telegram',
      _principal: String(incomingChatId),
    });
    if (allowed !== true) {
      ctx.attach('__classified_error', 'allowlist_reject');
      ctx.attach('rejected_chat_id', String(incomingChatId));
      return new Response(JSON.stringify({ ok: true, ignored: 'not_allowlisted' }), {
        status: 200, headers: { 'Content-Type': 'application/json' },
      });
    }

    // Operator-inbox curation gate. The allowlist above is security; this is
    // curation/labelling — sources not in operator_inbox_sources or disabled
    // are silently dropped and surfaced via sentinel.
    const { data: source } = await supabase
      .from('operator_inbox_sources')
      .select('chat_id, enabled')
      .eq('chat_id', incomingChatId)
      .maybeSingle();
    if (!source || source.enabled === false) {
      ctx.attach('__classified_error', 'inbox_source_unregistered');
      ctx.attach('rejected_chat_id', String(incomingChatId));
      ctx.attach('chat_type', incomingChat?.type ?? null);
      ctx.attach('chat_title', incomingChat?.title ?? null);
      return new Response(JSON.stringify({ ok: true, ignored: 'unregistered_source' }), {
        status: 200, headers: { 'Content-Type': 'application/json' },
      });
    }
  }

  function chatTypeToSource(type: string | undefined): 'dm' | 'group' | 'channel' {
    if (type === 'channel') return 'channel';
    if (type === 'group' || type === 'supergroup') return 'group';
    return 'dm';
  }

  // Handle inline-button callback (approval decisions) — route through awip-api so
  // callback_url + capability_events fire consistently with the contract surface.
  if (update.callback_query) {
    const cq = update.callback_query;
    const data: string = cq.data ?? '';
    const [action, approvalId] = data.split(':');
    const userTag = cq.from?.username ? `@${cq.from.username}` : String(cq.from?.id ?? 'unknown');

    if ((action === 'approve' || action === 'reject') && approvalId) {
      const newStatus = action === 'approve' ? 'approved' : 'rejected';
      const serviceToken = Deno.env.get('AWIP_SERVICE_TOKEN');
      const supabaseUrl = Deno.env.get('SUPABASE_URL');
      let ok = false;
      if (serviceToken && supabaseUrl) {
        try {
          const r = await fetch(`${supabaseUrl}/functions/v1/awip-api/approvals/${approvalId}/decide`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'x-awip-service-token': serviceToken },
            body: JSON.stringify({ decision: newStatus, decided_by: userTag }),
          });
          ok = r.ok;
        } catch (e) {
          console.error('decide via awip-api failed', e);
        }
      }
      if (!ok) {
        // Fallback: direct update so approvals never get stuck
        const { error } = await supabase
          .from('approval_queue')
          .update({ status: newStatus, decided_by: userTag, decided_at: new Date().toISOString() })
          .eq('id', approvalId)
          .eq('status', 'pending');
        ok = !error;
      }
      await tgAnswerCallback(cq.id, ok ? `Marked ${newStatus}` : 'Error');
    } else {
      await tgAnswerCallback(cq.id, 'Unknown action');
    }

    if (typeof update.update_id === 'number') {
      await supabase.from('operator_messages').upsert({
        update_id: update.update_id,
        chat_id: cq.message?.chat?.id ?? 0,
        direction: 'inbound',
        text: `[callback] ${data}`,
        raw: update,
      }, { onConflict: 'update_id' });
    }
    return new Response(JSON.stringify({ ok: true }), {
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const message = update.message
    ?? update.edited_message
    ?? update.channel_post
    ?? update.edited_channel_post;
  if (!message?.chat?.id || typeof update.update_id !== 'number') {
    return new Response(JSON.stringify({ ok: true, ignored: true }), {
      headers: { 'Content-Type': 'application/json' },
    });
  }
  const sourceKind = chatTypeToSource(message.chat.type);

  // Voice / audio detection — transcribe before persisting so message text is the transcript.
  let textForRouting: string | null = message.text ?? message.caption ?? null;
  let voiceMeta: Record<string, unknown> | null = null;
  const voice = message.voice ?? message.audio ?? null;
  if (!textForRouting && voice?.file_id) {
    const audio = await fetchVoiceBase64(voice.file_id);
    if (audio) {
      const transcript = await transcribeAudio(audio.base64, audio.mime);
      voiceMeta = {
        voice_file_id: voice.file_id,
        voice_duration: voice.duration ?? null,
        voice_mime: audio.mime,
        transcribed: !!transcript,
      };
      if (transcript) textForRouting = transcript;
    }
  }

  const { data: inserted, error } = await supabase.from('operator_messages').upsert({
    update_id: update.update_id,
    chat_id: message.chat.id,
    direction: 'inbound',
    source: sourceKind,
    text: textForRouting,
    raw: voiceMeta ? { ...update, _voice: voiceMeta } : update,
  }, { onConflict: 'update_id' }).select('id').maybeSingle();

  if (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500, headers: { 'Content-Type': 'application/json' },
    });
  }

  // If it was a voice message and transcription failed, tell the operator.
  if (voice?.file_id && !textForRouting) {
    const sendUrl = `${Deno.env.get('SUPABASE_URL')}/functions/v1/telegram-send`;
    const tok = Deno.env.get('AWIP_SERVICE_TOKEN');
    if (tok) {
      fetch(sendUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-service-token': tok },
        body: JSON.stringify({
          chat_id: message.chat.id,
          text: '🎙️ Couldn\'t transcribe that voice note — please type or try again.',
        }),
      }).catch(() => {});
    }
  }

  // Fire-and-forget routing for text messages (now includes transcribed voice)
  const serviceToken = Deno.env.get('AWIP_SERVICE_TOKEN');
  if (inserted?.id && textForRouting && serviceToken) {
    const url = `${Deno.env.get('SUPABASE_URL')}/functions/v1/route-operator-message`;
    fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-service-token': serviceToken },
      body: JSON.stringify({ message_id: inserted.id }),
    }).catch((e) => console.error('route-operator-message dispatch failed', e));
  }

  return new Response(JSON.stringify({ ok: true, transcribed: !!voiceMeta?.transcribed }), {
    headers: { 'Content-Type': 'application/json' },
  });
}));
