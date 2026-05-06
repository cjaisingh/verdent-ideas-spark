
CREATE TABLE public.memory_audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  scope text NOT NULL, -- 'retention_settings' | 'autolog_settings' | 'agent_memory'
  entry_key text NOT NULL, -- table name, setting field, or mem:// path
  action text NOT NULL CHECK (action IN ('added','updated','removed')),
  old_value jsonb,
  new_value jsonb,
  actor text,
  note text
);

CREATE INDEX idx_memory_audit_log_created_at ON public.memory_audit_log(created_at DESC);
CREATE INDEX idx_memory_audit_log_scope ON public.memory_audit_log(scope);

ALTER TABLE public.memory_audit_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "operators read memory_audit_log"
  ON public.memory_audit_log FOR SELECT TO authenticated
  USING (has_role(auth.uid(), 'operator'::app_role));

CREATE POLICY "operators insert memory_audit_log"
  ON public.memory_audit_log FOR INSERT TO authenticated
  WITH CHECK (has_role(auth.uid(), 'operator'::app_role));

-- Add to retention_settings management as well
INSERT INTO public.retention_settings (table_name, retention_days, description)
  VALUES ('memory_audit_log', 0, 'Audit trail of memory/settings changes')
  ON CONFLICT (table_name) DO NOTHING;

-- Trigger function: log retention_settings changes
CREATE OR REPLACE FUNCTION public.log_retention_settings_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  uid uuid := auth.uid();
  label text;
BEGIN
  SELECT email INTO label FROM auth.users WHERE id = uid;
  IF label IS NULL THEN label := 'system'; END IF;

  IF TG_OP = 'INSERT' THEN
    INSERT INTO public.memory_audit_log(scope, entry_key, action, new_value, actor)
      VALUES ('retention_settings', NEW.table_name, 'added',
              jsonb_build_object('retention_days', NEW.retention_days, 'description', NEW.description), label);
    RETURN NEW;
  ELSIF TG_OP = 'UPDATE' THEN
    IF NEW.retention_days IS DISTINCT FROM OLD.retention_days
       OR NEW.description IS DISTINCT FROM OLD.description THEN
      INSERT INTO public.memory_audit_log(scope, entry_key, action, old_value, new_value, actor)
        VALUES ('retention_settings', NEW.table_name, 'updated',
                jsonb_build_object('retention_days', OLD.retention_days, 'description', OLD.description),
                jsonb_build_object('retention_days', NEW.retention_days, 'description', NEW.description),
                label);
    END IF;
    RETURN NEW;
  ELSIF TG_OP = 'DELETE' THEN
    INSERT INTO public.memory_audit_log(scope, entry_key, action, old_value, actor)
      VALUES ('retention_settings', OLD.table_name, 'removed',
              jsonb_build_object('retention_days', OLD.retention_days, 'description', OLD.description), label);
    RETURN OLD;
  END IF;
  RETURN NULL;
END;
$$;

CREATE TRIGGER trg_log_retention_settings
  AFTER INSERT OR UPDATE OR DELETE ON public.retention_settings
  FOR EACH ROW EXECUTE FUNCTION public.log_retention_settings_change();

-- Trigger function: log autolog_settings changes (single-row table)
CREATE OR REPLACE FUNCTION public.log_autolog_settings_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  uid uuid := auth.uid();
  label text;
  field text;
  fields text[] := ARRAY['enabled','capture_prompt','capture_response','capture_response_meta',
                         'capture_request_meta','capture_duration','capture_model','capture_tokens',
                         'extract_issues_fixes','source_awip_api','source_ai_gateway','source_lovable_agent'];
  old_j jsonb := to_jsonb(OLD);
  new_j jsonb := to_jsonb(NEW);
BEGIN
  SELECT email INTO label FROM auth.users WHERE id = uid;
  IF label IS NULL THEN label := 'system'; END IF;

  FOREACH field IN ARRAY fields LOOP
    IF (old_j->field) IS DISTINCT FROM (new_j->field) THEN
      INSERT INTO public.memory_audit_log(scope, entry_key, action, old_value, new_value, actor)
        VALUES ('autolog_settings', field, 'updated',
                jsonb_build_object(field, old_j->field),
                jsonb_build_object(field, new_j->field),
                label);
    END IF;
  END LOOP;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_log_autolog_settings
  AFTER UPDATE ON public.roadmap_autolog_settings
  FOR EACH ROW EXECUTE FUNCTION public.log_autolog_settings_change();

ALTER PUBLICATION supabase_realtime ADD TABLE public.memory_audit_log;
