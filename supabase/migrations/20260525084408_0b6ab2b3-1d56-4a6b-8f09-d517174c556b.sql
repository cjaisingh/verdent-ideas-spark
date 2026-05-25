
-- ADR-0009 Secrets-at-rest: encrypt public.app_secrets.value with pgcrypto + vault MEK.

-- 1. Ensure MEK exists in vault.
DO $$
DECLARE v_mek_id uuid;
BEGIN
  SELECT id INTO v_mek_id FROM vault.secrets WHERE name = 'APP_SECRETS_MEK';
  IF v_mek_id IS NULL THEN
    PERFORM vault.create_secret(
      encode(extensions.gen_random_bytes(64), 'base64'),
      'APP_SECRETS_MEK',
      'Master encryption key for public.app_secrets.value_ciphertext - rotate via docs/runbooks/secrets-mek-rotation.md'
    );
  END IF;
END $$;

-- 2. Add ciphertext column.
ALTER TABLE public.app_secrets
  ADD COLUMN IF NOT EXISTS value_ciphertext bytea;

-- 3. Backfill.
DO $$
DECLARE v_mek text;
BEGIN
  SELECT decrypted_secret INTO v_mek FROM vault.decrypted_secrets WHERE name = 'APP_SECRETS_MEK';
  IF v_mek IS NULL THEN RAISE EXCEPTION 'APP_SECRETS_MEK missing from vault'; END IF;
  UPDATE public.app_secrets
    SET value_ciphertext = extensions.pgp_sym_encrypt(value, v_mek)
    WHERE value_ciphertext IS NULL AND value IS NOT NULL;
END $$;

-- 4. Replace audit trigger fn so it no longer touches the value column.
CREATE OR REPLACE FUNCTION public.log_app_secret_change()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE label text; old_fp text; new_fp text;
BEGIN
  SELECT email INTO label FROM auth.users WHERE id = auth.uid();
  IF label IS NULL THEN label := 'system'; END IF;
  IF TG_OP = 'INSERT' THEN
    new_fp := CASE WHEN NEW.value_ciphertext IS NULL THEN NULL
                   ELSE substr(encode(extensions.digest(NEW.value_ciphertext, 'sha256'), 'hex'), 1, 12) END;
    INSERT INTO public.memory_audit_log(scope, entry_key, action, new_value, actor)
      VALUES ('app_secret', NEW.key, 'added',
              jsonb_build_object('ciphertext_fp', new_fp, 'description', NEW.description), label);
    RETURN NEW;
  ELSIF TG_OP = 'UPDATE' THEN
    old_fp := CASE WHEN OLD.value_ciphertext IS NULL THEN NULL
                   ELSE substr(encode(extensions.digest(OLD.value_ciphertext, 'sha256'), 'hex'), 1, 12) END;
    new_fp := CASE WHEN NEW.value_ciphertext IS NULL THEN NULL
                   ELSE substr(encode(extensions.digest(NEW.value_ciphertext, 'sha256'), 'hex'), 1, 12) END;
    INSERT INTO public.memory_audit_log(scope, entry_key, action, old_value, new_value, actor)
      VALUES ('app_secret', NEW.key, 'updated',
              jsonb_build_object('ciphertext_fp', old_fp),
              jsonb_build_object('ciphertext_fp', new_fp, 'description', NEW.description), label);
    RETURN NEW;
  ELSIF TG_OP = 'DELETE' THEN
    old_fp := CASE WHEN OLD.value_ciphertext IS NULL THEN NULL
                   ELSE substr(encode(extensions.digest(OLD.value_ciphertext, 'sha256'), 'hex'), 1, 12) END;
    INSERT INTO public.memory_audit_log(scope, entry_key, action, old_value, actor)
      VALUES ('app_secret', OLD.key, 'removed',
              jsonb_build_object('ciphertext_fp', old_fp), label);
    RETURN OLD;
  END IF;
  RETURN NULL;
END $$;

-- 5. Drop the plain-text column.
ALTER TABLE public.app_secrets DROP COLUMN IF EXISTS value;

-- 6. Enforce NOT NULL on ciphertext.
ALTER TABLE public.app_secrets ALTER COLUMN value_ciphertext SET NOT NULL;

-- 7. Service-role reader.
CREATE OR REPLACE FUNCTION public.get_app_secret(_key text)
RETURNS text LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, vault, extensions
AS $$
DECLARE v_cipher bytea; v_mek text;
BEGIN
  SELECT value_ciphertext INTO v_cipher FROM public.app_secrets WHERE key = _key;
  IF v_cipher IS NULL THEN RETURN NULL; END IF;
  SELECT decrypted_secret INTO v_mek FROM vault.decrypted_secrets WHERE name = 'APP_SECRETS_MEK';
  IF v_mek IS NULL THEN RAISE EXCEPTION 'app_secret.mek_missing'; END IF;
  RETURN extensions.pgp_sym_decrypt(v_cipher, v_mek);
END $$;
REVOKE ALL ON FUNCTION public.get_app_secret(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_app_secret(text) TO service_role;

-- 8. Service-role writer.
CREATE OR REPLACE FUNCTION public.set_app_secret(_key text, _plaintext text, _description text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, vault, extensions
AS $$
DECLARE v_mek text; v_cipher bytea; v_fp text;
BEGIN
  IF _plaintext IS NULL OR length(_plaintext) < 8 THEN RAISE EXCEPTION 'app_secret.plaintext_too_short'; END IF;
  SELECT decrypted_secret INTO v_mek FROM vault.decrypted_secrets WHERE name = 'APP_SECRETS_MEK';
  IF v_mek IS NULL THEN RAISE EXCEPTION 'app_secret.mek_missing'; END IF;
  v_cipher := extensions.pgp_sym_encrypt(_plaintext, v_mek);
  INSERT INTO public.app_secrets(key, value_ciphertext, description, updated_at)
    VALUES (_key, v_cipher, _description, now())
    ON CONFLICT (key) DO UPDATE
      SET value_ciphertext = EXCLUDED.value_ciphertext,
          description = COALESCE(EXCLUDED.description, public.app_secrets.description),
          updated_at = now();
  v_fp := substr(encode(extensions.digest(_plaintext, 'sha256'), 'hex'), 1, 8);
  RETURN jsonb_build_object('ok', true, 'key', _key, 'fingerprint', v_fp);
END $$;
REVOKE ALL ON FUNCTION public.set_app_secret(text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.set_app_secret(text, text, text) TO service_role;

-- 9. Admin-facing helpers (preview only).
CREATE OR REPLACE FUNCTION public.admin_list_app_secrets()
RETURNS TABLE(key text, value_preview text, description text, updated_at timestamptz, updated_by uuid)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, extensions
AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN RAISE EXCEPTION 'forbidden'; END IF;
  RETURN QUERY
    SELECT s.key,
           ('fp:' || substr(encode(extensions.digest(s.value_ciphertext, 'sha256'), 'hex'), 1, 6)) AS value_preview,
           s.description, s.updated_at, s.updated_by
      FROM public.app_secrets s ORDER BY s.key;
END $$;
REVOKE ALL ON FUNCTION public.admin_list_app_secrets() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_list_app_secrets() TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.admin_set_app_secret(_key text, _value text, _description text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, vault, extensions
AS $$
DECLARE v_result jsonb;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN RAISE EXCEPTION 'forbidden'; END IF;
  v_result := public.set_app_secret(_key, _value, _description);
  UPDATE public.app_secrets SET updated_by = auth.uid() WHERE key = _key;
  RETURN v_result;
END $$;
REVOKE ALL ON FUNCTION public.admin_set_app_secret(text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_set_app_secret(text, text, text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.admin_delete_app_secret(_key text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN RAISE EXCEPTION 'forbidden'; END IF;
  DELETE FROM public.app_secrets WHERE key = _key;
  RETURN jsonb_build_object('ok', true, 'key', _key);
END $$;
REVOKE ALL ON FUNCTION public.admin_delete_app_secret(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_delete_app_secret(text) TO authenticated, service_role;

-- 10. Refactor set_awip_service_token to use set_app_secret.
CREATE OR REPLACE FUNCTION public.set_awip_service_token(new_value text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, vault, extensions
AS $$
DECLARE v_secret_id uuid; v_app_before_cipher bytea; v_app_before_plain text;
        v_vault_before text; v_fp text; v_mek text;
BEGIN
  IF new_value IS NULL OR length(new_value) < 16 THEN RAISE EXCEPTION 'new_value too short (min 16 chars)'; END IF;
  SELECT decrypted_secret INTO v_mek FROM vault.decrypted_secrets WHERE name = 'APP_SECRETS_MEK';
  SELECT value_ciphertext INTO v_app_before_cipher FROM public.app_secrets WHERE key = 'AWIP_SERVICE_TOKEN';
  IF v_app_before_cipher IS NOT NULL AND v_mek IS NOT NULL THEN
    BEGIN v_app_before_plain := extensions.pgp_sym_decrypt(v_app_before_cipher, v_mek);
    EXCEPTION WHEN OTHERS THEN v_app_before_plain := NULL; END;
  END IF;
  SELECT decrypted_secret INTO v_vault_before FROM vault.decrypted_secrets WHERE name = 'AWIP_SERVICE_TOKEN';

  PERFORM public.set_app_secret('AWIP_SERVICE_TOKEN', new_value, 'Rotated via rotate-awip-token edge fn');

  SELECT id INTO v_secret_id FROM vault.secrets WHERE name = 'AWIP_SERVICE_TOKEN';
  IF v_secret_id IS NULL THEN
    v_secret_id := vault.create_secret(new_value, 'AWIP_SERVICE_TOKEN', 'Rotated via rotate-awip-token edge fn');
  ELSE
    PERFORM vault.update_secret(v_secret_id, new_value, 'AWIP_SERVICE_TOKEN', 'Rotated via rotate-awip-token edge fn');
  END IF;

  v_fp := substr(encode(extensions.digest(new_value, 'sha256'), 'hex'), 1, 8);

  RETURN jsonb_build_object(
    'ok', true,
    'fingerprint', v_fp,
    'app_secrets_changed', (v_app_before_plain IS DISTINCT FROM new_value),
    'vault_changed', (v_vault_before IS DISTINCT FROM new_value),
    'vault_secret_id', v_secret_id
  );
END $$;
REVOKE ALL ON FUNCTION public.set_awip_service_token(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.set_awip_service_token(text) TO service_role;

-- 11. Observability registry entry.
INSERT INTO public.observability_registry(surface_kind, surface_id, watcher_kinds, owner, notes, declared_in)
VALUES ('table', 'app_secrets', ARRAY['sentinel:app_secrets_plaintext_present'], 'compliance-auditor',
        'ADR-0009: app_secrets values are encrypted at rest via pgcrypto. Sentinel fires critical if the legacy value column reappears or if any row has NULL ciphertext.',
        'docs/adr/0009-secrets-at-rest.md')
ON CONFLICT (surface_kind, surface_id) DO UPDATE
  SET watcher_kinds = EXCLUDED.watcher_kinds,
      owner = EXCLUDED.owner,
      notes = EXCLUDED.notes,
      declared_in = EXCLUDED.declared_in,
      updated_at = now();
