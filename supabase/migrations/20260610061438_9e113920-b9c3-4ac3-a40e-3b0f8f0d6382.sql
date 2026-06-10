-- Audit #15: claim_scheduled_jobs flagged a job as "locked" but never moved
-- status from 'pending' to 'running'. The scheduler-tick worker treated the
-- claim as a lease, but a parallel tick reading by status='pending' would
-- re-claim the same job, causing silent double execution. Set status='running'
-- in the same UPDATE so the row is visibly out of the queue immediately.
CREATE OR REPLACE FUNCTION public.claim_scheduled_jobs(
  _now TIMESTAMPTZ,
  _lock_until TIMESTAMPTZ,
  _lock_by TEXT,
  _limit INT
)
RETURNS TABLE(id UUID)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  WITH due AS (
    SELECT j.id
    FROM public.scheduled_jobs j
    WHERE j.status = 'pending'
      AND j.run_at <= _now
      AND (j.locked_until IS NULL OR j.locked_until < _now)
    ORDER BY j.run_at ASC
    LIMIT _limit
    FOR UPDATE SKIP LOCKED
  )
  UPDATE public.scheduled_jobs j
     SET status       = 'running',
         locked_until = _lock_until,
         locked_by    = _lock_by,
         started_at   = COALESCE(j.started_at, _now)
   WHERE j.id IN (SELECT d.id FROM due d)
  RETURNING j.id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.claim_scheduled_jobs(TIMESTAMPTZ, TIMESTAMPTZ, TEXT, INT) TO service_role;
REVOKE EXECUTE ON FUNCTION public.claim_scheduled_jobs(TIMESTAMPTZ, TIMESTAMPTZ, TEXT, INT) FROM PUBLIC, anon, authenticated;