-- Hourly purge of console.error / console.warn captures older than 7 days.
-- Real errors (kind in 'error','unhandledrejection','boundary') keep the
-- default 30-day retention applied by retention-sweep.

CREATE OR REPLACE FUNCTION public.purge_console_captures()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  deleted integer;
BEGIN
  DELETE FROM public.frontend_error_logs
   WHERE kind IN ('console.error', 'console.warn')
     AND created_at < now() - interval '7 days';
  GET DIAGNOSTICS deleted = ROW_COUNT;
  RETURN deleted;
END;
$$;

REVOKE ALL ON FUNCTION public.purge_console_captures() FROM PUBLIC;

-- Schedule hourly via pg_cron (idempotent).
DO $$
BEGIN
  PERFORM cron.unschedule('purge-console-captures-hourly')
   WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'purge-console-captures-hourly');
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

SELECT cron.schedule(
  'purge-console-captures-hourly',
  '7 * * * *',
  $$SELECT public.purge_console_captures();$$
);

-- Index to keep the hourly purge cheap.
CREATE INDEX IF NOT EXISTS idx_frontend_error_logs_console_kind
  ON public.frontend_error_logs (created_at)
  WHERE kind IN ('console.error', 'console.warn');