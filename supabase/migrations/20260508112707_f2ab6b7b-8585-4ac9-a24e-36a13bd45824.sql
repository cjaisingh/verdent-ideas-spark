
ALTER TABLE public.memory_settings
  ADD COLUMN IF NOT EXISTS night_timezone text NOT NULL DEFAULT 'UTC',
  ADD COLUMN IF NOT EXISTS night_window_start text NOT NULL DEFAULT '22:00',
  ADD COLUMN IF NOT EXISTS night_window_end text NOT NULL DEFAULT '06:00',
  ADD COLUMN IF NOT EXISTS night_blackout_dates jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS night_allowed_kinds jsonb NOT NULL DEFAULT '["general","auth","roadmap","copilot","jobs"]'::jsonb;
