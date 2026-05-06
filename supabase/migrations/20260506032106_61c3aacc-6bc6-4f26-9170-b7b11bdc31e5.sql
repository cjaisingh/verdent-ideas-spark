
-- Audit log for user_roles changes
CREATE TABLE public.role_change_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  actor_user_id uuid NOT NULL,
  target_user_id uuid NOT NULL,
  role app_role NOT NULL,
  action text NOT NULL CHECK (action IN ('granted','revoked'))
);

ALTER TABLE public.role_change_audit ENABLE ROW LEVEL SECURITY;

CREATE POLICY "admins read role_change_audit"
  ON public.role_change_audit FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "no client write role_change_audit"
  ON public.role_change_audit FOR ALL TO authenticated
  USING (false) WITH CHECK (false);

-- Admin-only RPCs that mutate user_roles + write audit
CREATE OR REPLACE FUNCTION public.grant_user_role(_target uuid, _role app_role)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'not authorized';
  END IF;
  INSERT INTO public.user_roles (user_id, role)
    VALUES (_target, _role)
    ON CONFLICT (user_id, role) DO NOTHING;
  INSERT INTO public.role_change_audit (actor_user_id, target_user_id, role, action)
    VALUES (auth.uid(), _target, _role, 'granted');
END;
$$;

CREATE OR REPLACE FUNCTION public.revoke_user_role(_target uuid, _role app_role)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'not authorized';
  END IF;
  -- Prevent admin removing their own last admin role (lockout protection)
  IF _role = 'admin' AND _target = auth.uid() THEN
    IF (SELECT count(*) FROM public.user_roles WHERE role = 'admin') <= 1 THEN
      RAISE EXCEPTION 'cannot remove the last admin';
    END IF;
  END IF;
  DELETE FROM public.user_roles WHERE user_id = _target AND role = _role;
  INSERT INTO public.role_change_audit (actor_user_id, target_user_id, role, action)
    VALUES (auth.uid(), _target, _role, 'revoked');
END;
$$;

-- Admin-only listing of users with their roles + email (auth.users isn't directly readable from client)
CREATE OR REPLACE FUNCTION public.list_users_with_roles()
RETURNS TABLE (user_id uuid, email text, created_at timestamptz, roles app_role[])
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'not authorized';
  END IF;
  RETURN QUERY
    SELECT u.id, u.email::text, u.created_at,
           COALESCE(array_agg(r.role) FILTER (WHERE r.role IS NOT NULL), '{}')::app_role[]
    FROM auth.users u
    LEFT JOIN public.user_roles r ON r.user_id = u.id
    GROUP BY u.id, u.email, u.created_at
    ORDER BY u.created_at DESC;
END;
$$;
