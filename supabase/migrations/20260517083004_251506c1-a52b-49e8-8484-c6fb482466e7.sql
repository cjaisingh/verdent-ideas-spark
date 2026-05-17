-- Expose last pg_cron run per job for runtime health widget.
CREATE OR REPLACE FUNCTION public.runtime_cron_status(_jobnames text[])
RETURNS TABLE(
  jobname text,
  schedule text,
  active boolean,
  last_status text,
  last_start timestamptz,
  last_end timestamptz
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, cron
AS $$
BEGIN
  IF NOT (public.has_role(auth.uid(),'operator') OR public.has_role(auth.uid(),'admin')) THEN
    RAISE EXCEPTION 'not authorized';
  END IF;
  RETURN QUERY
  SELECT j.jobname::text, j.schedule::text, j.active,
         d.status::text, d.start_time, d.end_time
  FROM cron.job j
  LEFT JOIN LATERAL (
    SELECT r.status, r.start_time, r.end_time
    FROM cron.job_run_details r
    WHERE r.jobid = j.jobid
    ORDER BY r.start_time DESC NULLS LAST
    LIMIT 1
  ) d ON true
  WHERE j.jobname = ANY(_jobnames)
  ORDER BY j.jobname;
END;
$$;

GRANT EXECUTE ON FUNCTION public.runtime_cron_status(text[]) TO authenticated;