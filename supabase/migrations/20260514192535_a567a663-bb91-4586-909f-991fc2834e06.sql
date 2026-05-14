
CREATE OR REPLACE FUNCTION public.db_preview_rows(_table text, _limit integer DEFAULT 50, _offset integer DEFAULT 0)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  result jsonb;
  safe_limit int := LEAST(GREATEST(COALESCE(_limit, 50), 1), 200);
  safe_offset int := GREATEST(COALESCE(_offset, 0), 0);
  has_created boolean;
  order_clause text;
BEGIN
  IF NOT (public.has_role(auth.uid(), 'operator'::app_role)
       OR public.has_role(auth.uid(), 'admin'::app_role)) THEN
    RAISE EXCEPTION 'not authorized';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = _table
  ) THEN
    RAISE EXCEPTION 'unknown table %', _table;
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = _table AND column_name = 'created_at'
  ) INTO has_created;

  order_clause := CASE WHEN has_created THEN 'ORDER BY created_at DESC NULLS LAST' ELSE '' END;

  EXECUTE format(
    'SELECT COALESCE(jsonb_agg(to_jsonb(t)), ''[]''::jsonb) FROM (SELECT * FROM public.%I %s LIMIT %s OFFSET %s) t',
    _table, order_clause, safe_limit, safe_offset
  ) INTO result;

  RETURN result;
END;
$function$;
