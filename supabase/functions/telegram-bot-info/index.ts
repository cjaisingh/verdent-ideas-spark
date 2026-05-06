import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const GATEWAY_URL = "https://connector-gateway.lovable.dev/telegram";
const ENDPOINT = "getMe";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

async function logAttempt(row: {
  attempt: number;
  status_code: number | null;
  latency_ms: number;
  ok: boolean;
  error?: string | null;
  detail?: unknown;
}) {
  try {
    await admin.from("telegram_gateway_logs").insert({
      endpoint: ENDPOINT,
      attempt: row.attempt,
      status_code: row.status_code,
      latency_ms: row.latency_ms,
      ok: row.ok,
      error: row.error ?? null,
      detail: row.detail ?? null,
    });
  } catch (e) {
    console.error("telegram_gateway_logs insert failed", e);
  }
}

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

  let lastStatus = 0;
  let lastBody: any = null;

  for (let attempt = 1; attempt <= 3; attempt++) {
    const t0 = performance.now();
    let status: number | null = null;
    let ok = false;
    let data: any = null;
    let errMsg: string | null = null;

    try {
      const r = await callGetMe(LOVABLE_API_KEY, TELEGRAM_API_KEY);
      status = r.status;
      data = await r.json().catch(() => null);
      ok = r.ok && !!data?.ok;
    } catch (e) {
      errMsg = (e as Error).message;
    }

    const latency_ms = Math.round(performance.now() - t0);

    // Fire-and-forget log
    logAttempt({
      attempt,
      status_code: status,
      latency_ms,
      ok,
      error: ok ? null : errMsg ?? (data ? JSON.stringify(data).slice(0, 500) : null),
      detail: ok ? null : data,
    });

    if (ok) {
      const { id, username, first_name } = data.result;
      return json({
        id,
        username,
        first_name,
        url: username ? `https://t.me/${username}` : null,
      });
    }

    lastStatus = status ?? 0;
    lastBody = data ?? (errMsg ? { message: errMsg } : null);

    if (status !== null && status < 500) break;
    if (attempt < 3) await new Promise((res) => setTimeout(res, 400 * attempt));
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
