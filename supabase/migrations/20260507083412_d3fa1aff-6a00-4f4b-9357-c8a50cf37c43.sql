-- Lock down DB Explorer RPCs: only callable by service_role (edge function),
-- not by authenticated users via PostgREST. The edge function verifies operator
-- role server-side before invoking these.
REVOKE ALL ON FUNCTION public.db_list_tables() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.db_list_columns(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.db_preview_rows(text, integer, integer) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.db_list_tables() TO service_role;
GRANT EXECUTE ON FUNCTION public.db_list_columns(text) TO service_role;
GRANT EXECUTE ON FUNCTION public.db_preview_rows(text, integer, integer) TO service_role;