const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const GATEWAY_URL = "https://connector-gateway.lovable.dev/telegram";

async function callGetMe(lovableKey: string, tgKey: string) {
  return await fetch(`${GATEWAY_URL}/getMe`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${lovableKey}`,
      "X-Connection-Api-Key": tgKey,
      "Content-Type": "application/json",
    },
    body: "{}",
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
  const TELEGRAM_API_KEY = Deno.env.get("TELEGRAM_API_KEY");
  if (!LOVABLE_API_KEY) return json({ error: "LOVABLE_API_KEY is not configured" }, 200);
  if (!TELEGRAM_API_KEY) return json({ error: "TELEGRAM_API_KEY is not configured" }, 200);

  // Retry once on gateway 5xx (transient upstream_request_failed)
  let lastStatus = 0;
  let lastBody: any = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const r = await callGetMe(LOVABLE_API_KEY, TELEGRAM_API_KEY);
      const data = await r.json().catch(() => null);
      if (r.ok && data?.ok) {
        const { id, username, first_name } = data.result;
        return json({
          id,
          username,
          first_name,
          url: username ? `https://t.me/${username}` : null,
        });
      }
      lastStatus = r.status;
      lastBody = data;
      if (r.status < 500) break;
    } catch (e) {
      lastBody = { message: (e as Error).message };
    }
    await new Promise((res) => setTimeout(res, 400 * (attempt + 1)));
  }

  console.error("getMe failed", lastStatus, lastBody);
  return json(
    {
      error: "Telegram gateway unavailable",
      detail: lastBody,
      status: lastStatus,
      fallback: true,
    },
    200,
  );
});
