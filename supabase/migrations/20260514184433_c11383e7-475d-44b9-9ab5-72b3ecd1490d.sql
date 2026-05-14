REVOKE EXECUTE ON FUNCTION public.auto_link_finding_to_action(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.auto_link_finding_to_action(uuid) TO authenticated, service_role;