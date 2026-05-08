-- Audit/timeline events for jobs (discussion_actions)
CREATE TABLE public.discussion_action_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  action_id uuid REFERENCES public.discussion_actions(id) ON DELETE SET NULL,
  discussion_id uuid,
  event_type text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  actor uuid,
  actor_label text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX discussion_action_events_action_idx ON public.discussion_action_events(action_id, created_at);
CREATE INDEX discussion_action_events_disc_idx ON public.discussion_action_events(discussion_id, created_at);

ALTER TABLE public.discussion_action_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "operators read discussion_action_events"
  ON public.discussion_action_events FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'operator'::app_role));

CREATE POLICY "operators insert discussion_action_events"
  ON public.discussion_action_events FOR INSERT TO authenticated
  WITH CHECK (public.has_role(auth.uid(), 'operator'::app_role));

-- No update/delete policies => locked

ALTER PUBLICATION supabase_realtime ADD TABLE public.discussion_action_events;

-- Trigger: log creation + updates + deletion
CREATE OR REPLACE FUNCTION public.log_discussion_action_event()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  uid uuid := auth.uid();
  label text;
BEGIN
  SELECT email INTO label FROM auth.users WHERE id = uid;
  IF label IS NULL THEN label := 'system'; END IF;

  IF TG_OP = 'INSERT' THEN
    INSERT INTO public.discussion_action_events(action_id, discussion_id, event_type, actor, actor_label, payload)
      VALUES (NEW.id, NEW.discussion_id,
              CASE WHEN NEW.source = 'extracted' THEN 'accepted' ELSE 'created' END,
              uid, label,
              jsonb_build_object(
                'title', NEW.title,
                'priority', NEW.priority,
                'source', NEW.source,
                'owner', NEW.owner,
                'status', NEW.status,
                'extracted_confidence', NEW.extracted_confidence
              ));
    RETURN NEW;

  ELSIF TG_OP = 'UPDATE' THEN
    IF NEW.status IS DISTINCT FROM OLD.status THEN
      INSERT INTO public.discussion_action_events(action_id, discussion_id, event_type, actor, actor_label, payload)
        VALUES (NEW.id, NEW.discussion_id, 'status_changed', uid, label,
                jsonb_build_object('from', OLD.status, 'to', NEW.status));
    END IF;
    IF NEW.owner IS DISTINCT FROM OLD.owner THEN
      INSERT INTO public.discussion_action_events(action_id, discussion_id, event_type, actor, actor_label, payload)
        VALUES (NEW.id, NEW.discussion_id, 'owner_changed', uid, label,
                jsonb_build_object('from', OLD.owner, 'to', NEW.owner));
    END IF;
    IF NEW.due_at IS DISTINCT FROM OLD.due_at THEN
      INSERT INTO public.discussion_action_events(action_id, discussion_id, event_type, actor, actor_label, payload)
        VALUES (NEW.id, NEW.discussion_id, 'due_changed', uid, label,
                jsonb_build_object('from', OLD.due_at, 'to', NEW.due_at));
    END IF;
    IF NEW.priority IS DISTINCT FROM OLD.priority THEN
      INSERT INTO public.discussion_action_events(action_id, discussion_id, event_type, actor, actor_label, payload)
        VALUES (NEW.id, NEW.discussion_id, 'priority_changed', uid, label,
                jsonb_build_object('from', OLD.priority, 'to', NEW.priority));
    END IF;
    IF NEW.title IS DISTINCT FROM OLD.title THEN
      INSERT INTO public.discussion_action_events(action_id, discussion_id, event_type, actor, actor_label, payload)
        VALUES (NEW.id, NEW.discussion_id, 'title_changed', uid, label,
                jsonb_build_object('from', OLD.title, 'to', NEW.title));
    END IF;
    IF NEW.promoted_task_id IS DISTINCT FROM OLD.promoted_task_id AND NEW.promoted_task_id IS NOT NULL THEN
      INSERT INTO public.discussion_action_events(action_id, discussion_id, event_type, actor, actor_label, payload)
        VALUES (NEW.id, NEW.discussion_id, 'promoted', uid, label,
                jsonb_build_object('task_id', NEW.promoted_task_id));
    END IF;
    RETURN NEW;

  ELSIF TG_OP = 'DELETE' THEN
    INSERT INTO public.discussion_action_events(action_id, discussion_id, event_type, actor, actor_label, payload)
      VALUES (NULL, OLD.discussion_id, 'deleted', uid, label,
              jsonb_build_object('short_num', OLD.short_num, 'title', OLD.title));
    RETURN OLD;
  END IF;
  RETURN NULL;
END $$;

CREATE TRIGGER trg_discussion_actions_audit
AFTER INSERT OR UPDATE OR DELETE ON public.discussion_actions
FOR EACH ROW EXECUTE FUNCTION public.log_discussion_action_event();