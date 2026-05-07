
REVOKE ALL ON FUNCTION public.db_list_tables() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.db_list_columns(text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.db_preview_rows(text, int, int) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.db_list_tables() TO authenticated;
GRANT EXECUTE ON FUNCTION public.db_list_columns(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.db_preview_rows(text, int, int) TO authenticated;
