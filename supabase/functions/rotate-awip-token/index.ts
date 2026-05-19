// One-shot atomic rotation of AWIP_SERVICE_TOKEN.
//
// Flow (operator-driven):
//   1. Operator updates AWIP_SERVICE_TOKEN in Lovable Cloud secrets via the
//      secret form. That restarts the edge runtime with the new env value.
//   2. Operator calls POST /rotate-awip-token  with body { new_token } where
//      new_token === the value just set in step 1.
//   3. This function verifies Deno.env.get("AWIP_SERVICE_TOKEN") === new_token
//      (proving the env rolled). It then atomically writes the same value to
//      public.app_secrets AND vault.secrets via set_awip_service_token().
//   4. It invokes secrets-health-check and only returns 200 if that reports
//      ok:true (all three surfaces aligned). Otherwise 503 with detail.
//
// Auth: operator-only (admin role in user_roles).
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.0";
import { withLogger } from "../_shared/logger.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY     = Deno.env.get("SUPABASE_ANON_KEY")!;

function json(p: unknown, s = 200) {
  return new Response(JSON.stringify(p), {
    status: s, headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

async function fingerprint(v: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(v));
  return Array.from(new Uint8Array(buf)).slice(0, 4)
    .map((b) => b.toString(16).padStart(2, "0")).join("");
}

Deno.serve(withLogger("rotate-awip-token", async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  // --- AUTH: operator JWT with admin role ---
  const auth = req.headers.get("authorization") ?? "";
  if (!auth.startsWith("Bearer ")) return json({ error: "unauthorized" }, 401);
  const userClient = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: auth } },
  });
  const { data: { user }, error: uErr } = await userClient.auth.getUser();
  if (uErr || !user) return json({ error: "unauthorized" }, 401);

  const sb = createClient(SUPABASE_URL, SERVICE_KEY);
  const { data: isAdmin } = await sb.rpc("has_role", { _user_id: user.id, _role: "admin" });
  if (!isAdmin) return json({ error: "forbidden", reason: "admin role required" }, 403);

  // --- INPUT ---
  let body: { new_token?: string } = {};
  try { body = await req.json(); } catch { /* empty */ }
  const newToken = (body.new_token ?? "").trim();
  if (!newToken || newToken.length < 16) {
    return json({ error: "bad_request", reason: "new_token missing or shorter than 16 chars" }, 400);
  }

  const startedAt = Date.now();
  const record = async (status: string, status_code: number, message: string, detail: Record<string, unknown> = {}) => {
    try {
      await sb.from("automation_runs").insert({
        job: "rotate-awip-token", trigger: "manual",
        status, status_code, duration_ms: Date.now() - startedAt, message, detail,
      });
    } catch (e) { console.error("automation_runs insert failed", e); }
  };

  // --- STEP 1: prove the edge env was already updated ---
  const envToken = Deno.env.get("AWIP_SERVICE_TOKEN") ?? "";
  if (envToken !== newToken) {
    const msg = "Edge env AWIP_SERVICE_TOKEN does not match new_token. " +
      "Update the secret in Lovable Cloud first, wait ~30s for the edge runtime to refresh, then retry.";
    await record("error", 409, msg, {
      env_fp: envToken ? await fingerprint(envToken) : null,
      new_fp: await fingerprint(newToken),
    });
    return json({
      ok: false,
      stage: "env_check",
      error: "env_mismatch",
      message: msg,
      env_fingerprint: envToken ? await fingerprint(envToken) : null,
      new_token_fingerprint: await fingerprint(newToken),
    }, 409);
  }

  // --- STEP 2: atomically write to app_secrets + vault via SECURITY DEFINER fn ---
  const { data: rotateRes, error: rotateErr } = await sb.rpc("set_awip_service_token", { new_value: newToken });
  if (rotateErr) {
    await record("error", 500, `set_awip_service_token failed: ${rotateErr.message}`);
    return json({ ok: false, stage: "db_write", error: rotateErr.message }, 500);
  }

  // --- STEP 3: verify by invoking secrets-health-check ---
  // We call it with the operator's bearer token so it takes the manual-auth path
  // and exercises the same code cron uses to read app_secrets + env.
  let healthOk = false;
  let healthBody: unknown = null;
  let healthStatus = 0;
  try {
    const hRes = await fetch(`${SUPABASE_URL}/functions/v1/secrets-health-check`, {
      method: "POST",
      headers: {
        "Authorization": auth,
        "apikey": ANON_KEY,
        "Content-Type": "application/json",
      },
      body: "{}",
    });
    healthStatus = hRes.status;
    healthBody = await hRes.json().catch(() => null);
    healthOk = hRes.ok && !!(healthBody as { ok?: boolean })?.ok;
  } catch (e) {
    await record("error", 502, `secrets-health-check invocation failed: ${e instanceof Error ? e.message : String(e)}`,
      { rotate: rotateRes });
    return json({ ok: false, stage: "verify", error: "health_check_unreachable", rotate: rotateRes }, 502);
  }

  if (!healthOk) {
    await record("error", 503, "Rotation wrote db/vault but secrets-health-check is not green",
      { rotate: rotateRes, health: healthBody, health_status: healthStatus });
    return json({
      ok: false,
      stage: "verify",
      error: "health_not_green",
      rotate: rotateRes,
      health: healthBody,
      health_status: healthStatus,
    }, 503);
  }

  await record("ok", 200, "AWIP_SERVICE_TOKEN rotated across env+app_secrets+vault and health-check green",
    { rotate: rotateRes, health: healthBody });

  return json({
    ok: true,
    rotated_by: user.id,
    rotate: rotateRes,
    health: healthBody,
    new_token_fingerprint: await fingerprint(newToken),
  });
}));
