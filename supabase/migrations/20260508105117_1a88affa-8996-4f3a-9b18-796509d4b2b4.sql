
ALTER TABLE public.discussion_actions
  ADD COLUMN IF NOT EXISTS night_eligible boolean NOT NULL DEFAULT false;

ALTER TABLE public.night_proposals
  ADD COLUMN IF NOT EXISTS payload jsonb NOT NULL DEFAULT '{}'::jsonb;

CREATE OR REPLACE VIEW public.night_task_audit
WITH (security_invoker = true) AS
SELECT
  (subject_ref->>'discussion_action_id')::uuid AS discussion_action_id,
  shift_id,
  bool_or(summary LIKE 'audit_complete%') AS audit_complete,
  max(severity) AS worst_severity,
  count(*) AS step_count,
  jsonb_agg(jsonb_build_object(
    'kind', kind,
    'severity', severity,
    'summary', summary,
    'created_at', created_at
  ) ORDER BY created_at) AS steps
FROM public.night_observations
WHERE subject_ref ? 'discussion_action_id'
GROUP BY shift_id, (subject_ref->>'discussion_action_id')::uuid;

GRANT SELECT ON public.night_task_audit TO authenticated;
