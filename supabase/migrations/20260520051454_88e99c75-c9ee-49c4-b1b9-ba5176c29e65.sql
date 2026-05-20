UPDATE public.sentinel_findings
SET status = 'resolved', resolved_at = now()
WHERE status = 'open'
  AND dedupe_key IN (
    'cron_silence:app-walkthrough',
    'cron_silence:ci-status-sync-30m',
    'approvals_stale'
  );