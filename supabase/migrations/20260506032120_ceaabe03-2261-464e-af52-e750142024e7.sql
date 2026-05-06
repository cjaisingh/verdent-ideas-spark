
REVOKE ALL ON FUNCTION public.grant_user_role(uuid, app_role) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.revoke_user_role(uuid, app_role) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.list_users_with_roles() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.grant_user_role(uuid, app_role) TO authenticated;
GRANT EXECUTE ON FUNCTION public.revoke_user_role(uuid, app_role) TO authenticated;
GRANT EXECUTE ON FUNCTION public.list_users_with_roles() TO authenticated;
