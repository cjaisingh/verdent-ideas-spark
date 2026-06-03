// Scheduled health check: verifies required cron/edge auth secrets exist in
// public.app_secrets (which the overnight cron jobs read via COALESCE) AND in
// the edge-function env (which the edge functions themselves read).
// Logs every run to automation_runs and dispatches an alert if anything is missing.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { withLogger } from "../_shared/logger.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-service-token",
};

// Secrets that MUST exist in BOTH app_secrets (for cron job bodies) and the
// edge-function env (for the functions that validate the incoming token).
// SUPABASE_SERVICE_ROLE_KEY is included so cron can read it from app_secrets
// to authenticate THIS function — that path is independent of AWIP rotation.
const REQUIRED_SECRETS = [
  "AWIP_SERVICE_TOKEN",
  "SUPABASE_SERVICE_ROLE_KEY",
] as const;


Deno.serve(withLogger("secrets-health-check", async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  // Auth model: cron MUST authenticate with SUPABASE_SERVICE_ROLE_KEY so this
  // detector keeps working even when AWIP_SERVICE_TOKEN diverges between env
  // and app_secrets — that's exactly the failure mode this function is meant
  // to catch. The legacy AWIP_SERVICE_TOKEN / x-service-token path is no
  // longer accepted (using it would self-DoS this detector). Manual operator
  // calls go through the standard Bearer (user JWT or anon) auth path.
  const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const auth = req.headers.get("authorization") ?? "";
  const bearer = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
  const triggeredByCron = !!SERVICE_ROLE_KEY && bearer === SERVICE_ROLE_KEY;
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

  if (!triggeredByCron && !bearer) {
    await recordRun("error", 401, !SERVICE_ROLE_KEY
      ? "SUPABASE_SERVICE_ROLE_KEY missing from edge env — cron cannot authenticate."
      : "Missing Authorization header.");
    return json({ error: "unauthorized" }, 401);
  }


  // Per ADR-0009, plaintext lives in encrypted column and is only readable
  // via public.get_app_secret(_key) under service_role. We fetch each key one
  // at a time (only 2 required secrets — negligible).
  const dbValues = new Map<string, string>();
  for (const key of REQUIRED_SECRETS) {
    const { data, error: rpcErr } = await sb.rpc("get_app_secret", { _key: key });
    if (rpcErr) {
      await recordRun("error", 500, `get_app_secret(${key}) failed: ${rpcErr.message}`);
      return json({ error: rpcErr.message }, 500);
    }
    if (typeof data === "string" && data.length > 0) dbValues.set(key, data);
  }
  const missingInEnv = REQUIRED_SECRETS.filter((k) => !Deno.env.get(k));

  // Auto-sync: if a required secret exists in env but not in app_secrets,
  // write the encrypted row so cron jobs (which read via get_app_secret) can authenticate.
  const synced: string[] = [];
  for (const key of REQUIRED_SECRETS) {
    const envVal = Deno.env.get(key);
    if (!envVal) continue;
    if (dbValues.has(key)) continue;
    const { error: upErr } = await sb.rpc("set_app_secret", {
      _key: key, _plaintext: envVal,
      _description: `Auto-synced from edge env by secrets-health-check`,
    });
    if (!upErr) {
      dbValues.set(key, envVal);
      synced.push(key);
    } else {
      console.error(`failed to sync ${key}:`, upErr);
    }
  }
  const missingInDb = REQUIRED_SECRETS.filter((k) => !dbValues.has(k));

  // Mismatch detection: present in BOTH places but values differ.
  const url = new URL(req.url);
  const syncMode = url.searchParams.get("sync");
  // sync modes (operator-only):
  //   env-to-db    → overwrite app_secrets from edge env
  //   env-to-vault → overwrite vault.secrets from edge env (AWIP_SERVICE_TOKEN only)
  //   env-to-all   → both of the above in lockstep
  const allowSync = !triggeredByCron && (syncMode === "env-to-db" || syncMode === "env-to-all");
  const allowVaultSync = !triggeredByCron && (syncMode === "env-to-vault" || syncMode === "env-to-all");


  const mismatches: { key: string; env_fp: string; db_fp: string; resynced?: boolean }[] = [];
  for (const key of REQUIRED_SECRETS) {
    const envVal = Deno.env.get(key);
    const dbVal = dbValues.get(key);
    if (!envVal || !dbVal) continue;
    if (envVal === dbVal) continue;
    let resynced = false;
    if (allowSync) {
      const { error: upErr } = await sb.rpc("set_app_secret", {
        _key: key, _plaintext: envVal,
        _description: `Synced env→db by secrets-health-check (operator sync)`,
      });
      if (!upErr) { dbValues.set(key, envVal); resynced = true; }
    }
    mismatches.push({
      key,
      env_fp: await fingerprint(envVal),
      db_fp: await fingerprint(dbVal),
      resynced,
    });
  }
  // After sync, recompute mismatches (drop the ones we just aligned).
  const effectiveMismatches = mismatches.filter((m) => !m.resynced);

  // Vault sync: AWIP_SERVICE_TOKEN is mirrored into vault.secrets for the cron
  // jobs that read from vault.decrypted_secrets. We can't read vault from here
  // (no decrypt access), so we call set_awip_service_token which atomically
  // writes app_secrets + vault. Only fires on explicit operator request.
  const vaultSynced: { key: string; ok: boolean; error?: string }[] = [];
  if (allowVaultSync) {
    const envToken = Deno.env.get("AWIP_SERVICE_TOKEN");
    if (envToken) {
      const { error: vErr } = await sb.rpc("set_awip_service_token", { new_value: envToken });
      vaultSynced.push({ key: "AWIP_SERVICE_TOKEN", ok: !vErr, error: vErr?.message });
      if (!vErr) {
        // app_secrets row was also overwritten — make sure mismatch state reflects that.
        dbValues.set("AWIP_SERVICE_TOKEN", envToken);
      }
    } else {
      vaultSynced.push({ key: "AWIP_SERVICE_TOKEN", ok: false, error: "AWIP_SERVICE_TOKEN missing in edge env" });
    }
  }
  const vaultSyncedKeys = vaultSynced.filter((v) => v.ok).map((v) => v.key);
  // Recompute mismatches after vault sync may have realigned app_secrets too.
  const finalMismatches = effectiveMismatches.filter((m) => !vaultSyncedKeys.includes(m.key));


  const ok = missingInDb.length === 0 && missingInEnv.length === 0 && finalMismatches.length === 0;
  const messageParts: string[] = [];
  if (missingInDb.length) messageParts.push(`missing in db: [${missingInDb.join(",")}]`);
  if (missingInEnv.length) messageParts.push(`missing in env: [${missingInEnv.join(",")}]`);
  if (finalMismatches.length) messageParts.push(`mismatched: [${finalMismatches.map((m) => m.key).join(",")}]`);
  const resyncedKeys = mismatches.filter((m) => m.resynced).map((m) => m.key);
  if (resyncedKeys.length) messageParts.push(`resynced env→db: [${resyncedKeys.join(",")}]`);
  if (vaultSyncedKeys.length) messageParts.push(`resynced env→vault: [${vaultSyncedKeys.join(",")}]`);
  const vaultSyncFailed = vaultSynced.filter((v) => !v.ok);
  if (vaultSyncFailed.length) messageParts.push(`vault sync failed: [${vaultSyncFailed.map((v) => `${v.key}:${v.error}`).join(",")}]`);
  const message = ok
    ? `All ${REQUIRED_SECRETS.length} required secrets present and matching` +
      (resyncedKeys.length ? ` (resynced db: ${resyncedKeys.join(",")})` : "") +
      (vaultSyncedKeys.length ? ` (resynced vault: ${vaultSyncedKeys.join(",")})` : "")
    : `Secret check failed — ${messageParts.join(" · ")}`;

  await recordRun(ok ? "ok" : "error", ok ? 200 : 503, message, {
    required: REQUIRED_SECRETS, missing_in_db: missingInDb, missing_in_env: missingInEnv,
    synced_to_db: synced, mismatches: finalMismatches,
    resynced_env_to_db: resyncedKeys, resynced_env_to_vault: vaultSyncedKeys,
    vault_sync: vaultSynced,
  });

  if (finalMismatches.length > 0) {
    await dispatchAlert(sb, "secrets-health-check", "secrets_mismatch",
      `Edge env and app_secrets disagree for: ${finalMismatches.map((m) => m.key).join(", ")}. ` +
      `Rotate one side or run the sync to align them.`,
      { mismatches: finalMismatches });
  }
  if (missingInDb.length > 0 || missingInEnv.length > 0) {
    await dispatchAlert(sb, "secrets-health-check", "secrets_missing", message, {
      missing_in_db: missingInDb, missing_in_env: missingInEnv,
    });
  }

  return json({
    ok,
    missing_in_db: missingInDb,
    missing_in_env: missingInEnv,
    synced_to_db: synced,
    resynced_env_to_db: resyncedKeys,
    resynced_env_to_vault: vaultSyncedKeys,
    vault_sync: vaultSynced,
    mismatches: finalMismatches,
  });
}));


async function fingerprint(v: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(v));
  return Array.from(new Uint8Array(buf)).slice(0, 4)
    .map((b) => b.toString(16).padStart(2, "0")).join("");
}

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
