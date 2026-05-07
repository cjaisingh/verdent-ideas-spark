CREATE OR REPLACE FUNCTION public.db_list_tables()
 RETURNS TABLE(table_name text, row_count bigint, size_bytes bigint)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  r record;
  cnt bigint;
BEGIN
  IF NOT public.has_role(auth.uid(), 'operator') THEN
    RAISE EXCEPTION 'not authorized';
  END IF;
  FOR r IN
    SELECT c.relname, c.oid, pg_total_relation_size(c.oid) AS sz
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind = 'r'
    ORDER BY c.relname
  LOOP
    EXECUTE format('SELECT count(*) FROM public.%I', r.relname) INTO cnt;
    table_name := r.relname;
    row_count := cnt;
    size_bytes := r.sz;
    RETURN NEXT;
  END LOOP;
END;
$function$;