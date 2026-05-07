
-- 1. Move pg_net out of public (drop + recreate; SET SCHEMA unsupported)
CREATE SCHEMA IF NOT EXISTS extensions;
DROP EXTENSION IF EXISTS pg_net;
CREATE EXTENSION pg_net WITH SCHEMA extensions;

-- 2. Lock down SECURITY DEFINER functions
DO $$
DECLARE
  fn text;
  fns text[] := ARRAY[
    'public.revoke_user_role(uuid, app_role)',
    'public.bootstrap_first_operator()',
    'public.has_role(uuid, app_role)',
    'public.purge_expired_rows(text)',
    'public.list_users_with_roles()',
    'public.grant_user_role(uuid, app_role)',
    'public.log_roadmap_task_activity()',
    'public.purge_all_rows(text)',
    'public.log_autolog_settings_change()',
    'public.log_retention_settings_change()',
    'public.retention_stats()',
    'public.auto_purge_if_enabled()'
  ];
BEGIN
  FOREACH fn IN ARRAY fns LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', fn);
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM anon', fn);
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM authenticated', fn);
  END LOOP;
END $$;

-- 3. has_role must be callable by authenticated (used in RLS policies)
GRANT EXECUTE ON FUNCTION public.has_role(uuid, app_role) TO authenticated;

-- 4. Admin RPCs: need authenticated execute (each self-checks role)
GRANT EXECUTE ON FUNCTION public.grant_user_role(uuid, app_role) TO authenticated;
GRANT EXECUTE ON FUNCTION public.revoke_user_role(uuid, app_role) TO authenticated;
GRANT EXECUTE ON FUNCTION public.list_users_with_roles() TO authenticated;
GRANT EXECUTE ON FUNCTION public.purge_expired_rows(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.purge_all_rows(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.retention_stats() TO authenticated;
