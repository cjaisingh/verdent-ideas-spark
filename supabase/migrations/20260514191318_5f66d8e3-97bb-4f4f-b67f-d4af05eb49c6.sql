DROP VIEW IF EXISTS public.roadmap_phase_gate_status;

CREATE VIEW public.roadmap_phase_gate_status AS
WITH phase_tasks AS (
  SELECT p_1.id AS phase_id, p_1.key AS phase_key, t.id AS task_id, t.status::text AS task_status
  FROM roadmap_phases p_1
  LEFT JOIN roadmap_sprints s ON s.phase_id = p_1.id
  LEFT JOIN roadmap_tasks t ON t.sprint_id = s.id
), structural AS (
  SELECT pt.phase_id, pt.phase_key,
    count(pt.task_id) FILTER (WHERE pt.task_id IS NOT NULL) AS total_tasks,
    count(pt.task_id) FILTER (WHERE pt.task_status NOT IN ('done','wont_do') AND pt.task_id IS NOT NULL) AS open_tasks
  FROM phase_tasks pt GROUP BY pt.phase_id, pt.phase_key
), qa AS (
  SELECT p_1.id AS phase_id,
    count(*) FILTER (WHERE q.status = 'pass') AS pass_count,
    count(*) FILTER (WHERE q.status = 'fail') AS fail_count,
    count(*) FILTER (WHERE q.status = 'unknown' OR q.status IS NULL) AS unknown_count,
    count(*) FILTER (WHERE q.status <> 'pass') AS not_pass_count,
    count(q.id) AS total
  FROM roadmap_phases p_1
  LEFT JOIN qa_checks q ON q.phase_key = p_1.key
  GROUP BY p_1.id
), night AS (
  SELECT p_1.id AS phase_id, count(*) AS high_audits
  FROM roadmap_phases p_1
  LEFT JOIN roadmap_sprints s ON s.phase_id = p_1.id
  LEFT JOIN roadmap_tasks t ON t.sprint_id = s.id
  LEFT JOIN discussion_actions da ON da.promoted_task_id = t.id
  LEFT JOIN night_task_audit nta ON nta.discussion_action_id = da.id
    AND nta.worst_severity = 'high'
    AND COALESCE(da.status,'open') NOT IN ('done','closed','wont_do')
  WHERE nta.discussion_action_id IS NOT NULL
  GROUP BY p_1.id
), approvals AS (
  SELECT p_1.id AS phase_id, count(*) AS pending_signoffs
  FROM roadmap_phases p_1
  LEFT JOIN approval_queue aq ON aq.activity = 'roadmap.phase_signoff'
    AND aq.status = 'pending'
    AND ((aq.intent_payload->>'phase_id')::uuid) = p_1.id
  WHERE aq.id IS NOT NULL
  GROUP BY p_1.id
)
SELECT p.id AS phase_id,
  p.key AS phase_key,
  p.status::text AS phase_status,
  COALESCE(st.total_tasks, 0) AS total_tasks,
  COALESCE(st.open_tasks, 0)  AS open_tasks,
  COALESCE(qa.total, 0)        AS qa_total,
  COALESCE(qa.pass_count, 0)   AS qa_pass,
  COALESCE(qa.fail_count, 0)   AS qa_failed,
  COALESCE(qa.unknown_count, 0) AS qa_unknown,
  COALESCE(n.high_audits, 0)   AS night_high_open,
  COALESCE(a.pending_signoffs, 0) AS pending_signoffs,
  COALESCE(st.open_tasks, 0) = 0 AND COALESCE(st.total_tasks, 0) > 0 AS structural_ok,
  COALESCE(qa.total, 0) > 0 AND COALESCE(qa.not_pass_count, 0) = 0 AS qa_ok,
  COALESCE(n.high_audits, 0) = 0 AS night_ok,
  COALESCE(a.pending_signoffs, 0) = 0 AS approvals_ok,
  COALESCE(st.open_tasks, 0) = 0
    AND COALESCE(st.total_tasks, 0) > 0
    AND COALESCE(qa.total, 0) > 0
    AND COALESCE(qa.not_pass_count, 0) = 0
    AND COALESCE(n.high_audits, 0) = 0
    AND COALESCE(a.pending_signoffs, 0) = 0 AS all_ok,
  jsonb_build_object(
    'open_tasks', COALESCE(st.open_tasks, 0),
    'qa_failed', COALESCE(qa.fail_count, 0),
    'qa_unknown', COALESCE(qa.unknown_count, 0) + CASE WHEN COALESCE(qa.total,0)=0 THEN 1 ELSE 0 END,
    'qa_missing_or_failing', GREATEST(0, COALESCE(qa.total,0) - COALESCE(qa.pass_count,0))
      + CASE WHEN COALESCE(qa.total,0) = 0 THEN 1 ELSE 0 END,
    'night_high_open', COALESCE(n.high_audits, 0),
    'pending_signoffs', COALESCE(a.pending_signoffs, 0)
  ) AS blockers
FROM roadmap_phases p
LEFT JOIN structural st ON st.phase_id = p.id
LEFT JOIN qa ON qa.phase_id = p.id
LEFT JOIN night n ON n.phase_id = p.id
LEFT JOIN approvals a ON a.phase_id = p.id;