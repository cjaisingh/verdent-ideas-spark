---
name: secrets-at-rest
description: app_secrets values are encrypted with pgcrypto + vault MEK; admins see fingerprints only, plaintext access is service_role RPC only
type: feature
---

ADR-0009. `public.app_secrets.value` (plaintext text) is gone. Schema is now `key, description, updated_at, updated_by, value_ciphertext bytea NOT NULL`.

**Read path**
- Backend (cron, edge fn): `sb.rpc('get_app_secret', { _key })` — `service_role` only, returns `string | null`. NULL preserves env-fallback semantics for callers.
- Admin UI (`AppSecretsPanel`): `sb.rpc('admin_list_app_secrets')` — admin role only, returns rows with `value_preview = 'fp:' + 6 hex chars of SHA-256(ciphertext)`. Never plaintext.

**Write path**
- Backend: `sb.rpc('set_app_secret', { _key, _plaintext, _description })` — `service_role` only.
- Admin: `sb.rpc('admin_set_app_secret', { _key, _value, _description })` — admin role only, stamps `updated_by = auth.uid()`.
- Delete: `sb.rpc('admin_delete_app_secret', { _key })` — admin role only.
- **Never** `sb.from('app_secrets').upsert(...)` from any caller — the table has no `value` column and a direct write of `value_ciphertext` would skip the MEK lookup.

**MEK** lives in `vault.secrets` as `APP_SECRETS_MEK`, generated as 64 random bytes during the ADR-0009 migration. Rotate via `docs/runbooks/secrets-mek-rotation.md` — manual, transactional, no cron.

**Detector** Sentinel check `app_secrets_plaintext_present` (severity `critical`) fires if the legacy `value` column reappears or any row has NULL ciphertext. Registered in `observability_registry` as `table:app_secrets`. Linked from `mem://features/secret-rotation-safety`.

**Contract** `supabase/functions/_shared/contracts/app-secret-accessor.ts` enumerates the managed keys (`AWIP_SERVICE_TOKEN`, `SUPABASE_SERVICE_ROLE_KEY`, `DEEPGRAM_API_KEY`). Add new keys there before using them in code.

**Out of scope** Other tables with credential-shaped columns (`connection_secrets`, `operator_inbox_sources.token_encrypted`, `tts_user_voices.cloned_voice_id`, etc.) are not yet audited. Tracked in plan-footer-ingest under `audit_other_credential_columns`.
