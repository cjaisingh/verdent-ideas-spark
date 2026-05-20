
ALTER TABLE public.postmortems
  ADD COLUMN IF NOT EXISTS archived_at timestamptz,
  ADD COLUMN IF NOT EXISTS archived_by uuid;

CREATE TABLE IF NOT EXISTS public.postmortem_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  postmortem_id uuid NOT NULL REFERENCES public.postmortems(id) ON DELETE CASCADE,
  actor uuid,
  action text NOT NULL,    -- 'created' | 'status_changed' | 'field_edited'
  field text,              -- 'status' | 'root_cause' | 'what_changed' | 'contributing_factors'
  before_value text,
  after_value text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_postmortem_events_pm_created
  ON public.postmortem_events (postmortem_id, created_at DESC);

ALTER TABLE public.postmortem_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Operators read postmortem_events" ON public.postmortem_events;
CREATE POLICY "Operators read postmortem_events"
  ON public.postmortem_events FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(),'operator') OR public.has_role(auth.uid(),'admin'));
-- no INSERT/UPDATE/DELETE policies: written only by trigger (SECURITY DEFINER)

CREATE OR REPLACE FUNCTION public.log_postmortem_event()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE _actor uuid := auth.uid();
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO public.postmortem_events (postmortem_id, actor, action, field, after_value)
    VALUES (NEW.id, _actor, 'created', 'status', NEW.status);
    RETURN NEW;
  END IF;

  IF NEW.status IS DISTINCT FROM OLD.status THEN
    INSERT INTO public.postmortem_events (postmortem_id, actor, action, field, before_value, after_value)
    VALUES (NEW.id, _actor, 'status_changed', 'status', OLD.status, NEW.status);
  END IF;

  IF NEW.root_cause IS DISTINCT FROM OLD.root_cause THEN
    INSERT INTO public.postmortem_events (postmortem_id, actor, action, field, before_value, after_value)
    VALUES (NEW.id, _actor, 'field_edited', 'root_cause', OLD.root_cause, NEW.root_cause);
  END IF;

  IF NEW.what_changed IS DISTINCT FROM OLD.what_changed THEN
    INSERT INTO public.postmortem_events (postmortem_id, actor, action, field, before_value, after_value)
    VALUES (NEW.id, _actor, 'field_edited', 'what_changed', OLD.what_changed, NEW.what_changed);
  END IF;

  IF NEW.contributing_factors::text IS DISTINCT FROM OLD.contributing_factors::text THEN
    INSERT INTO public.postmortem_events (postmortem_id, actor, action, field, before_value, after_value)
    VALUES (NEW.id, _actor, 'field_edited', 'contributing_factors',
            OLD.contributing_factors::text, NEW.contributing_factors::text);
  END IF;

  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_log_postmortem_event ON public.postmortems;
CREATE TRIGGER trg_log_postmortem_event
AFTER INSERT OR UPDATE ON public.postmortems
FOR EACH ROW EXECUTE FUNCTION public.log_postmortem_event();

-- Allow operators to update too (currently only admins can)
DROP POLICY IF EXISTS "Operators update postmortems" ON public.postmortems;
CREATE POLICY "Operators update postmortems"
  ON public.postmortems FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(),'operator') OR public.has_role(auth.uid(),'admin'))
  WITH CHECK (public.has_role(auth.uid(),'operator') OR public.has_role(auth.uid(),'admin'));

ALTER PUBLICATION supabase_realtime ADD TABLE public.postmortem_events;
