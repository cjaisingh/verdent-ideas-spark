
-- copilot_agent_overrides: require operator or admin role in addition to ownership
DROP POLICY IF EXISTS "users delete own overrides" ON public.copilot_agent_overrides;
DROP POLICY IF EXISTS "users insert own overrides" ON public.copilot_agent_overrides;
DROP POLICY IF EXISTS "users read own overrides"   ON public.copilot_agent_overrides;
DROP POLICY IF EXISTS "users update own overrides" ON public.copilot_agent_overrides;

CREATE POLICY "operators read own overrides" ON public.copilot_agent_overrides
  FOR SELECT TO authenticated
  USING (auth.uid() = user_id
         AND (public.has_role(auth.uid(), 'operator'::app_role)
              OR public.has_role(auth.uid(), 'admin'::app_role)));

CREATE POLICY "operators insert own overrides" ON public.copilot_agent_overrides
  FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id
              AND (public.has_role(auth.uid(), 'operator'::app_role)
                   OR public.has_role(auth.uid(), 'admin'::app_role)));

CREATE POLICY "operators update own overrides" ON public.copilot_agent_overrides
  FOR UPDATE TO authenticated
  USING (auth.uid() = user_id
         AND (public.has_role(auth.uid(), 'operator'::app_role)
              OR public.has_role(auth.uid(), 'admin'::app_role)))
  WITH CHECK (auth.uid() = user_id
              AND (public.has_role(auth.uid(), 'operator'::app_role)
                   OR public.has_role(auth.uid(), 'admin'::app_role)));

CREATE POLICY "operators delete own overrides" ON public.copilot_agent_overrides
  FOR DELETE TO authenticated
  USING (auth.uid() = user_id
         AND (public.has_role(auth.uid(), 'operator'::app_role)
              OR public.has_role(auth.uid(), 'admin'::app_role)));

-- operator_dashboards: same pattern
DROP POLICY IF EXISTS "own row insert" ON public.operator_dashboards;
DROP POLICY IF EXISTS "own row select" ON public.operator_dashboards;
DROP POLICY IF EXISTS "own row update" ON public.operator_dashboards;

CREATE POLICY "operators select own dashboards" ON public.operator_dashboards
  FOR SELECT TO authenticated
  USING (auth.uid() = user_id
         AND (public.has_role(auth.uid(), 'operator'::app_role)
              OR public.has_role(auth.uid(), 'admin'::app_role)));

CREATE POLICY "operators insert own dashboards" ON public.operator_dashboards
  FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id
              AND (public.has_role(auth.uid(), 'operator'::app_role)
                   OR public.has_role(auth.uid(), 'admin'::app_role)));

CREATE POLICY "operators update own dashboards" ON public.operator_dashboards
  FOR UPDATE TO authenticated
  USING (auth.uid() = user_id
         AND (public.has_role(auth.uid(), 'operator'::app_role)
              OR public.has_role(auth.uid(), 'admin'::app_role)))
  WITH CHECK (auth.uid() = user_id
              AND (public.has_role(auth.uid(), 'operator'::app_role)
                   OR public.has_role(auth.uid(), 'admin'::app_role)));
