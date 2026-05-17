
-- Snapshots table
CREATE TABLE public.credit_balance_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  balance_credits numeric(12,2) NOT NULL CHECK (balance_credits >= 0),
  as_of timestamptz NOT NULL DEFAULT now(),
  phase_id uuid REFERENCES public.roadmap_phases(id) ON DELETE SET NULL,
  source text,
  note text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_credit_balance_snapshots_as_of ON public.credit_balance_snapshots (as_of DESC);
CREATE INDEX idx_credit_balance_snapshots_phase ON public.credit_balance_snapshots (phase_id, as_of DESC);

ALTER TABLE public.credit_balance_snapshots ENABLE ROW LEVEL SECURITY;

CREATE POLICY "operators read credit_balance_snapshots"
  ON public.credit_balance_snapshots FOR SELECT TO authenticated
  USING (has_role(auth.uid(), 'operator'::app_role));

CREATE POLICY "operators insert credit_balance_snapshots"
  ON public.credit_balance_snapshots FOR INSERT TO authenticated
  WITH CHECK (has_role(auth.uid(), 'operator'::app_role));

CREATE POLICY "operators update credit_balance_snapshots"
  ON public.credit_balance_snapshots FOR UPDATE TO authenticated
  USING (has_role(auth.uid(), 'operator'::app_role))
  WITH CHECK (has_role(auth.uid(), 'operator'::app_role));

CREATE POLICY "operators delete credit_balance_snapshots"
  ON public.credit_balance_snapshots FOR DELETE TO authenticated
  USING (has_role(auth.uid(), 'operator'::app_role));

ALTER PUBLICATION supabase_realtime ADD TABLE public.credit_balance_snapshots;

-- Latest snapshot view
CREATE OR REPLACE VIEW public.v_credit_balance_latest
WITH (security_invoker = true)
AS
SELECT id, balance_credits, as_of, phase_id, source, note
FROM public.credit_balance_snapshots
ORDER BY as_of DESC
LIMIT 1;

-- Runway view
CREATE OR REPLACE VIEW public.v_credit_runway
WITH (security_invoker = true)
AS
WITH latest AS (
  SELECT balance_credits, as_of FROM public.v_credit_balance_latest
),
spent AS (
  SELECT COALESCE(SUM(s.credits), 0)::numeric AS spent_since
  FROM public.v_credit_burn_per_step s, latest l
  WHERE s.occurred_at >= l.as_of
),
burn AS (
  SELECT
    (COALESCE(SUM(CASE WHEN s.occurred_at >= now() - interval '7 days' THEN s.credits END), 0) / 7.0)::numeric AS bpd_7d,
    (COALESCE(SUM(CASE WHEN s.occurred_at >= now() - interval '21 days' THEN s.credits END), 0) / 21.0)::numeric AS bpd_21d
  FROM public.v_credit_burn_per_step s
  WHERE s.occurred_at >= now() - interval '21 days'
)
SELECT
  l.balance_credits AS balance,
  l.as_of,
  ROUND(sp.spent_since, 2) AS spent_since_as_of,
  ROUND(GREATEST(l.balance_credits - sp.spent_since, 0), 2) AS estimated_balance_now,
  ROUND(b.bpd_7d, 2) AS burn_per_day_7d,
  ROUND(b.bpd_21d, 2) AS burn_per_day_21d,
  CASE WHEN b.bpd_21d > 0
    THEN ROUND(GREATEST(l.balance_credits - sp.spent_since, 0) / b.bpd_21d, 1)
    ELSE NULL END AS days_runway_21d,
  CASE WHEN b.bpd_7d > 0
    THEN ROUND(GREATEST(l.balance_credits - sp.spent_since, 0) / b.bpd_7d, 1)
    ELSE NULL END AS days_runway_7d,
  CASE WHEN b.bpd_21d > 0
    THEN (now() + (GREATEST(l.balance_credits - sp.spent_since, 0) / b.bpd_21d) * interval '1 day')
    ELSE NULL END AS runway_exhaustion_date_21d
FROM latest l, spent sp, burn b;

-- Per-phase deltas
CREATE OR REPLACE VIEW public.v_credit_phase_deltas
WITH (security_invoker = true)
AS
WITH closing AS (
  -- Most recent snapshot tagged with a phase = "closing" reading for that phase
  SELECT DISTINCT ON (phase_id)
    phase_id, balance_credits AS closing_balance, as_of AS closing_at
  FROM public.credit_balance_snapshots
  WHERE phase_id IS NOT NULL
  ORDER BY phase_id, as_of DESC
),
opening AS (
  -- Latest snapshot strictly before that closing
  SELECT c.phase_id,
    (SELECT s.balance_credits FROM public.credit_balance_snapshots s
     WHERE s.as_of < c.closing_at ORDER BY s.as_of DESC LIMIT 1) AS opening_balance,
    (SELECT s.as_of FROM public.credit_balance_snapshots s
     WHERE s.as_of < c.closing_at ORDER BY s.as_of DESC LIMIT 1) AS opening_at
  FROM closing c
),
logged AS (
  SELECT s.phase_id, COALESCE(SUM(s.credits), 0)::numeric AS logged_spend
  FROM public.v_credit_burn_per_step s
  WHERE s.phase_id IS NOT NULL
  GROUP BY s.phase_id
)
SELECT
  p.id AS phase_id,
  p.key AS phase_key,
  p.title AS phase_title,
  p.status AS phase_status,
  o.opening_balance,
  o.opening_at,
  c.closing_balance,
  c.closing_at,
  CASE WHEN o.opening_balance IS NOT NULL
    THEN ROUND(o.opening_balance - c.closing_balance, 2) END AS delta_credits,
  COALESCE(ROUND(l.logged_spend, 2), 0) AS logged_spend,
  CASE WHEN o.opening_balance IS NOT NULL
    THEN ROUND((o.opening_balance - c.closing_balance) - COALESCE(l.logged_spend, 0), 2)
    END AS unaccounted_credits
FROM closing c
JOIN public.roadmap_phases p ON p.id = c.phase_id
LEFT JOIN opening o ON o.phase_id = c.phase_id
LEFT JOIN logged l ON l.phase_id = c.phase_id
ORDER BY c.closing_at DESC;

-- Phases closed without a snapshot yet
CREATE OR REPLACE VIEW public.v_phases_awaiting_balance
WITH (security_invoker = true)
AS
SELECT
  p.id AS phase_id,
  p.key AS phase_key,
  p.title AS phase_title,
  p.updated_at AS closed_at,
  EXTRACT(EPOCH FROM (now() - p.updated_at)) / 3600.0 AS hours_since_close
FROM public.roadmap_phases p
WHERE p.status = 'done'
  AND p.updated_at >= now() - interval '14 days'
  AND NOT EXISTS (
    SELECT 1 FROM public.credit_balance_snapshots s WHERE s.phase_id = p.id
  )
ORDER BY p.updated_at DESC;
