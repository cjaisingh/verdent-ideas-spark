
-- Managed cron job admin RPCs (W2/W3/W4 schedules)
CREATE OR REPLACE FUNCTION public.list_managed_cron_jobs()
RETURNS TABLE(
  jobid bigint,
  jobname text,
  schedule text,
  active boolean,
  last_status text,
  last_start timestamptz,
  last_end timestamptz
)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public','cron'
AS $$
BEGIN
  IF NOT (public.has_role(auth.uid(), 'operator') OR public.has_role(auth.uid(), 'admin')) THEN
    RAISE EXCEPTION 'not authorized';
  END IF;
  RETURN QUERY
  SELECT j.jobid, j.jobname::text, j.schedule::text, j.active,
         d.status::text, d.start_time, d.end_time
  FROM cron.job j
  LEFT JOIN LATERAL (
    SELECT status, start_time, end_time
    FROM cron.job_run_details r
    WHERE r.jobid = j.jobid
    ORDER BY r.start_time DESC NULLS LAST
    LIMIT 1
  ) d ON true
  WHERE j.jobname IN (
    'scheduled-morning-review',
    'scheduled-sentinel-tick',
    'scheduled-lessons-weekly'
  )
  ORDER BY j.jobname;
END;
$$;

CREATE OR REPLACE FUNCTION public.set_managed_cron_active(_jobname text, _active boolean)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public','cron'
AS $$
DECLARE
  _jobid bigint;
  _label text;
BEGIN
  IF NOT (public.has_role(auth.uid(), 'operator') OR public.has_role(auth.uid(), 'admin')) THEN
    RAISE EXCEPTION 'not authorized';
  END IF;
  IF _jobname NOT IN ('scheduled-morning-review','scheduled-sentinel-tick','scheduled-lessons-weekly') THEN
    RAISE EXCEPTION 'job % is not managed', _jobname;
  END IF;
  SELECT jobid INTO _jobid FROM cron.job WHERE jobname = _jobname;
  IF _jobid IS NULL THEN
    RAISE EXCEPTION 'job % not found', _jobname;
  END IF;
  PERFORM cron.alter_job(job_id := _jobid, active := _active);

  SELECT email INTO _label FROM auth.users WHERE id = auth.uid();
  IF _label IS NULL THEN _label := 'system'; END IF;
  INSERT INTO public.memory_audit_log(scope, entry_key, action, new_value, actor)
    VALUES ('cron_schedule', _jobname, CASE WHEN _active THEN 'updated' ELSE 'updated' END,
            jsonb_build_object('active', _active), _label);
END;
$$;

CREATE OR REPLACE FUNCTION public.update_managed_cron_schedule(_jobname text, _schedule text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public','cron'
AS $$
DECLARE
  _jobid bigint;
  _old text;
  _label text;
BEGIN
  IF NOT (public.has_role(auth.uid(), 'operator') OR public.has_role(auth.uid(), 'admin')) THEN
    RAISE EXCEPTION 'not authorized';
  END IF;
  IF _jobname NOT IN ('scheduled-morning-review','scheduled-sentinel-tick','scheduled-lessons-weekly') THEN
    RAISE EXCEPTION 'job % is not managed', _jobname;
  END IF;
  IF _schedule IS NULL OR length(trim(_schedule)) = 0 THEN
    RAISE EXCEPTION 'schedule is required';
  END IF;
  -- Basic cron format check: 5 whitespace-separated fields
  IF array_length(regexp_split_to_array(trim(_schedule), '\s+'), 1) <> 5 THEN
    RAISE EXCEPTION 'invalid cron schedule (expected 5 fields)';
  END IF;
  SELECT jobid, schedule INTO _jobid, _old FROM cron.job WHERE jobname = _jobname;
  IF _jobid IS NULL THEN
    RAISE EXCEPTION 'job % not found', _jobname;
  END IF;
  PERFORM cron.alter_job(job_id := _jobid, schedule := _schedule);

  SELECT email INTO _label FROM auth.users WHERE id = auth.uid();
  IF _label IS NULL THEN _label := 'system'; END IF;
  INSERT INTO public.memory_audit_log(scope, entry_key, action, old_value, new_value, actor)
    VALUES ('cron_schedule', _jobname, 'updated',
            jsonb_build_object('schedule', _old),
            jsonb_build_object('schedule', _schedule), _label);
END;
$$;
