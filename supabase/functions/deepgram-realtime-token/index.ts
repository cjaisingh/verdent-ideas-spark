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

  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
    const DEEPGRAM_API_KEY = Deno.env.get("DEEPGRAM_API_KEY");
    if (!DEEPGRAM_API_KEY) return json({ error: "DEEPGRAM_API_KEY not configured" }, 500);

    const authHeader = req.headers.get("Authorization") ?? "";
    if (!authHeader) return json({ error: "missing authorization" }, 401);

    const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userRes } = await userClient.auth.getUser();
    const user = userRes?.user;
    if (!user) return json({ error: "not authenticated" }, 401);
    const { data: hasOp } = await userClient.rpc("has_role", {
      _user_id: user.id,
      _role: "operator",
    });
    if (!hasOp) return json({ error: "operator role required" }, 403);

    // Mint a short-lived token via /v1/auth/grant (uses master key, no keys:write needed)
    const grantRes = await fetch("https://api.deepgram.com/v1/auth/grant", {
      method: "POST",
      headers: {
        Authorization: `Token ${DEEPGRAM_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ ttl_seconds: 60 }),
    });
    if (!grantRes.ok) {
      const t = await grantRes.text();
      console.error("deepgram grant error", grantRes.status, t);
      return json({ error: "failed to mint deepgram token", detail: t }, 502);
    }
    const grantJson = await grantRes.json();
    // Deepgram returns { access_token, expires_in }
    const token = grantJson.access_token ?? grantJson.key;
    const expiry = Math.floor(Date.now() / 1000) + (grantJson.expires_in ?? 60);
    return json({ key: token, expires_at: expiry });
  } catch (e) {
    console.error("deepgram-realtime-token error", e);
    return json({ error: e instanceof Error ? e.message : "unknown error" }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
