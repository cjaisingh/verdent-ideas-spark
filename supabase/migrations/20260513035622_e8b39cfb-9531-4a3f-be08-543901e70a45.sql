ALTER TABLE public.lessons
  ADD COLUMN IF NOT EXISTS cadence text NOT NULL DEFAULT 'weekly',
  ADD COLUMN IF NOT EXISTS source text,
  ADD COLUMN IF NOT EXISTS occurrences integer NOT NULL DEFAULT 1;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'lessons_cadence_check') THEN
    ALTER TABLE public.lessons ADD CONSTRAINT lessons_cadence_check
      CHECK (cadence IN ('daily','weekly'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'lessons_source_check') THEN
    ALTER TABLE public.lessons ADD CONSTRAINT lessons_source_check
      CHECK (source IS NULL OR source IN ('discussion','chat','triage','event','automation','review','mixed'));
  END IF;
END $$;

UPDATE public.lessons SET source = 'automation' WHERE source IS NULL;

CREATE INDEX IF NOT EXISTS lessons_cadence_status_idx ON public.lessons(cadence, status, created_at DESC);
CREATE INDEX IF NOT EXISTS lessons_source_idx ON public.lessons(source);

-- Allow the new daily job in the managed-cron whitelist
CREATE OR REPLACE FUNCTION public.set_managed_cron_active(_jobname text, _active boolean)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'cron'
AS $function$
DECLARE
  _jobid bigint;
  _label text;
BEGIN
  IF NOT (public.has_role(auth.uid(), 'operator') OR public.has_role(auth.uid(), 'admin')) THEN
    RAISE EXCEPTION 'not authorized';
  END IF;
  IF _jobname NOT IN ('scheduled-morning-review','scheduled-sentinel-tick','scheduled-lessons-weekly','scheduled-lessons-daily') THEN
    RAISE EXCEPTION 'job % is not managed', _jobname;
  END IF;
  SELECT jobid INTO _jobid FROM cron.job WHERE jobname = _jobname;
  IF _jobid IS NULL THEN RAISE EXCEPTION 'job % not found', _jobname; END IF;
  PERFORM cron.alter_job(job_id := _jobid, active := _active);
  SELECT email INTO _label FROM auth.users WHERE id = auth.uid();
  IF _label IS NULL THEN _label := 'system'; END IF;
  INSERT INTO public.memory_audit_log(scope, entry_key, action, new_value, actor)
    VALUES ('cron_schedule', _jobname, 'updated', jsonb_build_object('active', _active), _label);
END;
$function$;

CREATE OR REPLACE FUNCTION public.update_managed_cron_schedule(_jobname text, _schedule text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'cron'
AS $function$
DECLARE
  _jobid bigint;
  _old text;
  _label text;
BEGIN
  IF NOT (public.has_role(auth.uid(), 'operator') OR public.has_role(auth.uid(), 'admin')) THEN
    RAISE EXCEPTION 'not authorized';
  END IF;
  IF _jobname NOT IN ('scheduled-morning-review','scheduled-sentinel-tick','scheduled-lessons-weekly','scheduled-lessons-daily') THEN
    RAISE EXCEPTION 'job % is not managed', _jobname;
  END IF;
  IF _schedule IS NULL OR length(trim(_schedule)) = 0 THEN
    RAISE EXCEPTION 'schedule is required';
  END IF;
  IF array_length(regexp_split_to_array(trim(_schedule), '\s+'), 1) <> 5 THEN
    RAISE EXCEPTION 'invalid cron schedule (expected 5 fields)';
  END IF;
  SELECT jobid, schedule INTO _jobid, _old FROM cron.job WHERE jobname = _jobname;
  IF _jobid IS NULL THEN RAISE EXCEPTION 'job % not found', _jobname; END IF;
  PERFORM cron.alter_job(job_id := _jobid, schedule := _schedule);
  SELECT email INTO _label FROM auth.users WHERE id = auth.uid();
  IF _label IS NULL THEN _label := 'system'; END IF;
  INSERT INTO public.memory_audit_log(scope, entry_key, action, old_value, new_value, actor)
    VALUES ('cron_schedule', _jobname, 'updated',
            jsonb_build_object('schedule', _old),
            jsonb_build_object('schedule', _schedule), _label);
END;
$function$;

CREATE OR REPLACE FUNCTION public.list_managed_cron_jobs()
 RETURNS TABLE(jobid bigint, jobname text, schedule text, active boolean, last_status text, last_start timestamp with time zone, last_end timestamp with time zone)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'cron'
AS $function$
BEGIN
  IF NOT (public.has_role(auth.uid(), 'operator') OR public.has_role(auth.uid(), 'admin')) THEN
    RAISE EXCEPTION 'not authorized';
  END IF;
  RETURN QUERY
  SELECT j.jobid, j.jobname::text, j.schedule::text, j.active,
         d.status::text, d.start_time, d.end_time
  FROM cron.job j
  LEFT JOIN LATERAL (
    SELECT status, start_time, end_time FROM cron.job_run_details r
    WHERE r.jobid = j.jobid ORDER BY r.start_time DESC NULLS LAST LIMIT 1
  ) d ON true
  WHERE j.jobname IN ('scheduled-morning-review','scheduled-sentinel-tick','scheduled-lessons-weekly','scheduled-lessons-daily')
  ORDER BY j.jobname;
END;
$function$;