
-- Code review findings
CREATE TABLE public.roadmap_review_findings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  reviewed_at timestamptz NOT NULL DEFAULT now(),
  reviewer_model text NOT NULL,
  severity text NOT NULL DEFAULT 'info',
  category text,
  area text,
  title text NOT NULL,
  body text,
  diff_window_start timestamptz,
  diff_window_end timestamptz,
  acknowledged boolean NOT NULL DEFAULT false
);
ALTER TABLE public.roadmap_review_findings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "operators read review_findings" ON public.roadmap_review_findings
  FOR SELECT TO authenticated USING (has_role(auth.uid(), 'operator'::app_role));
CREATE POLICY "operators update review_findings" ON public.roadmap_review_findings
  FOR UPDATE TO authenticated USING (has_role(auth.uid(), 'operator'::app_role))
  WITH CHECK (has_role(auth.uid(), 'operator'::app_role));
ALTER TABLE public.roadmap_review_findings REPLICA IDENTITY FULL;
ALTER PUBLICATION supabase_realtime ADD TABLE public.roadmap_review_findings;

-- Test runs
CREATE TABLE public.test_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  suite text NOT NULL,
  status text NOT NULL,
  total integer,
  passed integer,
  failed integer,
  skipped integer,
  duration_ms integer,
  commit_sha text,
  branch text,
  workflow_run_url text,
  detail jsonb NOT NULL DEFAULT '{}'::jsonb
);
ALTER TABLE public.test_runs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "operators read test_runs" ON public.test_runs
  FOR SELECT TO authenticated USING (has_role(auth.uid(), 'operator'::app_role));
CREATE POLICY "no client write test_runs" ON public.test_runs
  FOR ALL TO authenticated USING (false) WITH CHECK (false);
ALTER TABLE public.test_runs REPLICA IDENTITY FULL;
ALTER PUBLICATION supabase_realtime ADD TABLE public.test_runs;

-- QA checks (one row per phase success criterion)
CREATE TABLE public.qa_checks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  phase_key text NOT NULL,
  criterion text NOT NULL,
  kind text NOT NULL DEFAULT 'judgement',
  probe text,
  status text NOT NULL DEFAULT 'unknown',
  last_checked_at timestamptz,
  note text,
  UNIQUE (phase_key, criterion)
);
ALTER TABLE public.qa_checks ENABLE ROW LEVEL SECURITY;
CREATE POLICY "operators read qa_checks" ON public.qa_checks
  FOR SELECT TO authenticated USING (has_role(auth.uid(), 'operator'::app_role));
CREATE POLICY "operators write qa_checks" ON public.qa_checks
  FOR ALL TO authenticated USING (has_role(auth.uid(), 'operator'::app_role))
  WITH CHECK (has_role(auth.uid(), 'operator'::app_role));
CREATE TRIGGER qa_checks_updated_at BEFORE UPDATE ON public.qa_checks
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
ALTER TABLE public.qa_checks REPLICA IDENTITY FULL;
ALTER PUBLICATION supabase_realtime ADD TABLE public.qa_checks;

-- Ensure pg_cron + pg_net for scheduled invocation
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;
