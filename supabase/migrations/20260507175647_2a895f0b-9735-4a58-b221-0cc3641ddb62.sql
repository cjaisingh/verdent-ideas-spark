
CREATE TABLE public.copilot_lessons (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lesson text NOT NULL,
  scope text NOT NULL DEFAULT 'global',
  source text NOT NULL DEFAULT 'voice',
  active boolean NOT NULL DEFAULT true,
  created_by text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE OR REPLACE FUNCTION public.validate_copilot_lesson()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NEW.lesson IS NULL OR length(trim(NEW.lesson)) = 0 THEN
    RAISE EXCEPTION 'lesson cannot be empty';
  END IF;
  IF length(NEW.lesson) > 500 THEN
    RAISE EXCEPTION 'lesson must be 500 characters or fewer';
  END IF;
  IF NEW.scope NOT IN ('global','notebook','approvals','voice_style') THEN
    RAISE EXCEPTION 'invalid scope %', NEW.scope;
  END IF;
  IF NEW.source NOT IN ('voice','manual') THEN
    RAISE EXCEPTION 'invalid source %', NEW.source;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER copilot_lessons_validate
BEFORE INSERT OR UPDATE ON public.copilot_lessons
FOR EACH ROW EXECUTE FUNCTION public.validate_copilot_lesson();

CREATE TRIGGER copilot_lessons_updated_at
BEFORE UPDATE ON public.copilot_lessons
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE INDEX idx_copilot_lessons_active ON public.copilot_lessons(active, created_at DESC);

ALTER TABLE public.copilot_lessons ENABLE ROW LEVEL SECURITY;

CREATE POLICY "operators read copilot_lessons" ON public.copilot_lessons
  FOR SELECT TO authenticated
  USING (has_role(auth.uid(),'operator'::app_role) OR has_role(auth.uid(),'admin'::app_role));
CREATE POLICY "operators insert copilot_lessons" ON public.copilot_lessons
  FOR INSERT TO authenticated
  WITH CHECK (has_role(auth.uid(),'operator'::app_role) OR has_role(auth.uid(),'admin'::app_role));
CREATE POLICY "operators update copilot_lessons" ON public.copilot_lessons
  FOR UPDATE TO authenticated
  USING (has_role(auth.uid(),'operator'::app_role) OR has_role(auth.uid(),'admin'::app_role))
  WITH CHECK (has_role(auth.uid(),'operator'::app_role) OR has_role(auth.uid(),'admin'::app_role));
CREATE POLICY "operators delete copilot_lessons" ON public.copilot_lessons
  FOR DELETE TO authenticated
  USING (has_role(auth.uid(),'operator'::app_role) OR has_role(auth.uid(),'admin'::app_role));

ALTER PUBLICATION supabase_realtime ADD TABLE public.copilot_lessons;
ALTER TABLE public.copilot_lessons REPLICA IDENTITY FULL;

ALTER TABLE public.copilot_settings
  ADD COLUMN IF NOT EXISTS model text NOT NULL DEFAULT 'openai/gpt-5-mini';
