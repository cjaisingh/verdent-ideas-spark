
ALTER TABLE public.roadmap_tasks
  ADD COLUMN IF NOT EXISTS review_status text NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS reviewed_by text,
  ADD COLUMN IF NOT EXISTS reviewed_at timestamptz,
  ADD COLUMN IF NOT EXISTS review_notes text;

ALTER TABLE public.roadmap_tasks
  ADD CONSTRAINT roadmap_tasks_review_status_chk
  CHECK (review_status IN ('pending','approved','rejected','changes_requested'));

CREATE TABLE public.roadmap_task_reviews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id uuid NOT NULL,
  decision text NOT NULL CHECK (decision IN ('approved','rejected','changes_requested','reopened')),
  notes text,
  checklist_snapshot jsonb NOT NULL DEFAULT '[]'::jsonb,
  checklist_total integer NOT NULL DEFAULT 0,
  checklist_done integer NOT NULL DEFAULT 0,
  reviewer text,
  reviewer_id uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_task_reviews_task ON public.roadmap_task_reviews(task_id, created_at DESC);

ALTER TABLE public.roadmap_task_reviews ENABLE ROW LEVEL SECURITY;

CREATE POLICY "operators read task reviews" ON public.roadmap_task_reviews
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'operator'::app_role));

CREATE POLICY "operators insert task reviews" ON public.roadmap_task_reviews
  FOR INSERT TO authenticated
  WITH CHECK (public.has_role(auth.uid(), 'operator'::app_role));

-- No update/delete policies — history is append-only.

ALTER PUBLICATION supabase_realtime ADD TABLE public.roadmap_task_reviews;
