
-- 1) short_links: restrict to operators/admins
DROP POLICY IF EXISTS "short_links readable to authenticated" ON public.short_links;
DROP POLICY IF EXISTS "short_links insert by authenticated" ON public.short_links;

CREATE POLICY "short_links readable to operators"
  ON public.short_links FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'operator'::public.app_role)
      OR public.has_role(auth.uid(), 'admin'::public.app_role));

CREATE POLICY "short_links insert by operators"
  ON public.short_links FOR INSERT
  TO authenticated
  WITH CHECK (public.has_role(auth.uid(), 'operator'::public.app_role)
           OR public.has_role(auth.uid(), 'admin'::public.app_role));

-- 2) Pin search_path on user-defined functions
ALTER FUNCTION public.touch_updated_at() SET search_path = public;
ALTER FUNCTION public.tg_tenant_nodes_set_ancestry() SET search_path = public;
