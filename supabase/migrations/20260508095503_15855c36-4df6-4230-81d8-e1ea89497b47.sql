-- 1) Short id for findings: FND-<n>
ALTER TABLE public.roadmap_review_findings
  ADD COLUMN IF NOT EXISTS short_num integer;

CREATE SEQUENCE IF NOT EXISTS public.roadmap_finding_short_seq;

-- backfill numbering ordered by reviewed_at then id
WITH ordered AS (
  SELECT id, row_number() OVER (ORDER BY reviewed_at, id) AS rn
  FROM public.roadmap_review_findings
  WHERE short_num IS NULL
)
UPDATE public.roadmap_review_findings f
SET short_num = o.rn
FROM ordered o
WHERE f.id = o.id;

-- advance sequence past backfilled max
SELECT setval('public.roadmap_finding_short_seq',
              GREATEST(COALESCE((SELECT max(short_num) FROM public.roadmap_review_findings), 0), 1),
              true);

CREATE OR REPLACE FUNCTION public.assign_finding_short_num()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.short_num IS NULL THEN
    NEW.short_num := nextval('public.roadmap_finding_short_seq');
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_finding_short_num ON public.roadmap_review_findings;
CREATE TRIGGER trg_finding_short_num
BEFORE INSERT ON public.roadmap_review_findings
FOR EACH ROW EXECUTE FUNCTION public.assign_finding_short_num();

-- 2) Per-subject ordinal on discussions
ALTER TABLE public.roadmap_finding_discussions
  ADD COLUMN IF NOT EXISTS subject_ordinal integer;

WITH ordered AS (
  SELECT id, row_number() OVER (PARTITION BY subject_type, subject_id ORDER BY created_at, id) AS rn
  FROM public.roadmap_finding_discussions
  WHERE subject_ordinal IS NULL
)
UPDATE public.roadmap_finding_discussions d
SET subject_ordinal = o.rn
FROM ordered o
WHERE d.id = o.id;

CREATE OR REPLACE FUNCTION public.assign_discussion_subject_ordinal()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.subject_ordinal IS NULL THEN
    SELECT COALESCE(max(subject_ordinal), 0) + 1
      INTO NEW.subject_ordinal
      FROM public.roadmap_finding_discussions
     WHERE subject_type = NEW.subject_type
       AND subject_id = NEW.subject_id;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_discussion_subject_ordinal ON public.roadmap_finding_discussions;
CREATE TRIGGER trg_discussion_subject_ordinal
BEFORE INSERT ON public.roadmap_finding_discussions
FOR EACH ROW EXECUTE FUNCTION public.assign_discussion_subject_ordinal();

-- 3) discussion_actions (jobs board)
CREATE SEQUENCE IF NOT EXISTS public.discussion_action_short_seq;

CREATE TABLE IF NOT EXISTS public.discussion_actions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  short_num integer NOT NULL DEFAULT nextval('public.discussion_action_short_seq'),
  subject_type text NOT NULL,
  subject_id uuid NOT NULL,
  discussion_id uuid REFERENCES public.roadmap_finding_discussions(id) ON DELETE SET NULL,
  title text NOT NULL,
  details text,
  status text NOT NULL DEFAULT 'open',
  priority text NOT NULL DEFAULT 'med',
  owner text,
  due_at timestamptz,
  source text NOT NULL DEFAULT 'manual',
  extracted_confidence numeric,
  promoted_task_id uuid REFERENCES public.roadmap_tasks(id) ON DELETE SET NULL,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_discussion_actions_subject
  ON public.discussion_actions (subject_type, subject_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_discussion_actions_discussion
  ON public.discussion_actions (discussion_id);
CREATE INDEX IF NOT EXISTS idx_discussion_actions_status
  ON public.discussion_actions (status, created_at DESC);

ALTER TABLE public.discussion_actions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "operators read discussion_actions" ON public.discussion_actions;
CREATE POLICY "operators read discussion_actions"
  ON public.discussion_actions FOR SELECT TO authenticated
  USING (has_role(auth.uid(), 'operator'));

DROP POLICY IF EXISTS "operators insert discussion_actions" ON public.discussion_actions;
CREATE POLICY "operators insert discussion_actions"
  ON public.discussion_actions FOR INSERT TO authenticated
  WITH CHECK (has_role(auth.uid(), 'operator'));

DROP POLICY IF EXISTS "operators update discussion_actions" ON public.discussion_actions;
CREATE POLICY "operators update discussion_actions"
  ON public.discussion_actions FOR UPDATE TO authenticated
  USING (has_role(auth.uid(), 'operator'))
  WITH CHECK (has_role(auth.uid(), 'operator'));

DROP POLICY IF EXISTS "operators delete discussion_actions" ON public.discussion_actions;
CREATE POLICY "operators delete discussion_actions"
  ON public.discussion_actions FOR DELETE TO authenticated
  USING (has_role(auth.uid(), 'operator'));

DROP TRIGGER IF EXISTS trg_discussion_actions_updated ON public.discussion_actions;
CREATE TRIGGER trg_discussion_actions_updated
BEFORE UPDATE ON public.discussion_actions
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

ALTER PUBLICATION supabase_realtime ADD TABLE public.discussion_actions;
