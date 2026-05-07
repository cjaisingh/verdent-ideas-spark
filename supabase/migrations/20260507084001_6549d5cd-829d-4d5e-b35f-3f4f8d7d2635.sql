-- Refresh row-count stats (reltuples) for all public tables.
CREATE OR REPLACE FUNCTION public.db_analyze_public()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE r record;
BEGIN
  IF NOT public.has_role(auth.uid(), 'operator') THEN
    RAISE EXCEPTION 'not authorized';
  END IF;
  FOR r IN
    SELECT c.relname FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind = 'r'
  LOOP
    EXECUTE format('ANALYZE public.%I', r.relname);
  END LOOP;
END;
$$;

-- Return every (table, column) pair in public, for the contains-column filter.
CREATE OR REPLACE FUNCTION public.db_list_all_columns()
RETURNS TABLE(table_name text, column_name text, data_type text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), 'operator') THEN
    RAISE EXCEPTION 'not authorized';
  END IF;
  RETURN QUERY
  SELECT c.table_name::text, c.column_name::text, c.data_type::text
  FROM information_schema.columns c
  WHERE c.table_schema = 'public'
  ORDER BY c.table_name, c.ordinal_position;
END;
$$;

-- Lock down: only service_role (edge fn) may call.
REVOKE ALL ON FUNCTION public.db_analyze_public() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.db_list_all_columns() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.db_analyze_public() TO service_role;
GRANT EXECUTE ON FUNCTION public.db_list_all_columns() TO service_role;