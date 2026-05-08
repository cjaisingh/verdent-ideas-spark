ALTER TABLE public.roadmap_finding_discussions
  ADD COLUMN IF NOT EXISTS subject_type text,
  ADD COLUMN IF NOT EXISTS subject_id uuid,
  ADD COLUMN IF NOT EXISTS title text;

UPDATE public.roadmap_finding_discussions
  SET subject_type = COALESCE(subject_type, 'roadmap_finding'),
      subject_id   = COALESCE(subject_id, finding_id);

ALTER TABLE public.roadmap_finding_discussions
  ALTER COLUMN subject_type SET NOT NULL,
  ALTER COLUMN subject_type SET DEFAULT 'roadmap_finding',
  ALTER COLUMN subject_id SET NOT NULL,
  ALTER COLUMN finding_id DROP NOT NULL;

CREATE INDEX IF NOT EXISTS idx_finding_discussions_subject
  ON public.roadmap_finding_discussions (subject_type, subject_id, created_at DESC);
