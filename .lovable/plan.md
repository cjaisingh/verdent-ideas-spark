
## Goal
Encrypt `public.app_secrets.value` at rest using `pgcrypto`, keep the env-fallback architecture intact, and make this posture auditable so it cannot silently regress.

## Non-goals
- **Not** inverting to vault-first (that's option C, deferred).
- **Not** changing cron auth model, RLS roles, or the env→db sync direction.
- **Not** re-keying or rotating the secrets themselves (separate operator task; we only change how they're stored).

## Blast radius & Core rule / ADR / FM-AI cited
- **Tables:** `public.app_secrets` (schema change: add `value_ciphertext bytea`, deprecate `value text`), `app_secrets_audit` trigger (unchanged behaviour), new `app_secret_key` settings row.
- **Edge fns:** `secrets-health-check`, `rotate-awip-token`, `deepgram-realtime-token`, `sentinel-tick` (new check), `deep-audit` (read path unchanged — only reads `key,updated_at`).
- **Crons:** all cron jobs that COALESCE env→`app_secrets` for `AWIP_SERVICE_TOKEN` / `SUPABASE_SERVICE_ROLE_KEY` — must now go through `get_app_secret(key)` SECURITY DEFINER fn.
- **Surfaces:** `/db-explorer`, `/admin` `AppSecretsPanel`, `/admin/secrets-health`.
- **Core rule cited:** "all new tables operator-only RLS + realtime" — extend to "any table whose row content is a credential must be encrypted at column level".
- **ADR cited:** new **ADR-0009 Secrets-at-rest**.
- **FM-AI failure mode:** *Silent privilege creep* — a future RLS regression or service-role leak currently dumps plaintext; encryption raises the bar to also requiring the encryption key.

## Alternatives considered
1. **A — UI masking only.** Hide values in `/db-explorer` + `AppSecretsPanel`. Cheap (~1h). **Rejected:** doesn't fix at-rest, backups still leak, doesn't satisfy ISO 42001 §A.5.10 / ISO 27001 A.8.24.
2. **B — pgcrypto column encryption (CHOSEN).** Encrypt `value` with `pgp_sym_encrypt(value, key)`, key held in `vault.secrets` (`APP_SECRETS_MEK`). SECURITY DEFINER fn `get_app_secret(text)` returns plaintext only to `service_role`. Crons call the fn instead of selecting `value`. **Why:** matches existing architecture (env-fallback preserved), no client refactor, auditable via `app_secrets_audit`, sentinel-detectable regression.
3. **C — Vault-first inversion.** Make `vault.secrets` canonical, demote `app_secrets` to metadata + `vault_secret_id`. **Deferred:** ~1 day work, touches every cron read path, higher rollback cost. Re-evaluate once B is bedded in.

## Contract
No new cron or agent loop. One new SECURITY DEFINER fn — contract is its signature:

```ts
// supabase/functions/_shared/contracts/app-secret-accessor.ts
export type AppSecretKey =
  | "AWIP_SERVICE_TOKEN"
  | "SUPABASE_SERVICE_ROLE_KEY"
  | "DEEPGRAM_API_KEY"
  // …enumerated in MANAGED list, no free-form
  ;

// RPC: public.get_app_secret(_key text) returns text
//   - SECURITY DEFINER, search_path = public, vault
//   - GRANT EXECUTE TO service_role ONLY (revoked from anon/authenticated)
//   - returns NULL if row missing (preserves env-fallback semantics in callers)
//   - raises 'app_secret.mek_missing' if vault row absent
//
// RPC: public.set_app_secret(_key text, _plaintext text) returns void
//   - SECURITY DEFINER, service_role only
//   - encrypts with pgp_sym_encrypt(plaintext, mek), upserts ciphertext column
//   - emits app_secrets_audit row (existing trigger sees ciphertext change)
```

`set_awip_service_token()` is refactored to call `set_app_secret('AWIP_SERVICE_TOKEN', new_value)` internally — preserves the vault mirror it already does.

## Persona sign-off
- **compliance-auditor:** Objection — "where's the ADR and the security memory entry?" → Plan ships ADR-0009 + `security--update_memory` call in the same migration window.
- **event-engineer:** Objection — "does the existing `app_secrets_audit` trigger still fire on UPDATE when the new column changes?" → Yes; trigger is `AFTER INSERT OR UPDATE OR DELETE` row-level, columnar change is still an UPDATE. Verified by audit-log integration test.
- **sentinel:** Objection — "if someone re-adds plaintext `value`, will I catch it?" → New check `app_secrets_plaintext_present` queries `information_schema.columns` for a non-empty `value` column on `app_secrets`; fires `critical` if found.
- **product-historian:** Objection — "ADR must cite which FM-AI failure mode and which Core rule it bends/extends" → Done in Frame + ADR body.
- **tenant-manager:** Not triggered — `app_secrets` is global, no tenant column.
- **capability-architect / control-plane-operator / okr-strategist / demand-analyst:** Not triggered.

## Gap checklist
- [x] **Idempotency:** `get_app_secret` is pure read; `set_app_secret` is upsert keyed on `key` — repeat-safe.
- [x] **Events emission:** `app_secrets_audit` trigger covers ciphertext writes.
- [x] **RLS + has_role:** unchanged on table; new fns GRANT EXECUTE to `service_role` only, REVOKE from `anon, authenticated, public`.
- [n/a] **Realtime publication:** not changing.
- [x] **observability_registry:** add row `app_secrets_at_rest` → sentinel check `app_secrets_plaintext_present`.
- [x] **withLogger:** no new edge fns; existing wrappers stay.
- [x] **No new `any`:** TS contract enums only.
- [x] **mem rule:** new `mem://features/secrets-at-rest`; update `mem://features/secret-rotation-safety` to reference it.
- [x] **CHANGELOG:** entry under `[Unreleased]` citing ADR-0009.
- [x] **Doc updates:** `docs/security.md` (encryption posture), `docs/adr/0009-secrets-at-rest.md`, `docs/runbooks/secrets-mek-rotation.md` (how to rotate the MEK without losing data).
- [x] **Security memory:** `security--update_memory` to record "app_secrets values are encrypted with pgcrypto; raw `value` column must never reappear".

## Test plan
1. **Vitest (unit) — `src/lib/secrets-display.test.ts`:** assert `AppSecretsPanel` and `/db-explorer` row renderer never display anything other than `••••` for the `value`/`value_ciphertext` column to non-service-role clients (mocked supabase returns the ciphertext bytea string; component must mask).
2. **Deno (edge fn) — `supabase/functions/secrets-health-check/index_test.ts`:** call with `?sync=env-to-db`, assert resulting row has NULL `value`, non-null `value_ciphertext`, and that subsequent `get_app_secret('AWIP_SERVICE_TOKEN')` returns the original plaintext.
3. **Deno (edge fn) — `supabase/functions/rotate-awip-token/index_test.ts`:** rotate, then assert (a) `value_ciphertext` changed, (b) `vault.secrets.AWIP_SERVICE_TOKEN` updated, (c) `app_secrets_audit` row emitted, (d) `get_app_secret` returns the new token.
4. **Sentinel test — `supabase/functions/sentinel-tick/checks_test.ts`:** add case for `app_secrets_plaintext_present`:
   - green when `value` column dropped, `value_ciphertext` populated;
   - critical finding when `value` column re-added (simulated via temp view).
5. **e2e — `e2e/secrets-at-rest.test.ts`:** as non-admin user, attempt `SELECT value_ciphertext FROM app_secrets` → 0 rows (RLS); as admin, get rows but `value` column is gone; attempt `rpc('get_app_secret', { _key: 'AWIP_SERVICE_TOKEN' })` as anon → permission denied.
6. **ADR-bench style — `scripts/security-bench/app-secrets-at-rest.ts`:** snapshot column list, confirm no column named `value`, confirm `pg_dump` of `app_secrets` produces unreadable bytea (regex assertion: no row matches `awip_mac_` or `sb_secret_` patterns).

All six fail first (TDD), pass after migration.

## Validation gates
Run in order, each must pass before the next:

```bash
# 1. migration applies cleanly + rolls forward existing rows
psql -c "SELECT key, value IS NULL AS legacy_null, value_ciphertext IS NOT NULL AS encrypted FROM public.app_secrets;"
# expect every row: legacy_null=t, encrypted=t

# 2. unit + e2e
bunx vitest run src/lib/secrets-display.test.ts
bunx vitest run e2e/secrets-at-rest.test.ts

# 3. edge fn tests
# (via supabase--test_edge_functions: secrets-health-check, rotate-awip-token, sentinel-tick)

# 4. live smoke — secrets-health-check end-to-end, must stay green
curl -s -H "Authorization: Bearer $ANON" \
  "https://agzkyzyzopcgeobofjaz.functions.supabase.co/secrets-health-check" \
  | jq '.status'   # expect "ok"

# 5. cron auth probe — overnight-phase-runner dry tick, must auth via get_app_secret path
# (via supabase--curl_edge_functions with dry_run=true)

# 6. sentinel-tick — confirm new check appears and is green
psql -c "SELECT check_name, severity FROM sentinel_findings 
         WHERE check_name='app_secrets_plaintext_present' 
         ORDER BY detected_at DESC LIMIT 1;"
# expect 0 rows OR severity='info'

# 7. db-explorer visual smoke (manual) — /db-explorer → app_secrets row shows
# value_ciphertext as bytea blob, no plaintext token visible
```

Stop and `diagnose` on any non-green; do not advance to the next gate.

## Out of scope
- **Vault-first inversion (option C).** Re-open if B reveals friction or after Phase 5/6.
- **MEK rotation automation.** Runbook only; manual operator task for now (`docs/runbooks/secrets-mek-rotation.md`).
- **Hashing operator passwords / other plaintext-credential audit across other tables.** Separate sweep — log as discussion_action `audit_other_credential_columns`.
- **Encrypting `vault.secrets` content** — already encrypted by Supabase platform.
- **Changing `/db-explorer` to mask all bytea columns globally.** This plan only redacts `app_secrets`.
- **Rotating the actual `AWIP_SERVICE_TOKEN` / `SUPABASE_SERVICE_ROLE_KEY` values.** Operator decision, separate run.
