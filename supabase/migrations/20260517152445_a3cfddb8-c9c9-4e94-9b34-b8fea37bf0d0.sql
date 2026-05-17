-- 1) Relax credit_alerts so it can carry runway alerts as well as budget projections.
--    - Add `kind` column with backfill from old threshold_pct rows.
--    - Make threshold_pct nullable (runway alerts have no pct).
--    - Replace old unique (year_month, threshold_pct) with unique (year_month, kind).

ALTER TABLE public.credit_alerts
  ADD COLUMN IF NOT EXISTS kind text;

UPDATE public.credit_alerts
SET kind = 'budget_projection_' || threshold_pct::text
WHERE kind IS NULL;

ALTER TABLE public.credit_alerts
  ALTER COLUMN kind SET NOT NULL,
  ALTER COLUMN kind SET DEFAULT 'budget_projection_80';

ALTER TABLE public.credit_alerts
  DROP CONSTRAINT IF EXISTS credit_alerts_year_month_threshold_pct_key;

ALTER TABLE public.credit_alerts
  DROP CONSTRAINT IF EXISTS credit_alerts_threshold_pct_check;

ALTER TABLE public.credit_alerts
  ALTER COLUMN threshold_pct DROP NOT NULL,
  ALTER COLUMN projected_pct DROP NOT NULL,
  ALTER COLUMN burn_per_day  DROP NOT NULL,
  ALTER COLUMN budget        DROP NOT NULL;

ALTER TABLE public.credit_alerts
  ADD CONSTRAINT credit_alerts_kind_check
    CHECK (kind IN ('budget_projection_80','budget_projection_100','runway_warn','runway_critical'));

ALTER TABLE public.credit_alerts
  ADD CONSTRAINT credit_alerts_year_month_kind_key UNIQUE (year_month, kind);

-- 2) Trigger: when a roadmap_phase transitions to 'done', insert an idempotent
--    discussion_action prompting the operator to record a closing balance.

CREATE OR REPLACE FUNCTION public.tg_phase_close_balance_prompt()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  existing_id uuid;
BEGIN
  IF NEW.status = 'done'::roadmap_status
     AND (OLD.status IS DISTINCT FROM NEW.status) THEN
    -- Idempotent: skip if there's already an open prompt for this phase.
    SELECT id INTO existing_id
    FROM public.discussion_actions
    WHERE source = 'auto-credit-prompt'
      AND subject_type = 'roadmap_phase'
      AND subject_id = NEW.id
      AND status = 'open'
    LIMIT 1;

    IF existing_id IS NULL THEN
      INSERT INTO public.discussion_actions (
        subject_type, subject_id, title, details, source,
        priority, risk, night_eligible, morning_review_panel_ref
      ) VALUES (
        'roadmap_phase', NEW.id,
        'Record closing balance for phase: ' || NEW.title,
        'Phase ' || NEW.key || ' closed. Record the remaining Lovable credits ' ||
        'so we can compute drift. Open: /admin/ai-usage?phase=' || NEW.id::text || '&prompt=balance',
        'auto-credit-prompt',
        'med', 'low', true, 'credits'
      );
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_phase_close_balance_prompt ON public.roadmap_phases;
CREATE TRIGGER trg_phase_close_balance_prompt
  AFTER UPDATE OF status ON public.roadmap_phases
  FOR EACH ROW
  EXECUTE FUNCTION public.tg_phase_close_balance_prompt();

-- 3) Auto-resolve the matching discussion_action when a snapshot is recorded
--    for that phase.

CREATE OR REPLACE FUNCTION public.tg_resolve_balance_prompt_on_snapshot()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.phase_id IS NOT NULL THEN
    UPDATE public.discussion_actions
    SET status = 'done',
        updated_at = now()
    WHERE source = 'auto-credit-prompt'
      AND subject_type = 'roadmap_phase'
      AND subject_id = NEW.phase_id
      AND status = 'open';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_resolve_balance_prompt ON public.credit_balance_snapshots;
CREATE TRIGGER trg_resolve_balance_prompt
  AFTER INSERT ON public.credit_balance_snapshots
  FOR EACH ROW
  EXECUTE FUNCTION public.tg_resolve_balance_prompt_on_snapshot();

-- 4) Drift ratio views. Attribute each phase's actual (opening-closing) delta
--    to its logged categories by share-of-logged-spend.

CREATE OR REPLACE VIEW public.v_credit_drift_ratio_by_category
WITH (security_invoker=true) AS
WITH phases AS (
  SELECT phase_id, delta_credits, logged_spend
  FROM public.v_credit_phase_deltas
  WHERE delta_credits IS NOT NULL
    AND logged_spend > 0
  ORDER BY closing_at DESC
  LIMIT 8
),
per_phase_cat AS (
  SELECT e.phase_id,
         e.category::text AS category,
         SUM(e.credits) AS cat_logged
  FROM public.credit_entries e
  WHERE e.phase_id IN (SELECT phase_id FROM phases)
  GROUP BY e.phase_id, e.category
),
attributed AS (
  SELECT pc.category,
         pc.phase_id,
         pc.cat_logged,
         (pc.cat_logged / NULLIF(p.logged_spend, 0)) * p.delta_credits AS cat_actual
  FROM per_phase_cat pc
  JOIN phases p ON p.phase_id = pc.phase_id
)
SELECT category,
       COUNT(DISTINCT phase_id)::int AS phase_sample_count,
       ROUND(SUM(cat_logged), 2) AS logged_total,
       ROUND(SUM(cat_actual), 2) AS actual_total,
       CASE WHEN SUM(cat_logged) > 0
            THEN ROUND(SUM(cat_actual) / SUM(cat_logged), 4)
            ELSE NULL END AS drift_ratio,
       CASE
         WHEN COUNT(DISTINCT phase_id) >= 6 THEN 'high'
         WHEN COUNT(DISTINCT phase_id) >= 3 THEN 'medium'
         ELSE 'low'
       END AS confidence
FROM attributed
GROUP BY category;

CREATE OR REPLACE VIEW public.v_credit_drift_ratio_overall
WITH (security_invoker=true) AS
WITH phases AS (
  SELECT phase_id, delta_credits, logged_spend
  FROM public.v_credit_phase_deltas
  WHERE delta_credits IS NOT NULL
    AND logged_spend > 0
  ORDER BY closing_at DESC
  LIMIT 8
)
SELECT COUNT(*)::int AS phase_sample_count,
       ROUND(SUM(logged_spend), 2) AS logged_total,
       ROUND(SUM(delta_credits), 2) AS actual_total,
       CASE WHEN SUM(logged_spend) > 0
            THEN ROUND(SUM(delta_credits) / SUM(logged_spend), 4)
            ELSE NULL END AS drift_ratio,
       CASE
         WHEN COUNT(*) >= 6 THEN 'high'
         WHEN COUNT(*) >= 3 THEN 'medium'
         ELSE 'low'
       END AS confidence
FROM phases;

GRANT SELECT ON public.v_credit_drift_ratio_by_category TO authenticated;
GRANT SELECT ON public.v_credit_drift_ratio_overall TO authenticated;