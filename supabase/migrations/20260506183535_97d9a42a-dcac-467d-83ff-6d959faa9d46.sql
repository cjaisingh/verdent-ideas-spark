CREATE TABLE public.roadmap_work_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id uuid NOT NULL REFERENCES public.roadmap_tasks(id) ON DELETE CASCADE,
  started_at timestamptz NOT NULL,
  ended_at timestamptz,
  duration_ms integer,
  tokens_in integer,
  tokens_out integer,
  tokens_total integer,
  model text,
  summary text,
  issues text,
  fixes text,
  author text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_roadmap_work_log_task ON public.roadmap_work_log(task_id, started_at DESC);

ALTER TABLE public.roadmap_work_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "operators read work_log" ON public.roadmap_work_log
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'operator'));

CREATE POLICY "operators write work_log" ON public.roadmap_work_log
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'operator'))
  WITH CHECK (public.has_role(auth.uid(), 'operator'));

ALTER PUBLICATION supabase_realtime ADD TABLE public.roadmap_work_log;