// Scheduled health check: verifies required cron/edge auth secrets exist in
// public.app_secrets (which the overnight cron jobs read via COALESCE) AND in
// the edge-function env (which the edge functions themselves read).
// Logs every run to automation_runs and dispatches an alert if anything is missing.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-service-token",
};

// Secrets that MUST exist in BOTH app_secrets (for cron job bodies) and the
// edge-function env (for the functions that validate the incoming token).
const REQUIRED_SECRETS = ["AWIP_SERVICE_TOKEN"] as const;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const SERVICE_TOKEN = Deno.env.get("AWIP_SERVICE_TOKEN");
  const provided = req.headers.get("x-service-token");
  const auth = req.headers.get("authorization") ?? "";
  const triggeredByCron = !!SERVICE_TOKEN && provided === SERVICE_TOKEN;
  const trigger = triggeredByCron ? "cron" : "manual";

  const sb = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );
  const startedAt = Date.now();
  const recordRun = async (
    status: string, status_code: number, message: string,
    detail: Record<string, unknown> = {},
  ) => {
    try {
      await sb.from("automation_runs").insert({
        job: "secrets-health-check", trigger, status, status_code,
        duration_ms: Date.now() - startedAt, message, detail,
      });
    } catch (e) { console.error("automation_runs insert failed", e); }
  };

  if (!triggeredByCron && !auth.startsWith("Bearer ")) {
    await recordRun("error", 401, !SERVICE_TOKEN
      ? "AWIP_SERVICE_TOKEN secret is missing in Lovable Cloud — cron cannot authenticate."
      : "Missing service token and no Authorization header.");
    return json({ error: "unauthorized" }, 401);
  }

  const { data: rows, error } = await sb
    .from("app_secrets").select("key").in("key", REQUIRED_SECRETS as unknown as string[]);
  if (error) {
    await recordRun("error", 500, `app_secrets query failed: ${error.message}`);
    return json({ error: error.message }, 500);
  }
  const presentInDb = new Set((rows ?? []).map((r: any) => r.key));
  const missingInEnv = REQUIRED_SECRETS.filter((k) => !Deno.env.get(k));

  // Auto-sync: if a required secret exists in env but not in app_secrets,
  // upsert it so cron jobs (which read from app_secrets) can authenticate.
  const synced: string[] = [];
  for (const key of REQUIRED_SECRETS) {
    const envVal = Deno.env.get(key);
    if (!envVal) continue;
    if (presentInDb.has(key)) continue;
    const { error: upErr } = await sb.from("app_secrets").upsert({
      key, value: envVal,
      description: `Auto-synced from edge env by secrets-health-check`,
    }, { onConflict: "key" });
    if (!upErr) {
      presentInDb.add(key);
      synced.push(key);
    } else {
      console.error(`failed to sync ${key}:`, upErr);
    }
  }
  const missingInDb = REQUIRED_SECRETS.filter((k) => !presentInDb.has(k));

  const ok = missingInDb.length === 0 && missingInEnv.length === 0;
  const message = ok
    ? `All ${REQUIRED_SECRETS.length} required secrets present`
    : `Missing secrets — db:[${missingInDb.join(",") || "none"}] env:[${missingInEnv.join(",") || "none"}]`;

  await recordRun(ok ? "ok" : "error", ok ? 200 : 503, message, {
    required: REQUIRED_SECRETS, missing_in_db: missingInDb, missing_in_env: missingInEnv,
  });

  if (!ok) {
    await dispatchAlert(sb, "secrets-health-check", "secrets_missing", message, {
      missing_in_db: missingInDb, missing_in_env: missingInEnv,
    });
  }

  return json({ ok, missing_in_db: missingInDb, missing_in_env: missingInEnv });
});

function json(p: unknown, s = 200) {
  return new Response(JSON.stringify(p), {
    status: s, headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

async function dispatchAlert(
  sb: ReturnType<typeof createClient>,
  job: string, reason: string, message: string, payload: Record<string, unknown> = {},
) {
  try {
    const { data: settings } = await sb.from("alert_settings").select("*").eq("id", true).maybeSingle();
    if (!settings || !settings.enabled || !settings.webhook_url) return;
    const dedupeMin = Math.max(0, Number(settings.dedupe_minutes ?? 0));
    if (dedupeMin > 0) {
      const since = new Date(Date.now() - dedupeMin * 60_000).toISOString();
      const { data: recent } = await sb.from("alert_log")
        .select("id").eq("job", job).eq("reason", reason).eq("delivered", true)
        .gte("created_at", since).limit(1);
      if (recent && recent.length > 0) return;
    }
    const body = JSON.stringify({
      text: `🚨 ${job} · ${reason}\n${message}`,
      job, reason, message, payload, ts: new Date().toISOString(),
    });
    let delivered = false; let status_code: number | null = null; let error: string | null = null;
    try {
      const r = await fetch(settings.webhook_url, {
        method: "POST", headers: { "Content-Type": "application/json" }, body,
      });
      status_code = r.status; delivered = r.ok;
      if (!r.ok) error = (await r.text()).slice(0, 300);
    } catch (e) { error = e instanceof Error ? e.message : String(e); }
    await sb.from("alert_log").insert({ job, reason, message, delivered, status_code, error, payload });
  } catch (e) { console.error("dispatchAlert failed", e); }
}
