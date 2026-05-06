CREATE TABLE public.roadmap_task_activity (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id uuid NOT NULL REFERENCES public.roadmap_tasks(id) ON DELETE CASCADE,
  field text NOT NULL,
  old_value text,
  new_value text,
  author uuid,
  author_label text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_roadmap_task_activity_task ON public.roadmap_task_activity(task_id, created_at DESC);

ALTER TABLE public.roadmap_task_activity ENABLE ROW LEVEL SECURITY;

CREATE POLICY "operators read task activity" ON public.roadmap_task_activity
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'operator'));

CREATE POLICY "no client write task activity" ON public.roadmap_task_activity
  FOR ALL TO authenticated
  USING (false) WITH CHECK (false);

ALTER PUBLICATION supabase_realtime ADD TABLE public.roadmap_task_activity;

CREATE OR REPLACE FUNCTION public.log_roadmap_task_activity()
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

  IF NEW.status IS DISTINCT FROM OLD.status THEN
    INSERT INTO public.roadmap_task_activity(task_id, field, old_value, new_value, author, author_label)
      VALUES (NEW.id, 'status', OLD.status::text, NEW.status::text, uid, label);
  END IF;
  IF NEW.title IS DISTINCT FROM OLD.title THEN
    INSERT INTO public.roadmap_task_activity(task_id, field, old_value, new_value, author, author_label)
      VALUES (NEW.id, 'title', OLD.title, NEW.title, uid, label);
  END IF;
  IF NEW.description IS DISTINCT FROM OLD.description THEN
    INSERT INTO public.roadmap_task_activity(task_id, field, old_value, new_value, author, author_label)
      VALUES (NEW.id, 'description', OLD.description, NEW.description, uid, label);
  END IF;
  IF NEW.acceptance IS DISTINCT FROM OLD.acceptance THEN
    INSERT INTO public.roadmap_task_activity(task_id, field, old_value, new_value, author, author_label)
      VALUES (NEW.id, 'acceptance', OLD.acceptance, NEW.acceptance, uid, label);
  END IF;
  IF NEW.owner IS DISTINCT FROM OLD.owner THEN
    INSERT INTO public.roadmap_task_activity(task_id, field, old_value, new_value, author, author_label)
      VALUES (NEW.id, 'owner', OLD.owner, NEW.owner, uid, label);
  END IF;
  IF NEW.module IS DISTINCT FROM OLD.module THEN
    INSERT INTO public.roadmap_task_activity(task_id, field, old_value, new_value, author, author_label)
      VALUES (NEW.id, 'module', OLD.module, NEW.module, uid, label);
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_log_roadmap_task_activity
AFTER UPDATE ON public.roadmap_tasks
FOR EACH ROW EXECUTE FUNCTION public.log_roadmap_task_activity();