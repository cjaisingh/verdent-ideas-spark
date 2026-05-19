
CREATE OR REPLACE FUNCTION public.set_awip_service_token(new_value text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, vault
AS $$
DECLARE
  v_secret_id uuid;
  v_app_before text;
  v_vault_before text;
  v_fp text;
BEGIN
  IF new_value IS NULL OR length(new_value) < 16 THEN
    RAISE EXCEPTION 'new_value too short (min 16 chars)';
  END IF;

  -- snapshot prior values for audit
  SELECT value INTO v_app_before FROM public.app_secrets WHERE key = 'AWIP_SERVICE_TOKEN';
  SELECT decrypted_secret INTO v_vault_before
    FROM vault.decrypted_secrets WHERE name = 'AWIP_SERVICE_TOKEN';

  -- 1) app_secrets upsert
  INSERT INTO public.app_secrets(key, value, description)
  VALUES ('AWIP_SERVICE_TOKEN', new_value, 'Rotated via rotate-awip-token edge fn')
  ON CONFLICT (key) DO UPDATE
    SET value = EXCLUDED.value,
        description = EXCLUDED.description,
        updated_at = now();

  -- 2) vault upsert
  SELECT id INTO v_secret_id FROM vault.secrets WHERE name = 'AWIP_SERVICE_TOKEN';
  IF v_secret_id IS NULL THEN
    v_secret_id := vault.create_secret(new_value, 'AWIP_SERVICE_TOKEN', 'Rotated via rotate-awip-token edge fn');
  ELSE
    PERFORM vault.update_secret(v_secret_id, new_value, 'AWIP_SERVICE_TOKEN', 'Rotated via rotate-awip-token edge fn');
  END IF;

  v_fp := substr(encode(digest(new_value, 'sha256'), 'hex'), 1, 8);

  RETURN jsonb_build_object(
    'ok', true,
    'fingerprint', v_fp,
    'app_secrets_changed', (v_app_before IS DISTINCT FROM new_value),
    'vault_changed', (v_vault_before IS DISTINCT FROM new_value),
    'vault_secret_id', v_secret_id
  );
END;
$$;

REVOKE ALL ON FUNCTION public.set_awip_service_token(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.set_awip_service_token(text) TO service_role;
