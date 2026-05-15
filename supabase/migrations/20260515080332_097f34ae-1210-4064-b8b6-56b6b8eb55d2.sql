CREATE TABLE IF NOT EXISTS public.qa_check_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  qa_check_id uuid NOT NULL REFERENCES public.qa_checks(id) ON DELETE CASCADE,
  phase_key text NOT NULL,
  criterion text NOT NULL,
  kind text NOT NULL,
  event_type text NOT NULL,
  old_status text,
  new_status text,
  note text,
  actor uuid,
  actor_label text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS qa_check_events_phase_idx ON public.qa_check_events(phase_key, created_at DESC);
CREATE INDEX IF NOT EXISTS qa_check_events_check_idx ON public.qa_check_events(qa_check_id, created_at DESC);

ALTER TABLE public.qa_check_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "qa_check_events_select_operator" ON public.qa_check_events
  FOR SELECT USING (public.has_role(auth.uid(),'operator') OR public.has_role(auth.uid(),'admin'));

ALTER PUBLICATION supabase_realtime ADD TABLE public.qa_check_events;

CREATE OR REPLACE FUNCTION public.log_qa_check_event()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE uid uuid := auth.uid(); label text; ev text;
BEGIN
  SELECT email INTO label FROM auth.users WHERE id = uid;
  IF label IS NULL THEN label := 'system'; END IF;

  IF TG_OP = 'INSERT' THEN
    INSERT INTO public.qa_check_events(qa_check_id, phase_key, criterion, kind, event_type,
                                       old_status, new_status, note, actor, actor_label)
      VALUES (NEW.id, NEW.phase_key, NEW.criterion, NEW.kind, 'created',
              NULL, NEW.status, NEW.note, uid, label);
    RETURN NEW;
  END IF;

  IF NEW.status IS DISTINCT FROM OLD.status THEN
    ev := 'status_changed';
  ELSIF NEW.note IS DISTINCT FROM OLD.note THEN
    ev := 'note_updated';
  ELSIF NEW.last_checked_at IS DISTINCT FROM OLD.last_checked_at THEN
    ev := 'rechecked';
  ELSE
    RETURN NEW;
  END IF;

  INSERT INTO public.qa_check_events(qa_check_id, phase_key, criterion, kind, event_type,
                                     old_status, new_status, note, actor, actor_label)
    VALUES (NEW.id, NEW.phase_key, NEW.criterion, NEW.kind, ev,
            OLD.status, NEW.status, NEW.note, uid, label);
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_log_qa_check_event ON public.qa_checks;
CREATE TRIGGER trg_log_qa_check_event
  AFTER INSERT OR UPDATE ON public.qa_checks
  FOR EACH ROW EXECUTE FUNCTION public.log_qa_check_event();

-- Seed: one synthetic "snapshot" event per existing qa_check row so the page isn't empty
INSERT INTO public.qa_check_events(qa_check_id, phase_key, criterion, kind, event_type,
                                   old_status, new_status, note, actor, actor_label, created_at)
SELECT q.id, q.phase_key, q.criterion, q.kind, 'snapshot',
       NULL, q.status, q.note, q.last_actor, coalesce(q.last_actor_label,'system'),
       coalesce(q.updated_at, q.last_checked_at, now())
FROM public.qa_checks q
WHERE NOT EXISTS (SELECT 1 FROM public.qa_check_events e WHERE e.qa_check_id = q.id);