-- W7 closeout Step 3: triage backlog
-- 1) Resolve the noisy whats_new draft finding (operator can act on /whats-new directly)
UPDATE public.sentinel_findings
   SET status='resolved', resolved_at=now(), updated_at=now()
 WHERE kind='whats_new_drafts_stale' AND status='open';

-- 2) Group the 3 stalled-cron findings under one tracked discussion_action.
--    Findings stay open until the underlying crons resume; the action is the work item.
INSERT INTO public.discussion_actions (subject_type, subject_id, title, details, priority, risk, source, status)
SELECT 'system', gen_random_uuid(),
       'Reactivate stalled crons (morning-review, sentinel-tick, overnight-phase-runner-15m)',
       'Three sentinel cron_silence findings outstanding (W7 triage):
- morning-review: silent ~5025m (cadence 1440m)
- sentinel-tick: silent ~4695m (cadence 15m)
- overnight-phase-runner-15m: silent ~3945m (cadence 15m)

Out of scope for W7 closeout — track here so they are not lost. Owner to investigate cron registration and re-enable. Findings remain open until next successful run.',
       'high', 'high', 'manual', 'open'
WHERE NOT EXISTS (
  SELECT 1 FROM public.discussion_actions
   WHERE title = 'Reactivate stalled crons (morning-review, sentinel-tick, overnight-phase-runner-15m)'
);