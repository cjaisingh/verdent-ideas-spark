-- Slice 1: worker heartbeat / reclaim / auto-block
ALTER TABLE public.roadmap_phase_overnight_runs
  ADD COLUMN IF NOT EXISTS heartbeat_at timestamptz,
  ADD COLUMN IF NOT EXISTS attempts int NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS max_retries int NOT NULL DEFAULT 3,
  ADD COLUMN IF NOT EXISTS last_error text;

ALTER TABLE public.night_shifts
  ADD COLUMN IF NOT EXISTS heartbeat_at timestamptz,
  ADD COLUMN IF NOT EXISTS attempts int NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS max_retries int NOT NULL DEFAULT 3,
  ADD COLUMN IF NOT EXISTS last_error text;

CREATE INDEX IF NOT EXISTS idx_overnight_runs_heartbeat
  ON public.roadmap_phase_overnight_runs (status, heartbeat_at)
  WHERE status = 'running';

CREATE INDEX IF NOT EXISTS idx_night_shifts_heartbeat
  ON public.night_shifts (status, heartbeat_at)
  WHERE status = 'running';

CREATE OR REPLACE FUNCTION public.reclaim_stale_night_jobs(_stale_minutes int DEFAULT 10)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  cutoff timestamptz := now() - (_stale_minutes || ' minutes')::interval;
  reclaimed_runs int := 0;
  blocked_runs int := 0;
  reclaimed_shifts int := 0;
  blocked_shifts int := 0;
BEGIN
  IF NOT (public.has_role(auth.uid(),'operator')
       OR public.has_role(auth.uid(),'admin')
       OR auth.uid() IS NULL) THEN
    RAISE EXCEPTION 'not authorized';
  END IF;

  -- Phase overnight runs
  WITH stale AS (
    SELECT id, attempts, max_retries
    FROM public.roadmap_phase_overnight_runs
    WHERE status = 'running'
      AND coalesce(heartbeat_at, started_at, requested_at) < cutoff
    FOR UPDATE SKIP LOCKED
  ),
  to_block AS (
    UPDATE public.roadmap_phase_overnight_runs r
       SET status = 'auto_blocked',
           finished_at = now(),
           last_error = coalesce(r.last_error,'') || ' [reclaim: max_retries exceeded]'
      FROM stale s
     WHERE r.id = s.id AND s.attempts >= s.max_retries
    RETURNING r.id
  ),
  to_requeue AS (
    UPDATE public.roadmap_phase_overnight_runs r
       SET status = 'queued',
           heartbeat_at = NULL,
           started_at = NULL,
           last_error = coalesce(r.last_error,'') || ' [reclaim: stalled worker]'
      FROM stale s
     WHERE r.id = s.id AND s.attempts < s.max_retries
    RETURNING r.id
  )
  SELECT (SELECT count(*) FROM to_requeue), (SELECT count(*) FROM to_block)
    INTO reclaimed_runs, blocked_runs;

  -- Night shifts (one running shift per night; reclaim by closing as failed)
  WITH stale AS (
    SELECT id, attempts, max_retries
    FROM public.night_shifts
    WHERE status = 'running'
      AND coalesce(heartbeat_at, started_at) < cutoff
    FOR UPDATE SKIP LOCKED
  ),
  to_block AS (
    UPDATE public.night_shifts s
       SET status = 'auto_blocked',
           ended_at = now(),
           last_error = coalesce(s.last_error,'') || ' [reclaim: max_retries exceeded]'
      FROM stale st
     WHERE s.id = st.id AND st.attempts >= st.max_retries
    RETURNING s.id
  ),
  to_close AS (
    UPDATE public.night_shifts s
       SET status = 'reclaimed',
           ended_at = now(),
           last_error = coalesce(s.last_error,'') || ' [reclaim: stalled worker]'
      FROM stale st
     WHERE s.id = st.id AND st.attempts < st.max_retries
    RETURNING s.id
  )
  SELECT (SELECT count(*) FROM to_close), (SELECT count(*) FROM to_block)
    INTO reclaimed_shifts, blocked_shifts;

  RETURN jsonb_build_object(
    'cutoff', cutoff,
    'overnight_runs_reclaimed', reclaimed_runs,
    'overnight_runs_auto_blocked', blocked_runs,
    'night_shifts_reclaimed', reclaimed_shifts,
    'night_shifts_auto_blocked', blocked_shifts
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.reclaim_stale_night_jobs(int) TO authenticated, service_role;