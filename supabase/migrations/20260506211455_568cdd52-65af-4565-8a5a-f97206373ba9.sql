
CREATE OR REPLACE FUNCTION public.purge_all_rows(_table text)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  del bigint;
  uid uuid := auth.uid();
  label text;
BEGIN
  IF NOT public.has_role(uid, 'operator'::app_role) THEN
    RAISE EXCEPTION 'not authorized';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.retention_settings WHERE table_name = _table) THEN
    RAISE EXCEPTION 'table % is not a managed retention table', _table;
  END IF;

  EXECUTE format('WITH d AS (DELETE FROM public.%I RETURNING 1) SELECT count(*) FROM d', _table) INTO del;

  SELECT email INTO label FROM auth.users WHERE id = uid;
  IF label IS NULL THEN label := 'system'; END IF;

  INSERT INTO public.memory_audit_log(scope, entry_key, action, old_value, actor, note)
    VALUES ('manual_purge', _table, 'removed',
            jsonb_build_object('rows_deleted', del), label,
            'Manual purge from Memory page');

  RETURN del;
END;
$$;
