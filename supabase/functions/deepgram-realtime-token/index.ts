// Mints a short-lived Deepgram key for browser-side realtime STT WebSocket.
// Auth: operator JWT.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const reqId = crypto.randomUUID();
  const log = (...args: unknown[]) => console.log(`[dg-token ${reqId}]`, ...args);
  const logErr = (...args: unknown[]) => console.error(`[dg-token ${reqId}]`, ...args);

  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
    const DEEPGRAM_API_KEY = Deno.env.get("DEEPGRAM_API_KEY");
    log("incoming", { method: req.method, hasKey: !!DEEPGRAM_API_KEY, keyPrefix: DEEPGRAM_API_KEY?.slice(0, 6) });
    if (!DEEPGRAM_API_KEY) return json({ error: "DEEPGRAM_API_KEY not configured", reqId }, 500);

    const authHeader = req.headers.get("Authorization") ?? "";
    if (!authHeader) return json({ error: "missing authorization", reqId }, 401);

    const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userRes, error: userErr } = await userClient.auth.getUser();
    if (userErr) logErr("auth.getUser error", userErr);
    const user = userRes?.user;
    if (!user) return json({ error: "not authenticated", reqId }, 401);
    const { data: hasOp, error: roleErr } = await userClient.rpc("has_role", {
      _user_id: user.id,
      _role: "operator",
    });
    if (roleErr) logErr("has_role error", roleErr);
    log("auth ok", { userId: user.id, hasOp });
    if (!hasOp) return json({ error: "operator role required", reqId }, 403);

    // Mint a short-lived token via /v1/auth/grant
    log("calling deepgram /v1/auth/grant");
    const grantRes = await fetch("https://api.deepgram.com/v1/auth/grant", {
      method: "POST",
      headers: {
        Authorization: `Token ${DEEPGRAM_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ ttl_seconds: 60 }),
    });
    const respHeaders: Record<string, string> = {};
    grantRes.headers.forEach((v, k) => { respHeaders[k] = v; });
    const bodyText = await grantRes.text();
    log("deepgram response", { status: grantRes.status, headers: respHeaders, body: bodyText });

    if (!grantRes.ok) {
      logErr("deepgram grant error", grantRes.status, bodyText);
      return json({
        error: "failed to mint deepgram token",
        reqId,
        deepgram_status: grantRes.status,
        deepgram_body: bodyText,
        deepgram_headers: respHeaders,
      }, 502);
    }
    let grantJson: any = {};
    try { grantJson = JSON.parse(bodyText); } catch (e) { logErr("parse grant body failed", e); }
    const token = grantJson.access_token ?? grantJson.key;
    if (!token) {
      logErr("no token in deepgram response", grantJson);
      return json({ error: "deepgram returned no token", reqId, deepgram_body: bodyText }, 502);
    }
    const expiry = Math.floor(Date.now() / 1000) + (grantJson.expires_in ?? 60);
    log("minted token ok", { expiry, tokenPrefix: String(token).slice(0, 8) });
    return json({ key: token, expires_at: expiry, reqId });
  } catch (e) {
    logErr("unhandled error", e);
    return json({ error: e instanceof Error ? e.message : "unknown error", reqId }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
