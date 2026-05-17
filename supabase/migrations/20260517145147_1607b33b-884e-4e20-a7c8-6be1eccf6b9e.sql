
CREATE OR REPLACE VIEW public.v_credit_burn_per_step
WITH (security_invoker = true)
AS
SELECT ce.id,
       ce.occurred_at,
       ce.task_id,
       COALESCE(ce.phase_id, s.phase_id) AS phase_id,
       ce.step_label,
       'manual'::text AS source,
       ce.credits,
       NULL::integer AS tokens_total,
       NULL::text AS model,
       NULL::integer AS duration_ms,
       ce.mode,
       ce.note,
       ce.category::text AS category
  FROM public.credit_entries ce
  LEFT JOIN public.roadmap_tasks t ON t.id = ce.task_id
  LEFT JOIN public.roadmap_sprints s ON s.id = t.sprint_id
UNION ALL
SELECT wl.id,
       wl.started_at AS occurred_at,
       wl.task_id,
       s.phase_id,
       COALESCE(left(wl.summary, 80), 'work_log entry') AS step_label,
       'proxy'::text AS source,
       round(((COALESCE(wl.tokens_total, 0))::numeric / 1000.0) * cs.proxy_rate_per_1k_tokens, 4) AS credits,
       wl.tokens_total,
       wl.model,
       wl.duration_ms,
       NULL::text AS mode,
       NULL::text AS note,
       NULL::text AS category
  FROM public.roadmap_work_log wl
  LEFT JOIN public.roadmap_tasks t ON t.id = wl.task_id
  LEFT JOIN public.roadmap_sprints s ON s.id = t.sprint_id
  CROSS JOIN public.credit_settings cs
  WHERE cs.id = true AND COALESCE(wl.tokens_total, 0) > 0;

GRANT SELECT ON public.v_credit_burn_per_step TO authenticated;
