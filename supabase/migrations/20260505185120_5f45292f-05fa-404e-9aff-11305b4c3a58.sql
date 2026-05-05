
REVOKE EXECUTE ON FUNCTION public.has_role(UUID, public.app_role) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.bootstrap_first_operator() FROM PUBLIC, anon, authenticated;

-- idempotency_keys: only service role (edge functions) accesses; deny all from clients
CREATE POLICY "no client access to idempotency" ON public.idempotency_keys FOR ALL TO authenticated USING (false) WITH CHECK (false);
