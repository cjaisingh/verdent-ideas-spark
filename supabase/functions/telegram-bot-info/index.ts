import { withLogger } from "../_shared/logger.ts";
// Returns Telegram bot identity + webhook info via the Lovable connector gateway.
// Used by the Admin TelegramBotPanel and ControlPlane page.
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const GATEWAY = "https://connector-gateway.lovable.dev/telegram";

async function tg(path: string, lovableKey: string, telegramKey: string) {
  const r = await fetch(`${GATEWAY}/${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${lovableKey}`,
      "X-Connection-Api-Key": telegramKey,
      "Content-Type": "application/json",
    },
    body: "{}",
  });
  const data = await r.json().catch(() => ({}));
  return { ok: r.ok, status: r.status, data };
}

Deno.serve(withLogger("telegram-bot-info", async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
  const TELEGRAM_API_KEY = Deno.env.get("TELEGRAM_API_KEY");
  if (!LOVABLE_API_KEY || !TELEGRAM_API_KEY) {
    return new Response(JSON.stringify({
      error: "Telegram connector not configured",
      missing: { LOVABLE_API_KEY: !LOVABLE_API_KEY, TELEGRAM_API_KEY: !TELEGRAM_API_KEY },
    }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }

  try {
    const [me, webhook] = await Promise.all([
      tg("getMe", LOVABLE_API_KEY, TELEGRAM_API_KEY),
      tg("getWebhookInfo", LOVABLE_API_KEY, TELEGRAM_API_KEY),
    ]);
    return new Response(JSON.stringify({
      ok: me.ok && webhook.ok,
      bot: me.data?.result ?? null,
      webhook: webhook.data?.result ?? null,
      errors: {
        getMe: me.ok ? null : me.data,
        getWebhookInfo: webhook.ok ? null : webhook.data,
      },
    }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return new Response(JSON.stringify({ error: msg }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
}));
