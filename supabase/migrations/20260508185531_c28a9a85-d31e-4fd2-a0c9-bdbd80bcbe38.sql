CREATE OR REPLACE VIEW public.roadmap_phase_gate_status
WITH (security_invoker = true)
AS
WITH phase_tasks AS (
  SELECT p.id AS phase_id, p.key AS phase_key, t.id AS task_id, t.status::text AS task_status
  FROM public.roadmap_phases p
  LEFT JOIN public.roadmap_sprints s ON s.phase_id = p.id
  LEFT JOIN public.roadmap_tasks t ON t.sprint_id = s.id
),
structural AS (
  SELECT phase_id, phase_key,
    COUNT(task_id) FILTER (WHERE task_id IS NOT NULL) AS total_tasks,
    COUNT(task_id) FILTER (WHERE task_status NOT IN ('done','wont_do') AND task_id IS NOT NULL) AS open_tasks
  FROM phase_tasks
  GROUP BY phase_id, phase_key
),
qa AS (
  SELECT p.id AS phase_id,
    COUNT(*) FILTER (WHERE q.status = 'pass') AS pass_count,
    COUNT(*) FILTER (WHERE q.status <> 'pass') AS not_pass_count,
    COUNT(*) AS total
  FROM public.roadmap_phases p
  LEFT JOIN public.qa_checks q ON q.phase_key = p.key
  GROUP BY p.id
),
night AS (
  SELECT p.id AS phase_id,
    COUNT(*) AS high_audits
  FROM public.roadmap_phases p
  LEFT JOIN public.roadmap_sprints s ON s.phase_id = p.id
  LEFT JOIN public.roadmap_tasks t ON t.sprint_id = s.id
  LEFT JOIN public.discussion_actions da ON da.promoted_task_id = t.id
  LEFT JOIN public.night_task_audit nta ON nta.discussion_action_id = da.id
    AND nta.worst_severity = 'high'
    AND COALESCE(da.status,'open') NOT IN ('done','closed','wont_do')
  WHERE nta.discussion_action_id IS NOT NULL
  GROUP BY p.id
),
approvals AS (
  SELECT p.id AS phase_id,
    COUNT(*) AS pending_signoffs
  FROM public.roadmap_phases p
  LEFT JOIN public.approval_queue aq ON aq.activity = 'roadmap.phase_signoff'
    AND aq.status = 'pending'
    AND (aq.intent_payload->>'phase_id')::uuid = p.id
  WHERE aq.id IS NOT NULL
  GROUP BY p.id
)
SELECT
  p.id AS phase_id,
  p.key AS phase_key,
  p.status::text AS phase_status,
  COALESCE(st.total_tasks, 0) AS total_tasks,
  COALESCE(st.open_tasks, 0) AS open_tasks,
  COALESCE(qa.total, 0) AS qa_total,
  COALESCE(qa.pass_count, 0) AS qa_pass,
  COALESCE(n.high_audits, 0) AS night_high_open,
  COALESCE(a.pending_signoffs, 0) AS pending_signoffs,
  (COALESCE(st.open_tasks, 0) = 0 AND COALESCE(st.total_tasks, 0) > 0) AS structural_ok,
  (COALESCE(qa.total, 0) > 0 AND COALESCE(qa.not_pass_count, 0) = 0) AS qa_ok,
  (COALESCE(n.high_audits, 0) = 0) AS night_ok,
  (COALESCE(a.pending_signoffs, 0) = 0) AS approvals_ok,
  (
    COALESCE(st.open_tasks, 0) = 0 AND COALESCE(st.total_tasks, 0) > 0
    AND COALESCE(qa.total, 0) > 0 AND COALESCE(qa.not_pass_count, 0) = 0
    AND COALESCE(n.high_audits, 0) = 0
    AND COALESCE(a.pending_signoffs, 0) = 0
  ) AS all_ok,
  jsonb_build_object(
    'open_tasks', COALESCE(st.open_tasks, 0),
    'qa_missing_or_failing', GREATEST(0, COALESCE(qa.total,0) - COALESCE(qa.pass_count,0)) + CASE WHEN COALESCE(qa.total,0) = 0 THEN 1 ELSE 0 END,
    'night_high_open', COALESCE(n.high_audits, 0),
    'pending_signoffs', COALESCE(a.pending_signoffs, 0)
  ) AS blockers
FROM public.roadmap_phases p
LEFT JOIN structural st ON st.phase_id = p.id
LEFT JOIN qa ON qa.phase_id = p.id
LEFT JOIN night n ON n.phase_id = p.id
LEFT JOIN approvals a ON a.phase_id = p.id;

GRANT SELECT ON public.roadmap_phase_gate_status TO authenticated;