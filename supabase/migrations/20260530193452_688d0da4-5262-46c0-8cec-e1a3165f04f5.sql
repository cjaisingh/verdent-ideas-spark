-- 1. Table
CREATE TABLE public.tenant_branding (
  tenant_id UUID PRIMARY KEY REFERENCES public.tenants(id) ON DELETE CASCADE,
  display_name TEXT,
  primary_hex TEXT NOT NULL DEFAULT '#0F172A',
  accent_hex TEXT,
  primary_foreground_hex TEXT NOT NULL DEFAULT '#FFFFFF',
  accent_foreground_hex TEXT,
  logo_light_path TEXT,
  logo_dark_path TEXT,
  favicon_path TEXT,
  og_image_path TEXT,
  spec_version TEXT NOT NULL DEFAULT '1.0.0',
  accessibility_override_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT tenant_branding_primary_hex_format CHECK (primary_hex ~* '^#[0-9a-f]{6}$'),
  CONSTRAINT tenant_branding_accent_hex_format CHECK (accent_hex IS NULL OR accent_hex ~* '^#[0-9a-f]{6}$'),
  CONSTRAINT tenant_branding_primary_fg_format CHECK (primary_foreground_hex ~* '^#[0-9a-f]{6}$'),
  CONSTRAINT tenant_branding_accent_fg_format CHECK (accent_foreground_hex IS NULL OR accent_foreground_hex ~* '^#[0-9a-f]{6}$')
);

-- 2. Grants
GRANT SELECT, INSERT, UPDATE, DELETE ON public.tenant_branding TO authenticated;
GRANT ALL ON public.tenant_branding TO service_role;

-- 3. RLS
ALTER TABLE public.tenant_branding ENABLE ROW LEVEL SECURITY;

-- 4. Policies — operator reads everything; admins write
CREATE POLICY "operators read tenant_branding"
  ON public.tenant_branding FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'operator') OR public.has_role(auth.uid(), 'admin'));

CREATE POLICY "admins insert tenant_branding"
  ON public.tenant_branding FOR INSERT
  TO authenticated
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "admins update tenant_branding"
  ON public.tenant_branding FOR UPDATE
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "admins delete tenant_branding"
  ON public.tenant_branding FOR DELETE
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

-- 5. updated_at trigger
CREATE TRIGGER tenant_branding_set_updated_at
  BEFORE UPDATE ON public.tenant_branding
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- 6. capability_events emission trigger
CREATE OR REPLACE FUNCTION public.tenant_branding_emit_event()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_kind TEXT;
  v_tenant UUID;
BEGIN
  IF TG_OP = 'DELETE' THEN
    v_kind := 'tenant_branding_deleted';
    v_tenant := OLD.tenant_id;
  ELSIF TG_OP = 'INSERT' THEN
    v_kind := 'tenant_branding_created';
    v_tenant := NEW.tenant_id;
  ELSE
    v_kind := 'tenant_branding_updated';
    v_tenant := NEW.tenant_id;
  END IF;

  INSERT INTO public.capability_events (capability_id, kind, payload, actor)
  VALUES (
    NULL,
    v_kind,
    jsonb_build_object(
      'tenant_id', v_tenant,
      'spec_version', COALESCE(NEW.spec_version, OLD.spec_version),
      'primary_hex', COALESCE(NEW.primary_hex, OLD.primary_hex)
    ),
    COALESCE(auth.uid()::text, 'system')
  );

  RETURN COALESCE(NEW, OLD);
END;
$$;

CREATE TRIGGER tenant_branding_emit_capability_event
  AFTER INSERT OR UPDATE OR DELETE ON public.tenant_branding
  FOR EACH ROW
  EXECUTE FUNCTION public.tenant_branding_emit_event();

-- 7. Realtime
ALTER TABLE public.tenant_branding REPLICA IDENTITY FULL;
ALTER PUBLICATION supabase_realtime ADD TABLE public.tenant_branding;

-- 8. Storage bucket (public read for logos/favicons/OG)
INSERT INTO storage.buckets (id, name, public)
VALUES ('tenant-branding', 'tenant-branding', true)
ON CONFLICT (id) DO NOTHING;

-- 9. Storage policies: public read; admin write scoped by tenant_id prefix
CREATE POLICY "Tenant branding assets are publicly readable"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'tenant-branding');

CREATE POLICY "Admins upload tenant branding assets"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'tenant-branding'
    AND public.has_role(auth.uid(), 'admin')
  );

CREATE POLICY "Admins update tenant branding assets"
  ON storage.objects FOR UPDATE
  TO authenticated
  USING (
    bucket_id = 'tenant-branding'
    AND public.has_role(auth.uid(), 'admin')
  );

CREATE POLICY "Admins delete tenant branding assets"
  ON storage.objects FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'tenant-branding'
    AND public.has_role(auth.uid(), 'admin')
  );