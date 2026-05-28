
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
     SET locked_until = _lock_until,
         locked_by    = _lock_by
   WHERE j.id IN (SELECT d.id FROM due d)
  RETURNING j.id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.claim_scheduled_jobs(TIMESTAMPTZ, TIMESTAMPTZ, TEXT, INT) TO service_role;
REVOKE EXECUTE ON FUNCTION public.claim_scheduled_jobs(TIMESTAMPTZ, TIMESTAMPTZ, TEXT, INT) FROM PUBLIC, anon, authenticated;
