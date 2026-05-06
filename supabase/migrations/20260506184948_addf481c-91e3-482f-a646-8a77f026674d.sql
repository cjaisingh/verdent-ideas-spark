ALTER TABLE public.roadmap_work_log
  ADD COLUMN IF NOT EXISTS prompt_preview text,
  ADD COLUMN IF NOT EXISTS response_preview text,
  ADD COLUMN IF NOT EXISTS request_meta jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS response_meta jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS model_provider text;