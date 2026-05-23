ALTER TABLE public.roadmap_work_log
  ADD COLUMN IF NOT EXISTS session_id uuid;

CREATE UNIQUE INDEX IF NOT EXISTS roadmap_work_log_session_task_uniq
  ON public.roadmap_work_log(session_id, task_id)
  WHERE session_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_roadmap_work_log_session
  ON public.roadmap_work_log(session_id)
  WHERE session_id IS NOT NULL;