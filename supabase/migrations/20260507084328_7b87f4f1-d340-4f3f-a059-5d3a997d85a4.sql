CREATE OR REPLACE FUNCTION public.db_list_tables()
 RETURNS TABLE(table_name text, row_count bigint, size_bytes bigint)
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE r record; cnt bigint;
BEGIN
  FOR r IN
    SELECT c.relname, c.oid, pg_total_relation_size(c.oid) AS sz
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind = 'r' ORDER BY c.relname
  LOOP
    EXECUTE format('SELECT count(*) FROM public.%I', r.relname) INTO cnt;
    table_name := r.relname; row_count := cnt; size_bytes := r.sz;
    RETURN NEXT;
  END LOOP;
END;
$$;

CREATE OR REPLACE FUNCTION public.db_list_columns(_table text)
 RETURNS TABLE(column_name text, data_type text, is_nullable text, column_default text)
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
BEGIN
  RETURN QUERY
  SELECT c.column_name::text, c.data_type::text, c.is_nullable::text, c.column_default::text
  FROM information_schema.columns c
  WHERE c.table_schema = 'public' AND c.table_name = _table
  ORDER BY c.ordinal_position;
END;
$$;

CREATE OR REPLACE FUNCTION public.db_list_all_columns()
 RETURNS TABLE(table_name text, column_name text, data_type text)
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
BEGIN
  RETURN QUERY
  SELECT c.table_name::text, c.column_name::text, c.data_type::text
  FROM information_schema.columns c
  WHERE c.table_schema = 'public'
  ORDER BY c.table_name, c.ordinal_position;
END;
$$;

CREATE OR REPLACE FUNCTION public.db_analyze_public()
 RETURNS void
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind = 'r'
  LOOP
    EXECUTE format('ANALYZE public.%I', r.relname);
  END LOOP;
END;
$$;

CREATE OR REPLACE FUNCTION public.db_preview_rows(_table text, _limit integer DEFAULT 50, _offset integer DEFAULT 0)
 RETURNS jsonb
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE
  result jsonb;
  safe_limit int := LEAST(GREATEST(COALESCE(_limit, 50), 1), 200);
  safe_offset int := GREATEST(COALESCE(_offset, 0), 0);
  has_created boolean;
  order_clause text;
BEGIN
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
$$;

REVOKE EXECUTE ON FUNCTION public.db_list_tables() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.db_list_columns(text) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.db_list_all_columns() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.db_preview_rows(text, integer, integer) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.db_analyze_public() FROM PUBLIC, anon, authenticated;