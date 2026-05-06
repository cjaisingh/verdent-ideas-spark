
CREATE OR REPLACE FUNCTION public.auto_purge_if_enabled()
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  enabled boolean;
  total bigint := 0;
  r record;
  del bigint;
BEGIN
  SELECT auto_purge_enabled INTO enabled FROM public.memory_settings WHERE id = true;
  IF NOT COALESCE(enabled, false) THEN
    RETURN 0;
  END IF;

  FOR r IN
    SELECT rs.table_name, rs.retention_days
    FROM public.retention_settings rs
    WHERE rs.retention_days > 0
  LOOP
    EXECUTE format(
      'WITH d AS (DELETE FROM public.%I WHERE created_at < now() - ($1 || '' days'')::interval RETURNING 1) SELECT count(*) FROM d',
      r.table_name
    ) INTO del USING r.retention_days;
    total := total + del;
  END LOOP;

  INSERT INTO public.memory_audit_log(scope, entry_key, action, new_value, actor, note)
    VALUES ('auto_purge', 'scheduled', 'removed',
            jsonb_build_object('rows_deleted', total), 'cron',
            'Automatic retention purge');
  RETURN total;
END;
$$;
