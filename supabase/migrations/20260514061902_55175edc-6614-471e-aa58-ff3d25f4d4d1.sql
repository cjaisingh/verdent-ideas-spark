-- Slice 4: default-deny allowlists
CREATE TABLE IF NOT EXISTS public.platform_allowlist (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  platform text NOT NULL CHECK (platform IN ('telegram','rork','companion_web')),
  principal text NOT NULL,
  note text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (platform, principal)
);

ALTER TABLE public.platform_allowlist ENABLE ROW LEVEL SECURITY;

CREATE POLICY "operators read allowlist"
  ON public.platform_allowlist FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(),'operator') OR public.has_role(auth.uid(),'admin'));

CREATE POLICY "operators insert allowlist"
  ON public.platform_allowlist FOR INSERT TO authenticated
  WITH CHECK (public.has_role(auth.uid(),'operator') OR public.has_role(auth.uid(),'admin'));

CREATE POLICY "operators delete allowlist"
  ON public.platform_allowlist FOR DELETE TO authenticated
  USING (public.has_role(auth.uid(),'operator') OR public.has_role(auth.uid(),'admin'));

CREATE TABLE IF NOT EXISTS public.platform_allowlist_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  allowlist_id uuid,
  platform text NOT NULL,
  principal text NOT NULL,
  action text NOT NULL CHECK (action IN ('granted','revoked')),
  actor uuid,
  actor_label text,
  note text,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.platform_allowlist_audit ENABLE ROW LEVEL SECURITY;

CREATE POLICY "operators read allowlist audit"
  ON public.platform_allowlist_audit FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(),'operator') OR public.has_role(auth.uid(),'admin'));

CREATE OR REPLACE FUNCTION public.log_platform_allowlist_event()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE uid uuid := auth.uid(); label text;
BEGIN
  SELECT email INTO label FROM auth.users WHERE id = uid;
  IF label IS NULL THEN label := 'system'; END IF;
  IF TG_OP = 'INSERT' THEN
    INSERT INTO public.platform_allowlist_audit(allowlist_id, platform, principal, action, actor, actor_label, note)
      VALUES (NEW.id, NEW.platform, NEW.principal, 'granted', uid, label, NEW.note);
    RETURN NEW;
  ELSIF TG_OP = 'DELETE' THEN
    INSERT INTO public.platform_allowlist_audit(allowlist_id, platform, principal, action, actor, actor_label, note)
      VALUES (OLD.id, OLD.platform, OLD.principal, 'revoked', uid, label, OLD.note);
    RETURN OLD;
  END IF;
  RETURN NULL;
END $$;

DROP TRIGGER IF EXISTS trg_platform_allowlist_audit ON public.platform_allowlist;
CREATE TRIGGER trg_platform_allowlist_audit
  AFTER INSERT OR DELETE ON public.platform_allowlist
  FOR EACH ROW EXECUTE FUNCTION public.log_platform_allowlist_event();

CREATE OR REPLACE FUNCTION public.is_principal_allowed(_platform text, _principal text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.platform_allowlist
    WHERE platform = _platform AND principal = _principal
  );
$$;

GRANT EXECUTE ON FUNCTION public.is_principal_allowed(text, text) TO authenticated, service_role, anon;

ALTER PUBLICATION supabase_realtime ADD TABLE public.platform_allowlist;