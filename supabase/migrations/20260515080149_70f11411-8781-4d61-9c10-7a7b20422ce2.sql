ALTER TABLE public.qa_checks
  ADD COLUMN IF NOT EXISTS last_actor uuid,
  ADD COLUMN IF NOT EXISTS last_actor_label text,
  ADD COLUMN IF NOT EXISTS last_action text;

CREATE OR REPLACE FUNCTION public.tag_qa_check_actor()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE uid uuid := auth.uid(); label text;
BEGIN
  SELECT email INTO label FROM auth.users WHERE id = uid;
  IF label IS NULL THEN label := 'system'; END IF;

  IF TG_OP = 'INSERT' THEN
    NEW.last_actor := uid;
    NEW.last_actor_label := label;
    NEW.last_action := 'created:' || coalesce(NEW.status, 'unknown');
    RETURN NEW;
  END IF;

  IF NEW.status IS DISTINCT FROM OLD.status
     OR NEW.note   IS DISTINCT FROM OLD.note
     OR NEW.last_checked_at IS DISTINCT FROM OLD.last_checked_at THEN
    NEW.last_actor := uid;
    NEW.last_actor_label := label;
    NEW.last_action := CASE
      WHEN NEW.status IS DISTINCT FROM OLD.status
        THEN coalesce(OLD.status,'unknown') || '→' || coalesce(NEW.status,'unknown')
      ELSE 'note-updated'
    END;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_tag_qa_check_actor ON public.qa_checks;
CREATE TRIGGER trg_tag_qa_check_actor
  BEFORE INSERT OR UPDATE ON public.qa_checks
  FOR EACH ROW EXECUTE FUNCTION public.tag_qa_check_actor();