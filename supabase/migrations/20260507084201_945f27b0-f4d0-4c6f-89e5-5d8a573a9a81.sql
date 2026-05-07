REVOKE EXECUTE ON FUNCTION public.db_list_tables() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.db_list_columns(text) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.db_list_all_columns() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.db_preview_rows(text, integer, integer) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.db_analyze_public() FROM PUBLIC, anon, authenticated;