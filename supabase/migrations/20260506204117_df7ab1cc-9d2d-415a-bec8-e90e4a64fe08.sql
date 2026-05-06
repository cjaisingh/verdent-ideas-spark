CREATE TABLE public.automation_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  job text NOT NULL,
  trigger text NOT NULL DEFAULT 'manual',
  status text NOT NULL,
  status_code integer,
  duration_ms integer,
  message text,
  detail jsonb NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX automation_runs_job_created_idx ON public.automation_runs (job, created_at DESC);
ALTER TABLE public.automation_runs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "operators read automation_runs" ON public.automation_runs
  FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'operator'::app_role));
CREATE POLICY "no client write automation_runs" ON public.automation_runs
  FOR ALL TO authenticated USING (false) WITH CHECK (false);
ALTER PUBLICATION supabase_realtime ADD TABLE public.automation_runs;