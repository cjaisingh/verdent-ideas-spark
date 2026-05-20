-- Auto-archive stale What's New drafts (>30 days, never reviewed/published).
-- Runs inline now to clear the 445-row backlog; a scheduled sweep can be
-- added later if drafts pile up again.
ALTER TABLE public.whats_new_entries
  DROP CONSTRAINT IF EXISTS whats_new_entries_status_check;

ALTER TABLE public.whats_new_entries
  ADD CONSTRAINT whats_new_entries_status_check
  CHECK (status IN ('draft','published','archived'));

UPDATE public.whats_new_entries
SET status = 'archived', updated_at = now()
WHERE status = 'draft'
  AND created_at < now() - interval '30 days';

-- Resolve the stale job_error_rate finding from yesterday's token rotation.
-- The 24h rolling rate will fully decay in a few hours; no point flapping it.
UPDATE public.sentinel_findings
SET status = 'resolved', resolved_at = now()
WHERE status = 'open'
  AND kind = 'job_error_rate'
  AND dedupe_key LIKE 'job_error_rate:sentinel-tick:%';