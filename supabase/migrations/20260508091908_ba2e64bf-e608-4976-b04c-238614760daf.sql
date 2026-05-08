
CREATE TABLE IF NOT EXISTS public.app_secrets (
  key text PRIMARY KEY,
  value text NOT NULL,
  description text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL
);

ALTER TABLE public.app_secrets ENABLE ROW LEVEL SECURITY;

CREATE POLICY "admins read app_secrets"
  ON public.app_secrets FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "admins write app_secrets"
  ON public.app_secrets FOR ALL
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE OR REPLACE FUNCTION public.log_app_secret_change()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE label text;
BEGIN
  SELECT email INTO label FROM auth.users WHERE id = auth.uid();
  IF label IS NULL THEN label := 'system'; END IF;
  IF TG_OP = 'INSERT' THEN
    INSERT INTO public.memory_audit_log(scope, entry_key, action, new_value, actor)
      VALUES ('app_secret', NEW.key, 'added',
              jsonb_build_object('value_preview', left(NEW.value, 6) || '…', 'description', NEW.description), label);
    RETURN NEW;
  ELSIF TG_OP = 'UPDATE' THEN
    INSERT INTO public.memory_audit_log(scope, entry_key, action, old_value, new_value, actor)
      VALUES ('app_secret', NEW.key, 'updated',
              jsonb_build_object('value_preview', left(OLD.value, 6) || '…'),
              jsonb_build_object('value_preview', left(NEW.value, 6) || '…', 'description', NEW.description), label);
    RETURN NEW;
  ELSIF TG_OP = 'DELETE' THEN
    INSERT INTO public.memory_audit_log(scope, entry_key, action, old_value, actor)
      VALUES ('app_secret', OLD.key, 'removed',
              jsonb_build_object('value_preview', left(OLD.value, 6) || '…'), label);
    RETURN OLD;
  END IF;
  RETURN NULL;
END $$;

DROP TRIGGER IF EXISTS app_secrets_audit ON public.app_secrets;
CREATE TRIGGER app_secrets_audit
  AFTER INSERT OR UPDATE OR DELETE ON public.app_secrets
  FOR EACH ROW EXECUTE FUNCTION public.log_app_secret_change();
