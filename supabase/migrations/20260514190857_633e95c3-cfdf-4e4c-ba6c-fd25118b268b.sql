-- Phase 2 cleanup: silence Supabase linter warnings.

-- 1. Fix mutable search_path on infer_task_entity (pure IMMUTABLE function).
ALTER FUNCTION public.infer_task_entity(text, text) SET search_path = public;

-- 2. Tighten "anyone may submit frontend errors" — keep anon access but add basic guards.
DROP POLICY IF EXISTS "anyone may submit frontend errors" ON public.frontend_error_logs;
CREATE POLICY "anyone may submit frontend errors"
  ON public.frontend_error_logs
  FOR INSERT
  WITH CHECK (
    coalesce(length(message), 0) between 1 and 8000
    AND coalesce(length(stack), 0) <= 16000
    AND coalesce(length(url), 0) <= 2000
  );

-- 3. Revoke anon EXECUTE on every SECURITY DEFINER function in public.
--    These functions all gate internally via has_role() / auth.uid(); anon should
--    never be able to even attempt to call them.
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT n.nspname, p.proname,
           pg_get_function_identity_arguments(p.oid) AS args
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.prosecdef = true
  LOOP
    EXECUTE format('REVOKE EXECUTE ON FUNCTION public.%I(%s) FROM anon, public',
                   r.proname, r.args);
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.%I(%s) TO authenticated, service_role',
                   r.proname, r.args);
  END LOOP;
END $$;

-- 4. Document the surviving "authenticated can execute SECURITY DEFINER" warnings.
--    These are intentional: every such function performs an internal has_role() check.
COMMENT ON SCHEMA public IS
  'AWIP Core public schema. All SECURITY DEFINER functions gate internally via has_role(); authenticated EXECUTE is by design.';