
ALTER TABLE public.plan_workstreams
  ADD COLUMN IF NOT EXISTS est_human_hours numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS est_ai_build_usd numeric NOT NULL DEFAULT 0;

COMMENT ON COLUMN public.plan_workstreams.est_human_hours IS 'Estimated hours a human engineer would take to build this workstream end-to-end.';
COMMENT ON COLUMN public.plan_workstreams.est_ai_build_usd IS 'Estimated USD spent on AI/Lovable to build this workstream (one-shot dev cost, separate from runtime cost_estimates).';
