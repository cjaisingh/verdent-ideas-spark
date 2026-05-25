// Typed contract for the app_secrets accessor RPCs.
//
// Background: as of ADR-0009 the public.app_secrets `value` column is gone.
// Plaintext lives encrypted at rest in `value_ciphertext bytea` and the MEK
// lives in vault.secrets ('APP_SECRETS_MEK'). Plaintext crosses the wire only
// through the two SECURITY DEFINER RPCs below.
//
// See:
//   - docs/adr/0009-secrets-at-rest.md
//   - mem://features/secrets-at-rest
//   - supabase/migrations/<this work>__encrypt_app_secrets.sql

/** Enumerated keys we manage in app_secrets. Add new keys here intentionally. */
export type AppSecretKey =
  | "AWIP_SERVICE_TOKEN"
  | "SUPABASE_SERVICE_ROLE_KEY"
  | "DEEPGRAM_API_KEY";

export const APP_SECRET_KEYS = [
  "AWIP_SERVICE_TOKEN",
  "SUPABASE_SERVICE_ROLE_KEY",
  "DEEPGRAM_API_KEY",
] as const satisfies readonly AppSecretKey[];

/** RPC: public.get_app_secret(_key text) returns text
 *   service_role only. Returns NULL when the row is absent (callers should
 *   then fall back to Deno.env.get(key), preserving the env-fallback model). */
export type GetAppSecretInput = { _key: AppSecretKey };
export type GetAppSecretOutput = string | null;

/** RPC: public.set_app_secret(_key text, _plaintext text, _description text default null)
 *   service_role only. Encrypts plaintext with the MEK from vault.secrets and
 *   upserts the row. Emits app_secrets_audit via the existing trigger. */
export type SetAppSecretInput = {
  _key: AppSecretKey;
  _plaintext: string;
  _description?: string | null;
};
export type SetAppSecretOutput = { ok: true; key: AppSecretKey; fingerprint: string };
