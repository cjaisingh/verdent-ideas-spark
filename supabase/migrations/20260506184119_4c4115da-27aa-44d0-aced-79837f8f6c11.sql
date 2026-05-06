ALTER TABLE public.roadmap_work_log
  ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'manual';