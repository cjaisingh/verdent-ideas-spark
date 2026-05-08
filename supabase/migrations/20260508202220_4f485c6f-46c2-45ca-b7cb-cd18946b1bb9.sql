ALTER TABLE public.ai_usage_log
  ADD COLUMN IF NOT EXISTS cost_usd numeric(12,6),
  ADD COLUMN IF NOT EXISTS price_in_per_mtok numeric(10,4),
  ADD COLUMN IF NOT EXISTS price_out_per_mtok numeric(10,4);

CREATE INDEX IF NOT EXISTS ai_usage_log_job_created_idx
  ON public.ai_usage_log (job, created_at DESC);