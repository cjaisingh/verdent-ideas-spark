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

    // Create a short-lived (60s) project-scoped key with usage:write only.
    // Find the project_id first.
    const projRes = await fetch("https://api.deepgram.com/v1/projects", {
      headers: { Authorization: `Token ${DEEPGRAM_API_KEY}` },
    });
    if (!projRes.ok) {
      const t = await projRes.text();
      console.error("deepgram projects error", projRes.status, t);
      return json({ error: "failed to list deepgram projects" }, 502);
    }
    const projects = await projRes.json();
    const projectId = projects?.projects?.[0]?.project_id;
    if (!projectId) return json({ error: "no deepgram project found" }, 502);

    const expiry = Math.floor(Date.now() / 1000) + 60; // 60s
    const keyRes = await fetch(`https://api.deepgram.com/v1/projects/${projectId}/keys`, {
      method: "POST",
      headers: {
        Authorization: `Token ${DEEPGRAM_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        comment: `awip-finding-stt-${user.id}`,
        scopes: ["usage:write"],
        time_to_live_in_seconds: 60,
      }),
    });
    if (!keyRes.ok) {
      const t = await keyRes.text();
      console.error("deepgram key error", keyRes.status, t);
      return json({ error: "failed to mint deepgram key" }, 502);
    }
    const keyJson = await keyRes.json();
    return json({ key: keyJson.key, expires_at: expiry });
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
