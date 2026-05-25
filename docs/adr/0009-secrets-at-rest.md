# ADR-0009: Secrets at rest

- **Status:** accepted
- **Date:** 2026-05-25

## Context

`public.app_secrets` is the operator-rotatable store for backend credentials that cron jobs and edge functions COALESCE against `Deno.env.get(key)`. Until this ADR, the `value` column was plain `text`. RLS restricted reads to `has_role(auth.uid(),'admin')` and a write-audit trigger logged a 6-char preview, but nothing protected the data at rest:

- A future RLS regression, a misused `service_role` key, or a `pg_dump` snapshot exposed the raw token.
- Backups, PITR, and the `/db-explorer` admin UI all rendered the column verbatim.
- The Supabase linter passes (RLS present, anon blocked) so governance and security audits never flagged the gap. ISO 42001 §A.5.10 and ISO 27001 A.8.24 both call for encryption-at-rest for credential material.
- The defining failure mode is **silent privilege creep** (per `docs/why-awip.md`): a small later change exposes a large class of secrets and no detector fires.

`AWIP_SERVICE_TOKEN` already had a mirror in `vault.secrets` via `set_awip_service_token()`, but `vault` was a write-only side-channel; cron's canonical read path was still the plaintext column.

## Decision

Encrypt `app_secrets.value` at column level with `pgcrypto` (`pgp_sym_encrypt`/`pgp_sym_decrypt`). The master encryption key (MEK) lives in `vault.secrets` under the name `APP_SECRETS_MEK`, generated as 64 random bytes during the migration.

The legacy `value text` column is dropped. Plaintext only crosses the wire through two `SECURITY DEFINER` RPCs:

- `public.get_app_secret(_key text) → text` — `service_role` only. Returns `NULL` when the row is absent so callers preserve env-fallback semantics.
- `public.set_app_secret(_key text, _plaintext text, _description text) → jsonb` — `service_role` only. Encrypts with the MEK and upserts. Emits an audit row through the existing trigger.

Admin operators using `/admin → AppSecretsPanel` go through `admin_list_app_secrets` / `admin_set_app_secret` / `admin_delete_app_secret`. The list helper returns a 6-char SHA-256 fingerprint of the ciphertext (`fp:abc123`), never the plaintext. The set helper internally calls `set_app_secret` then stamps `updated_by = auth.uid()`.

`set_awip_service_token()` is refactored to call `set_app_secret('AWIP_SERVICE_TOKEN', ...)` for the `app_secrets` side, preserving the `vault.secrets` mirror and the `app_secrets_changed`/`vault_changed` return fields.

A sentinel check `app_secrets_plaintext_present` (severity `critical`, dedupe `app_secrets_plaintext_present`) fires when either:
1. the legacy `value` column reappears on `public.app_secrets`, or
2. any row has `NULL value_ciphertext`.

The table is registered in `observability_registry` under `surface_kind='table', surface_id='app_secrets'`, citing this ADR.

## Consequences

**Easier**
- Database-only attacks (RLS regression, `pg_dump`, snapshot exfil) now need the MEK too.
- Backups carry ciphertext, not tokens.
- `/db-explorer` and the admin panel cannot leak the value, even on a shared screen — the value column is gone and the panel only ever shows a fingerprint.
- Governance has a citable contract (this ADR) and an automated detector to fail against.

**Harder**
- All callers must use the RPC instead of `select value`. Three call sites were refactored (`secrets-health-check`, `deepgram-realtime-token`, `AppSecretsPanel`); the operator flow is unchanged.
- MEK rotation is a deliberate operator action (see `docs/runbooks/secrets-mek-rotation.md`). The MEK is *not* automatically rotated; if it leaks, every ciphertext is exposed.
- Each `pgp_sym_encrypt` produces fresh nonce — change-detection for `vault_changed`/`app_secrets_changed` must compare decrypted prior, not ciphertext bytes.

**Explicitly accepted downsides**
- The MEK lives in `vault.secrets`, which is itself encrypted by the Supabase platform. We accept Supabase's KMS as our root of trust; we do not yet bring our own KMS.
- We did not invert to vault-first (option C in the rigorous-planning brief). Re-evaluate after Phase 5/6 once retrieval contracts settle.
- We did not audit other tables for plaintext credentials (e.g. `connection_secrets`, `operator_inbox_sources.token_encrypted`). Tracked as a follow-up discussion_action.

## References

- `supabase/functions/_shared/contracts/app-secret-accessor.ts`
- `supabase/functions/sentinel-tick/checks.ts → checkAppSecretsPlaintextPresent`
- `docs/runbooks/secrets-mek-rotation.md`
- `mem://features/secrets-at-rest`
- ISO/IEC 27001:2022 A.8.24 (use of cryptography); ISO/IEC 42001:2023 §A.5.10.
