DROP INDEX IF EXISTS public.roadmap_work_log_session_task_uniq;

CREATE UNIQUE INDEX roadmap_work_log_session_task_uniq
  ON public.roadmap_work_log(session_id, task_id);