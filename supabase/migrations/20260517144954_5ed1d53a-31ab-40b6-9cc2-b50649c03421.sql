
DO $$ BEGIN
  CREATE TYPE public.work_category AS ENUM ('plan','build','pivot','refactor','bugfix','research','ops','other');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE public.credit_entries
  ADD COLUMN IF NOT EXISTS category public.work_category NOT NULL DEFAULT 'build';

CREATE INDEX IF NOT EXISTS idx_credit_entries_category ON public.credit_entries(category);

ALTER TABLE public.roadmap_tasks
  ADD COLUMN IF NOT EXISTS default_category public.work_category;

CREATE OR REPLACE VIEW public.v_credit_spend_by_category
WITH (security_invoker = true)
AS
WITH bounds AS (
  SELECT date_trunc('month', now()) AS month_start,
         now() - interval '30 days' AS d30_start
),
agg AS (
  SELECT
    ce.category,
    SUM(CASE WHEN ce.occurred_at >= b.month_start THEN ce.credits ELSE 0 END)::numeric AS mtd_credits,
    SUM(CASE WHEN ce.occurred_at >= b.d30_start   THEN ce.credits ELSE 0 END)::numeric AS last_30d_credits,
    COUNT(*) FILTER (WHERE ce.occurred_at >= b.d30_start) AS entry_count_30d
  FROM public.credit_entries ce, bounds b
  WHERE ce.occurred_at >= LEAST(b.month_start, b.d30_start)
  GROUP BY ce.category
),
totals AS (
  SELECT
    NULLIF(SUM(mtd_credits), 0) AS mtd_total,
    NULLIF(SUM(last_30d_credits), 0) AS d30_total
  FROM agg
)
SELECT
  a.category::text AS category,
  round(a.mtd_credits, 2)      AS mtd_credits,
  CASE WHEN t.mtd_total IS NULL THEN NULL
       ELSE round(a.mtd_credits / t.mtd_total * 100, 2) END AS mtd_pct,
  round(a.last_30d_credits, 2) AS last_30d_credits,
  CASE WHEN t.d30_total IS NULL THEN NULL
       ELSE round(a.last_30d_credits / t.d30_total * 100, 2) END AS last_30d_pct,
  a.entry_count_30d
FROM agg a, totals t
ORDER BY a.last_30d_credits DESC;

GRANT SELECT ON public.v_credit_spend_by_category TO authenticated;

COMMENT ON COLUMN public.credit_entries.category IS 'Work category for spend reporting (plan/build/pivot/refactor/bugfix/research/ops/other). Orthogonal to mode.';
COMMENT ON COLUMN public.roadmap_tasks.default_category IS 'Optional default category pre-selected in the Log Credits dialog.';
