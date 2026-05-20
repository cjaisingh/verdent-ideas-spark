CREATE TABLE public.sentinel_check_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  tick_id uuid NOT NULL,
  check_key text NOT NULL,
  duration_ms integer NOT NULL DEFAULT 0,
  candidates_emitted integer NOT NULL DEFAULT 0,
  alerts_dispatched integer NOT NULL DEFAULT 0,
  alert_retries integer NOT NULL DEFAULT 0,
  open_depth_after integer NOT NULL DEFAULT 0,
  error text
);

CREATE INDEX idx_scr_key_created ON public.sentinel_check_runs (check_key, created_at DESC);
CREATE INDEX idx_scr_tick ON public.sentinel_check_runs (tick_id);
CREATE INDEX idx_scr_created ON public.sentinel_check_runs (created_at DESC);

ALTER TABLE public.sentinel_check_runs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Operators read sentinel_check_runs"
ON public.sentinel_check_runs FOR SELECT TO authenticated
USING (public.has_role(auth.uid(), 'operator'::app_role));

CREATE POLICY "Service can write sentinel_check_runs"
ON public.sentinel_check_runs FOR INSERT TO service_role
WITH CHECK (true);

ALTER PUBLICATION supabase_realtime ADD TABLE public.sentinel_check_runs;

CREATE OR REPLACE VIEW public.v_sentinel_check_perf_24h
WITH (security_invoker = on) AS
SELECT
  check_key,
  count(*)::int                                                       AS runs,
  count(*) FILTER (WHERE error IS NOT NULL)::int                      AS errors,
  COALESCE(percentile_cont(0.5) WITHIN GROUP (ORDER BY duration_ms), 0)::int AS p50_ms,
  COALESCE(percentile_cont(0.95) WITHIN GROUP (ORDER BY duration_ms), 0)::int AS p95_ms,
  COALESCE(max(duration_ms), 0)::int                                  AS max_ms,
  COALESCE(sum(candidates_emitted), 0)::int                           AS total_candidates,
  COALESCE(sum(alerts_dispatched), 0)::int                            AS total_alerts,
  COALESCE(sum(alert_retries), 0)::int                                AS total_retries,
  COALESCE(avg(open_depth_after), 0)::numeric(10,2)                   AS avg_open_depth,
  max(created_at)                                                     AS last_run_at
FROM public.sentinel_check_runs
WHERE created_at >= now() - interval '24 hours'
GROUP BY check_key;

GRANT SELECT ON public.v_sentinel_check_perf_24h TO authenticated;