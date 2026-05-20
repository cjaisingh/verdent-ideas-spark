-- Per-task cost accounting on ai_usage_log + sprint rollup view
ALTER TABLE public.ai_usage_log
  ADD COLUMN IF NOT EXISTS task_id uuid NULL REFERENCES public.roadmap_tasks(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS module text NULL;

CREATE INDEX IF NOT EXISTS idx_ai_usage_log_task_id ON public.ai_usage_log(task_id) WHERE task_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_ai_usage_log_module_created ON public.ai_usage_log(module, created_at DESC) WHERE module IS NOT NULL;

-- Heuristic: job name → module slug
CREATE OR REPLACE FUNCTION public.infer_ai_job_module(_job text)
RETURNS text
LANGUAGE sql IMMUTABLE
SET search_path = public
AS $$
  SELECT CASE
    WHEN _job ILIKE 'whats-new%'         THEN 'whats-new'
    WHEN _job ILIKE 'companion%'         THEN 'companion'
    WHEN _job ILIKE 'gemini-tts%'        THEN 'voice'
    WHEN _job ILIKE 'morning-review%'    THEN 'morning-review'
    WHEN _job ILIKE 'daily-plan%'
      OR _job ILIKE 'tomorrow-plan%'     THEN 'tomorrow-plan'
    WHEN _job ILIKE 'lessons%'           THEN 'lessons'
    WHEN _job ILIKE 'awip-reviews%'      THEN 'awip-reviews'
    WHEN _job ILIKE 'night-agent%'
      OR _job ILIKE 'overnight%'         THEN 'night-agent'
    WHEN _job ILIKE 'sentinel%'          THEN 'sentinel'
    WHEN _job ILIKE 'route-operator%'
      OR _job ILIKE 'operator-inbox%'    THEN 'operator-inbox'
    WHEN _job ILIKE 'deep-audit%'        THEN 'deep-audit'
    WHEN _job ILIKE 'qa-%'               THEN 'qa'
    WHEN _job ILIKE 'heygen%'            THEN 'heygen-videos'
    WHEN _job ILIKE 'telegram%'          THEN 'telegram'
    ELSE NULL
  END
$$;

-- One-shot + idempotent backfill: fill module from job, then attach task_id by
-- picking the open/in-progress task in that module whose updated_at is the
-- most-recent ≤ the log row's created_at.
CREATE OR REPLACE FUNCTION public.backfill_ai_usage_attribution()
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE m_updated int := 0; t_updated int := 0;
BEGIN
  IF NOT (public.has_role(auth.uid(),'operator') OR public.has_role(auth.uid(),'admin') OR auth.uid() IS NULL) THEN
    RAISE EXCEPTION 'not authorized';
  END IF;

  UPDATE public.ai_usage_log
     SET module = public.infer_ai_job_module(job)
   WHERE module IS NULL
     AND public.infer_ai_job_module(job) IS NOT NULL;
  GET DIAGNOSTICS m_updated = ROW_COUNT;

  WITH cand AS (
    SELECT l.id AS log_id,
           (SELECT t.id FROM public.roadmap_tasks t
             WHERE t.module = l.module
               AND t.status::text NOT IN ('cancelled')
               AND t.updated_at <= l.created_at
             ORDER BY t.updated_at DESC
             LIMIT 1) AS picked_task
      FROM public.ai_usage_log l
     WHERE l.task_id IS NULL AND l.module IS NOT NULL
  )
  UPDATE public.ai_usage_log l
     SET task_id = c.picked_task
    FROM cand c
   WHERE l.id = c.log_id AND c.picked_task IS NOT NULL;
  GET DIAGNOSTICS t_updated = ROW_COUNT;

  RETURN jsonb_build_object('module_backfilled', m_updated, 'task_id_backfilled', t_updated);
END $$;

-- Per-task rollup
CREATE OR REPLACE VIEW public.v_ai_cost_per_task
WITH (security_invoker = on) AS
SELECT
  t.id                                    AS task_id,
  t.sprint_id,
  t.title                                 AS task_title,
  t.status::text                          AS task_status,
  t.module,
  count(l.id)                             AS call_count,
  coalesce(sum(l.prompt_tokens),0)        AS tokens_in,
  coalesce(sum(l.completion_tokens),0)    AS tokens_out,
  coalesce(sum(l.total_tokens),0)         AS tokens_total,
  coalesce(sum(l.cost_usd),0)::numeric(12,4) AS cost_usd,
  max(l.created_at)                       AS last_used_at
FROM public.roadmap_tasks t
LEFT JOIN public.ai_usage_log l ON l.task_id = t.id
GROUP BY t.id, t.sprint_id, t.title, t.status, t.module;

-- Per-sprint rollup (includes module-only attribution that didn't pin to a task)
CREATE OR REPLACE VIEW public.v_ai_cost_per_sprint
WITH (security_invoker = on) AS
WITH task_attr AS (
  SELECT t.sprint_id,
         count(l.id) AS calls,
         coalesce(sum(l.total_tokens),0) AS tokens,
         coalesce(sum(l.cost_usd),0)     AS cost
    FROM public.roadmap_tasks t
    LEFT JOIN public.ai_usage_log l ON l.task_id = t.id
   GROUP BY t.sprint_id
),
sprint_counts AS (
  SELECT s.id AS sprint_id,
         count(t.*)                                              AS task_count,
         count(*) FILTER (WHERE t.status::text IN ('done','shipped')) AS tasks_done
    FROM public.roadmap_sprints s
    LEFT JOIN public.roadmap_tasks t ON t.sprint_id = s.id
   GROUP BY s.id
)
SELECT
  s.id                                                 AS sprint_id,
  s.key                                                AS sprint_key,
  s.title                                              AS sprint_title,
  s.status::text                                       AS sprint_status,
  s."order"                                            AS sprint_order,
  sc.task_count,
  sc.tasks_done,
  coalesce(ta.calls,0)                                 AS attributed_calls,
  coalesce(ta.tokens,0)                                AS attributed_tokens,
  coalesce(ta.cost,0)::numeric(12,4)                   AS attributed_cost_usd,
  CASE WHEN sc.tasks_done > 0
       THEN (coalesce(ta.cost,0) / sc.tasks_done)::numeric(12,4)
       ELSE NULL END                                   AS cost_per_done_task_usd
FROM public.roadmap_sprints s
LEFT JOIN sprint_counts sc ON sc.sprint_id = s.id
LEFT JOIN task_attr    ta ON ta.sprint_id = s.id
ORDER BY s."order" NULLS LAST, s.created_at;