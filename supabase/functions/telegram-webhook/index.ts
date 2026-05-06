import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

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

Deno.serve(async (req) => {
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

  // Handle inline-button callback (approval decisions)
  if (update.callback_query) {
    const cq = update.callback_query;
    const data: string = cq.data ?? '';
    // Expected format: "approve:<uuid>" or "reject:<uuid>"
    const [action, approvalId] = data.split(':');
    const userTag = cq.from?.username
      ? `@${cq.from.username}`
      : String(cq.from?.id ?? 'unknown');

    if ((action === 'approve' || action === 'reject') && approvalId) {
      const newStatus = action === 'approve' ? 'approved' : 'rejected';
      const { error } = await supabase
        .from('approval_queue')
        .update({ status: newStatus, decided_by: userTag, decided_at: new Date().toISOString() })
        .eq('id', approvalId)
        .eq('status', 'pending');
      await tgAnswerCallback(cq.id, error ? 'Error' : `Marked ${newStatus}`);
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

  // Handle messages
  const message = update.message ?? update.edited_message;
  if (!message?.chat?.id || typeof update.update_id !== 'number') {
    return new Response(JSON.stringify({ ok: true, ignored: true }), {
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const { error } = await supabase.from('operator_messages').upsert({
    update_id: update.update_id,
    chat_id: message.chat.id,
    direction: 'inbound',
    text: message.text ?? null,
    raw: update,
  }, { onConflict: 'update_id' });

  if (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500, headers: { 'Content-Type': 'application/json' },
    });
  }
  return new Response(JSON.stringify({ ok: true }), {
    headers: { 'Content-Type': 'application/json' },
  });
});
