ALTER TABLE public.alert_settings
  ADD COLUMN IF NOT EXISTS alert_on_auth_failed boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS auth_failed_threshold integer NOT NULL DEFAULT 3,
  ADD COLUMN IF NOT EXISTS auth_failed_window_minutes integer NOT NULL DEFAULT 15;