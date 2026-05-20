-- v_automation_runs_latest_per_job: one row per job with the most recent
-- created_at + status. Used by sentinel-tick checkCronSilence so the
-- sample is never crowded out by high-frequency jobs hitting the 5000-row
-- PostgREST cap.
CREATE OR REPLACE VIEW public.v_automation_runs_latest_per_job AS
SELECT DISTINCT ON (job)
  job,
  id,
  status,
  created_at
FROM public.automation_runs
ORDER BY job, created_at DESC;

COMMENT ON VIEW public.v_automation_runs_latest_per_job IS
  'Latest automation_runs row per job. Source for sentinel-tick cron_silence so the sample is bounded by job count, not row count.';

-- Resolve the three false-positive cron_silence findings the bug produced.
UPDATE public.sentinel_findings
SET status = 'resolved', resolved_at = now()
WHERE status = 'open'
  AND kind = 'cron_silence'
  AND dedupe_key IN (
    'cron_silence:lessons-synthesize',
    'cron_silence:deep-audit'
  );

-- Resolve the stale job_error_rate finding (sentinel-tick has been green
-- since the token rotation healed yesterday afternoon).
UPDATE public.sentinel_findings
SET status = 'resolved', resolved_at = now()
WHERE status = 'open'
  AND kind = 'job_error_rate'
  AND dedupe_key LIKE 'job_error_rate:sentinel-tick:%';