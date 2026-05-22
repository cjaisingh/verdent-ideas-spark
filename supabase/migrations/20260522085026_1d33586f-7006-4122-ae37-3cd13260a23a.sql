-- T2: resolve the 9 stale-surface findings as detector-wrong.
update public.sentinel_findings
set status = 'resolved',
    resolved_at = now(),
    payload = coalesce(payload,'{}'::jsonb) || jsonb_build_object(
      't2_resolution', 'detector-wrong',
      't2_reason',
      'observability_stale_surface watcher matches surface_id against automation_runs.job but registry uses scheduled-X form while automation_runs stores X (name mismatch), AND it has no cadence-aware window so weekly/monthly surfaces always look stale. Tracking the fix in a new discussion_action.',
      't2_resolved_at', now()
    ),
    updated_at = now()
where kind = 'observability_stale_surface' and status = 'open';

-- Open the tracking ticket.
insert into public.discussion_actions
  (subject_type, subject_id, title, details, status, priority, risk, source, source_ref, night_eligible)
values (
  'sentinel_check',
  '00000000-0000-0000-0000-000000000000',
  'Fix observability_stale_surface detector: job-name normalisation + cadence-aware window',
  E'Detector currently matches `observability_registry.surface_id` against `automation_runs.job` directly. Two bugs:\n\n1. Registry uses `scheduled-X` form while `automation_runs.job` stores `X` (e.g. `scheduled-tomorrow-plan-refresh` vs `tomorrow-plan-refresh`). Need a normalisation step that strips the `scheduled-` prefix OR maintain an explicit mapping column.\n\n2. No cadence awareness: weekly/monthly/quarterly surfaces always trip a fixed staleness window. Threshold should be `expected_cadence_minutes × 2` from the registry row.\n\nLives in `supabase/functions/sentinel-tick/checks.ts` under the `observability_stale_surface` block.\n\n[T2 triage 2026-05-22] Created to track the detector fix; 9 existing findings resolved as detector-wrong.',
  'open',
  'med',
  'med',
  'session_summary',
  'session:2026-05-22-next-10:t2-detector-fix',
  false
);