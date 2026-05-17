
CREATE TABLE public.tool_policy_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  precedence int NOT NULL DEFAULT 100,
  task_types text[] NOT NULL DEFAULT '{}',
  phase_ids uuid[],
  min_credits_remaining_pct int CHECK (min_credits_remaining_pct BETWEEN 0 AND 100),
  max_credits_remaining_pct int CHECK (max_credits_remaining_pct BETWEEN 0 AND 100),
  min_burn_rate_per_day numeric(10,2),
  recommended_tool text NOT NULL CHECK (recommended_tool IN ('lovable','claude','cursor','codex','manual')),
  reasoning text NOT NULL DEFAULT '',
  enabled boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_tool_policy_rules_prec ON public.tool_policy_rules (precedence) WHERE enabled;

ALTER TABLE public.tool_policy_rules ENABLE ROW LEVEL SECURITY;
CREATE POLICY "operators read tool_policy_rules" ON public.tool_policy_rules
  FOR SELECT TO authenticated USING (has_role(auth.uid(),'operator'::app_role));
CREATE POLICY "operators write tool_policy_rules" ON public.tool_policy_rules
  FOR ALL TO authenticated
  USING (has_role(auth.uid(),'operator'::app_role))
  WITH CHECK (has_role(auth.uid(),'operator'::app_role));
ALTER PUBLICATION supabase_realtime ADD TABLE public.tool_policy_rules;

CREATE TRIGGER trg_tool_policy_rules_updated
  BEFORE UPDATE ON public.tool_policy_rules
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TABLE public.tool_policy_recommendations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  operator_id uuid,
  task_type text NOT NULL,
  phase_id uuid REFERENCES public.roadmap_phases(id) ON DELETE SET NULL,
  credits_remaining_pct numeric(6,2),
  burn_rate_per_day numeric(10,2),
  chosen_tool text NOT NULL,
  chosen_rule_id uuid REFERENCES public.tool_policy_rules(id) ON DELETE SET NULL,
  score_breakdown jsonb NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX idx_tool_policy_rec_created ON public.tool_policy_recommendations (created_at DESC);

ALTER TABLE public.tool_policy_recommendations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "operators read tool_policy_recs" ON public.tool_policy_recommendations
  FOR SELECT TO authenticated USING (has_role(auth.uid(),'operator'::app_role));
CREATE POLICY "operators insert tool_policy_recs" ON public.tool_policy_recommendations
  FOR INSERT TO authenticated WITH CHECK (has_role(auth.uid(),'operator'::app_role));

CREATE OR REPLACE VIEW public.v_tool_policy_signals
WITH (security_invoker = true) AS
WITH mtd AS (
  SELECT COALESCE(SUM(credits),0)::numeric AS mtd_credits
  FROM public.v_credit_burn_per_step
  WHERE occurred_at >= date_trunc('month', now())
),
burn AS (
  SELECT COALESCE(SUM(credits),0)::numeric / 7.0 AS burn_per_day
  FROM public.v_credit_burn_per_step
  WHERE occurred_at >= now() - interval '7 days'
),
cfg AS (
  SELECT monthly_budget_credits FROM public.credit_settings WHERE id = true
)
SELECT
  mtd.mtd_credits,
  cfg.monthly_budget_credits AS budget,
  CASE
    WHEN cfg.monthly_budget_credits IS NULL OR cfg.monthly_budget_credits = 0 THEN NULL
    ELSE GREATEST(0, ROUND(((cfg.monthly_budget_credits - mtd.mtd_credits) / cfg.monthly_budget_credits * 100)::numeric, 2))
  END AS remaining_pct,
  ROUND(burn.burn_per_day, 2) AS burn_7d_per_day,
  ROUND(burn.burn_per_day * 30, 2) AS projected_month_end
FROM mtd, burn, cfg;

INSERT INTO public.tool_policy_rules (precedence, name, task_types, max_credits_remaining_pct, min_burn_rate_per_day, min_credits_remaining_pct, recommended_tool, reasoning) VALUES
  (10, 'Critical credit conservation', '{}', 15, NULL, NULL, 'claude', 'Lovable credits ≤15% remaining. Use Claude Max (flat fee) until next billing cycle.'),
  (20, 'UI tweaks stay on Lovable', ARRAY['ui_tweak'], NULL, NULL, NULL, 'lovable', 'Visual preview + design tokens make Lovable cheaper end-to-end for UI work.'),
  (30, 'Migrations + edge fns on Lovable', ARRAY['migration','edge_fn'], NULL, NULL, NULL, 'lovable', 'Managed migration runner + auto-deploy. Doing this elsewhere means manual deploy steps.'),
  (40, 'Bulk refactor → Claude', ARRAY['refactor'], NULL, 5, NULL, 'claude', 'Refactors burn many messages iterating on logic. Claude Code in terminal is flat-fee for this.'),
  (50, 'Tests + docs → Claude', ARRAY['tests','docs'], NULL, NULL, NULL, 'claude', 'No preview value. Claude handles long-form text/test generation cheaply.'),
  (60, 'Pure logic when squeezed → Claude', ARRAY['pure_logic'], 40, NULL, NULL, 'claude', 'Below 40% credits remaining, push pure-logic work to Claude to preserve runway.'),
  (70, 'New feature default → Lovable', ARRAY['new_feature'], NULL, NULL, NULL, 'lovable', 'New surfaces benefit from preview + Cloud scaffolding.'),
  (999, 'Fallback', '{}', NULL, NULL, NULL, 'lovable', 'No specific rule matched. Default to Lovable.');
