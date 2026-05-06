CREATE TABLE IF NOT EXISTS public.roadmap_autolog_skips (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  source text NOT NULL,
  reason text NOT NULL,
  task_id uuid,
  author text,
  model text,
  summary text,
  request_meta jsonb NOT NULL DEFAULT '{}'::jsonb
);

ALTER TABLE public.roadmap_autolog_skips ENABLE ROW LEVEL SECURITY;

CREATE POLICY "operators read autolog skips"
  ON public.roadmap_autolog_skips FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'operator'::app_role));

CREATE POLICY "operators insert autolog skips"
  ON public.roadmap_autolog_skips FOR INSERT
  TO authenticated
  WITH CHECK (public.has_role(auth.uid(), 'operator'::app_role));

CREATE INDEX IF NOT EXISTS roadmap_autolog_skips_created_at_idx
  ON public.roadmap_autolog_skips (created_at DESC);