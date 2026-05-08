ALTER TABLE public.alert_settings
  ADD COLUMN IF NOT EXISTS alert_on_cost boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS cost_per_run_usd numeric(10,4),
  ADD COLUMN IF NOT EXISTS cost_per_day_usd numeric(10,4);