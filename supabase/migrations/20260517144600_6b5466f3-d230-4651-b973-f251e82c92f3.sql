
CREATE OR REPLACE VIEW public.v_credit_projection
WITH (security_invoker = true)
AS
WITH now_ts AS (
  SELECT
    date_trunc('month', now()) AS month_start,
    (date_trunc('month', now()) + interval '1 month') AS month_end,
    now() AS ts,
    to_char(now(), 'YYYY-MM') AS year_month
),
mtd AS (
  SELECT
    COALESCE(SUM(credits), 0)::numeric AS mtd_credits,
    COALESCE(SUM(CASE WHEN source = 'manual' THEN credits END), 0)::numeric AS mtd_manual,
    COALESCE(SUM(CASE WHEN source = 'proxy'  THEN credits END), 0)::numeric AS mtd_proxy
  FROM public.v_credit_burn_per_step, now_ts
  WHERE occurred_at >= now_ts.month_start
    AND occurred_at <  now_ts.month_end
),
burn AS (
  SELECT
    COALESCE(SUM(CASE WHEN occurred_at >= now() - interval '14 days' THEN credits END), 0)::numeric / 14.0 AS burn_14d_per_day,
    COALESCE(SUM(CASE WHEN occurred_at >= now() - interval '21 days' THEN credits END), 0)::numeric / 21.0 AS burn_21d_per_day,
    COALESCE(SUM(CASE WHEN occurred_at >= now() - interval '30 days' THEN credits END), 0)::numeric / 30.0 AS burn_30d_per_day
  FROM public.v_credit_burn_per_step
  WHERE occurred_at >= now() - interval '30 days'
),
cfg AS (
  SELECT monthly_budget_credits AS budget FROM public.credit_settings WHERE id = true
)
SELECT
  n.year_month,
  EXTRACT(day FROM (n.month_end - interval '1 day'))::int AS days_in_month,
  EXTRACT(day FROM n.ts)::int AS days_elapsed,
  GREATEST(0, EXTRACT(day FROM (n.month_end - n.ts))::int) AS days_left,
  round(m.mtd_credits, 2)  AS mtd_credits,
  round(m.mtd_manual, 2)   AS mtd_manual,
  round(m.mtd_proxy, 2)    AS mtd_proxy,
  round(b.burn_14d_per_day, 2) AS burn_14d_per_day,
  round(b.burn_21d_per_day, 2) AS burn_21d_per_day,
  round(b.burn_30d_per_day, 2) AS burn_30d_per_day,
  round(m.mtd_credits + b.burn_14d_per_day * GREATEST(0, EXTRACT(day FROM (n.month_end - n.ts))::int), 2) AS projected_eom_14d,
  round(m.mtd_credits + b.burn_21d_per_day * GREATEST(0, EXTRACT(day FROM (n.month_end - n.ts))::int), 2) AS projected_eom_21d,
  round(m.mtd_credits + b.burn_30d_per_day * GREATEST(0, EXTRACT(day FROM (n.month_end - n.ts))::int), 2) AS projected_eom_30d,
  c.budget,
  CASE WHEN c.budget IS NULL OR c.budget = 0 THEN NULL
       ELSE round((m.mtd_credits + b.burn_14d_per_day * GREATEST(0, EXTRACT(day FROM (n.month_end - n.ts))::int)) / c.budget * 100, 2)
  END AS projected_pct_14d,
  CASE WHEN c.budget IS NULL OR c.budget = 0 THEN NULL
       ELSE round((m.mtd_credits + b.burn_21d_per_day * GREATEST(0, EXTRACT(day FROM (n.month_end - n.ts))::int)) / c.budget * 100, 2)
  END AS projected_pct_21d,
  CASE WHEN c.budget IS NULL OR c.budget = 0 THEN NULL
       ELSE round((m.mtd_credits + b.burn_30d_per_day * GREATEST(0, EXTRACT(day FROM (n.month_end - n.ts))::int)) / c.budget * 100, 2)
  END AS projected_pct_30d
FROM now_ts n, mtd m, burn b, cfg c;

GRANT SELECT ON public.v_credit_projection TO authenticated;

COMMENT ON VIEW public.v_credit_projection IS
  'EOM credit projection from rolling 14/21/30d windows. Security invoker — gated by underlying v_credit_burn_per_step / credit_settings RLS (operator-only).';
