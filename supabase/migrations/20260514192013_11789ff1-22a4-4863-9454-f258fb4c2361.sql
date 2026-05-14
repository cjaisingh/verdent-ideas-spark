
CREATE OR REPLACE FUNCTION public.audit_security_definer_gating()
RETURNS TABLE(proname text, is_trigger boolean, has_authz_check boolean)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT (public.has_role(auth.uid(), 'operator'::app_role)
       OR public.has_role(auth.uid(), 'admin'::app_role)) THEN
    RAISE EXCEPTION 'not authorized';
  END IF;
  RETURN QUERY
  SELECT p.proname::text,
         (p.prorettype = 'trigger'::regtype) AS is_trigger,
         (p.prosrc ~* '(has_role\s*\(|raise\s+exception\s+''not\s+authorized|auth\.uid\s*\(\s*\)\s+is\s+null)') AS has_authz_check
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.prosecdef = true
  ORDER BY p.proname;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.audit_security_definer_gating() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.audit_security_definer_gating() TO authenticated, service_role;
