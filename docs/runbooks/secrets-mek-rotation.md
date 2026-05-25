# Runbook — Rotate `APP_SECRETS_MEK`

Last reviewed: 2026-05-25 · Owner: compliance-auditor · See ADR-0009.

The MEK encrypts every row in `public.app_secrets.value_ciphertext`. It lives in `vault.secrets` under the name `APP_SECRETS_MEK`. Rotating it means: decrypt every row with the old MEK, generate a new MEK, re-encrypt every row, swap the vault row, verify.

This is **not** automated. Run it intentionally, e.g. after a suspected leak, a contributor offboarding, or as a scheduled annual hygiene step.

## Pre-flight

1. Confirm `sentinel_findings` has no open `app_secrets_plaintext_present` row.
2. Confirm `secrets-health-check` is green within the last hour.
3. Take a manual snapshot via the Supabase dashboard.

## Rotate

Run as the database owner (Supabase SQL Editor, *not* the edge runtime). Wrap in a transaction so a failure rolls back to the old MEK cleanly.

```sql
BEGIN;

-- 1. Capture old MEK and decrypt all rows into a temp table.
DO $$
DECLARE v_old_mek text; v_new_mek text;
BEGIN
  SELECT decrypted_secret INTO v_old_mek FROM vault.decrypted_secrets WHERE name = 'APP_SECRETS_MEK';
  IF v_old_mek IS NULL THEN RAISE EXCEPTION 'old MEK missing'; END IF;

  CREATE TEMP TABLE _app_secrets_plain ON COMMIT DROP AS
    SELECT key, extensions.pgp_sym_decrypt(value_ciphertext, v_old_mek) AS plain, description, updated_at, updated_by
      FROM public.app_secrets;

  -- 2. Generate new MEK and swap in vault.
  v_new_mek := encode(extensions.gen_random_bytes(64), 'base64');
  PERFORM vault.update_secret(
    (SELECT id FROM vault.secrets WHERE name = 'APP_SECRETS_MEK'),
    v_new_mek, 'APP_SECRETS_MEK',
    'Rotated ' || now()::text || ' via secrets-mek-rotation runbook'
  );

  -- 3. Re-encrypt every row with new MEK.
  UPDATE public.app_secrets s
    SET value_ciphertext = extensions.pgp_sym_encrypt(p.plain, v_new_mek)
    FROM _app_secrets_plain p
    WHERE s.key = p.key;
END $$;

-- 4. Smoke-test: round-trip each key.
SELECT key, length(public.get_app_secret(key)) AS plen FROM public.app_secrets ORDER BY key;

COMMIT;
```

## Verify

1. `SELECT 1 FROM public.app_secrets WHERE value_ciphertext IS NULL;` → 0 rows.
2. Invoke `POST /functions/v1/secrets-health-check` with an operator bearer → expect `ok: true`.
3. Invoke `POST /functions/v1/deepgram-realtime-token` from the panel "Test" button → expect a fresh token.
4. Watch the next `sentinel-tick` (≤15 min) — `app_secrets_plaintext_present` must remain absent/green.

## Rollback

The transaction approach means a thrown exception inside the `DO` block rolls back both the row updates and the vault swap. If you only realise the new MEK is wrong *after* `COMMIT`, you cannot recover — the old MEK is gone. In that case:

- Pull the latest snapshot.
- Or, treat every key as exposed: rotate each token at its provider (Deepgram dashboard, Lovable Cloud secrets form for `AWIP_SERVICE_TOKEN`, etc.) and use `admin_set_app_secret` to write the new values.

The drill of `set_app_secret` always preserves env-fallback: if the row is gone, edge functions fall back to `Deno.env.get(key)`, so a botched rotation degrades gracefully as long as the env values are still set.
