CREATE TABLE public.sentinel_watchdog_runs (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  ran_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  sentinel_last_run_at TIMESTAMPTZ,
  minutes_silent INTEGER,
  alerted BOOLEAN NOT NULL DEFAULT false,
  reason TEXT NOT NULL CHECK (reason IN ('healthy','stale','never_ran','deduped')),
  last_alert_key TEXT,
  details JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX idx_sentinel_watchdog_runs_ran_at
  ON public.sentinel_watchdog_runs (ran_at DESC);
CREATE INDEX idx_sentinel_watchdog_runs_alert_key
  ON public.sentinel_watchdog_runs (last_alert_key)
  WHERE last_alert_key IS NOT NULL;

GRANT SELECT ON public.sentinel_watchdog_runs TO authenticated;
GRANT ALL ON public.sentinel_watchdog_runs TO service_role;

ALTER TABLE public.sentinel_watchdog_runs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can view watchdog runs"
ON public.sentinel_watchdog_runs
FOR SELECT
TO authenticated
USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Service role manages watchdog runs"
ON public.sentinel_watchdog_runs
FOR ALL
TO service_role
USING (true)
WITH CHECK (true);

INSERT INTO public.observability_registry
  (surface_kind, surface_id, expected_cadence_minutes, watcher_kinds, owner, notes, declared_in)
VALUES
  ('cron', 'scheduled-sentinel-watchdog', 15, ARRAY['cron_silence']::text[],
   'platform',
   'Out-of-band watchdog for sentinel-tick. Pages Telegram directly via telegram-send when sentinel-tick is silent > 30 min. Uses AWIP_WATCHDOG_TOKEN (separate from AWIP_SERVICE_TOKEN) so a single-token rotation cannot silence it.',
   'migration:sentinel_watchdog_runs')
ON CONFLICT DO NOTHING;