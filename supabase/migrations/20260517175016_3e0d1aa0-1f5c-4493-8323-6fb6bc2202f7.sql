
-- 1. Columns on credit_balance_snapshots
ALTER TABLE public.credit_balance_snapshots
  ADD COLUMN IF NOT EXISTS label text,
  ADD COLUMN IF NOT EXISTS subject_type text,
  ADD COLUMN IF NOT EXISTS subject_id uuid;

ALTER TABLE public.credit_balance_snapshots
  DROP CONSTRAINT IF EXISTS credit_balance_snapshots_subject_type_chk;
ALTER TABLE public.credit_balance_snapshots
  ADD CONSTRAINT credit_balance_snapshots_subject_type_chk
  CHECK (subject_type IS NULL OR subject_type IN ('roadmap_phase','discussion_action','roadmap_task','dev_turn','manual'));

-- Trigger: derive subject_type/subject_id from phase_id when not provided.
CREATE OR REPLACE FUNCTION public.fill_credit_snapshot_subject()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
  IF NEW.subject_type IS NULL AND NEW.phase_id IS NOT NULL THEN
    NEW.subject_type := 'roadmap_phase';
    NEW.subject_id := NEW.phase_id;
  ELSIF NEW.subject_type IS NULL THEN
    NEW.subject_type := 'manual';
  END IF;
  -- Keep phase_id <-> subject in sync when subject is a phase
  IF NEW.subject_type = 'roadmap_phase' AND NEW.phase_id IS NULL AND NEW.subject_id IS NOT NULL THEN
    NEW.phase_id := NEW.subject_id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_fill_credit_snapshot_subject ON public.credit_balance_snapshots;
CREATE TRIGGER trg_fill_credit_snapshot_subject
  BEFORE INSERT OR UPDATE ON public.credit_balance_snapshots
  FOR EACH ROW EXECUTE FUNCTION public.fill_credit_snapshot_subject();

-- 2. Per-snapshot delta + drift view
CREATE OR REPLACE VIEW public.v_credit_snapshot_deltas
WITH (security_invoker = true)
AS
WITH ordered AS (
  SELECT
    s.id,
    s.balance_credits,
    s.as_of,
    s.phase_id,
    s.subject_type,
    s.subject_id,
    s.label,
    s.source,
    s.note,
    LAG(s.balance_credits) OVER (ORDER BY s.as_of) AS prev_balance,
    LAG(s.as_of)           OVER (ORDER BY s.as_of) AS prev_as_of
  FROM public.credit_balance_snapshots s
),
with_logged AS (
  SELECT
    o.*,
    COALESCE((
      SELECT SUM(e.credits)
      FROM public.credit_entries e
      WHERE e.occurred_at > o.prev_as_of
        AND e.occurred_at <= o.as_of
    ), 0)::numeric(12,2) AS logged_credits_in_window
  FROM ordered o
  WHERE o.prev_as_of IS NOT NULL
)
SELECT
  w.id,
  w.as_of,
  w.prev_as_of,
  w.balance_credits,
  w.prev_balance,
  (w.prev_balance - w.balance_credits)::numeric(12,2) AS delta_credits,
  w.logged_credits_in_window,
  ((w.prev_balance - w.balance_credits) - w.logged_credits_in_window)::numeric(12,2) AS drift_credits,
  CASE
    WHEN w.logged_credits_in_window = 0 THEN NULL
    ELSE ((w.prev_balance - w.balance_credits) / w.logged_credits_in_window)::numeric(10,3)
  END AS drift_ratio,
  CASE
    WHEN w.logged_credits_in_window = 0 THEN 'no-logged'
    WHEN ABS(((w.prev_balance - w.balance_credits) / w.logged_credits_in_window) - 1) <= 0.10 THEN 'match'
    WHEN (w.prev_balance - w.balance_credits) < w.logged_credits_in_window THEN 'over-logged'
    ELSE 'under-logged'
  END AS drift_band,
  w.phase_id,
  w.subject_type,
  w.subject_id,
  w.label,
  w.source,
  w.note
FROM with_logged w
ORDER BY w.as_of DESC;

-- 3. Latest snapshot age view (single row)
CREATE OR REPLACE VIEW public.v_credit_snapshot_latest_age
WITH (security_invoker = true)
AS
WITH latest AS (
  SELECT MAX(as_of) AS as_of FROM public.credit_balance_snapshots
)
SELECT
  l.as_of AS latest_as_of,
  CASE WHEN l.as_of IS NULL THEN NULL
       ELSE EXTRACT(EPOCH FROM (now() - l.as_of))/60.0
  END::numeric(12,2) AS minutes_since_latest,
  (SELECT COUNT(*) FROM public.credit_balance_snapshots
    WHERE as_of >= now() - interval '24 hours') AS snapshots_24h,
  (SELECT COUNT(*) FROM public.credit_entries
    WHERE l.as_of IS NULL OR occurred_at > l.as_of) AS entries_since_latest
FROM latest l;
