CREATE TABLE public.gh_actions_runs (
  run_id bigint PRIMARY KEY,
  workflow text NOT NULL,
  branch text NOT NULL,
  sha text NOT NULL,
  conclusion text NOT NULL,
  html_url text NOT NULL,
  run_started_at timestamptz NOT NULL,
  seen_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz
);

GRANT SELECT ON public.gh_actions_runs TO authenticated;
GRANT ALL ON public.gh_actions_runs TO service_role;

ALTER TABLE public.gh_actions_runs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "operators read gh_actions_runs"
  ON public.gh_actions_runs
  FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'operator'));

CREATE INDEX gh_actions_runs_workflow_started_idx
  ON public.gh_actions_runs(workflow, run_started_at DESC);

CREATE INDEX gh_actions_runs_open_idx
  ON public.gh_actions_runs(resolved_at)
  WHERE resolved_at IS NULL;