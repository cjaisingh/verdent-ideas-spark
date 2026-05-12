
-- Browser-side network failures (the "Failed to fetch" class — never reach the server).
CREATE TABLE IF NOT EXISTS public.client_error_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  function_name text,
  url text,
  message text NOT NULL,
  request_id text,
  user_agent text,
  user_id_hash text,
  meta jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_client_error_log_created ON public.client_error_log (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_client_error_log_fn ON public.client_error_log (function_name, created_at DESC);

ALTER TABLE public.client_error_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "operators read client errors" ON public.client_error_log;
CREATE POLICY "operators read client errors" ON public.client_error_log
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(),'operator') OR public.has_role(auth.uid(),'admin'));

-- Beacon endpoint inserts with service role; no public insert policy needed.

-- Aggregate health view (RPC).
CREATE OR REPLACE FUNCTION public.edge_function_health(_hours integer DEFAULT 24)
RETURNS TABLE(
  function_name text,
  total bigint,
  errors bigint,
  error_rate numeric,
  p95_latency_ms numeric,
  last_error_at timestamptz,
  last_error_status integer,
  last_error_class text,
  last_error_message text
)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  cutoff timestamptz := now() - (GREATEST(LEAST(_hours, 168), 1) || ' hours')::interval;
BEGIN
  IF NOT (public.has_role(auth.uid(),'operator') OR public.has_role(auth.uid(),'admin')) THEN
    RAISE EXCEPTION 'not authorized';
  END IF;
  RETURN QUERY
  WITH base AS (
    SELECT l.function_name, l.status, l.latency_ms, l.classified_error, l.error_message, l.created_at
    FROM public.edge_request_logs l
    WHERE l.created_at >= cutoff
  ),
  agg AS (
    SELECT
      b.function_name,
      count(*)::bigint AS total,
      count(*) FILTER (WHERE b.status >= 500)::bigint AS errors,
      ROUND(
        (count(*) FILTER (WHERE b.status >= 500)::numeric)
          / NULLIF(count(*),0)::numeric, 4
      ) AS error_rate,
      ROUND(
        percentile_cont(0.95) WITHIN GROUP (ORDER BY b.latency_ms)::numeric, 1
      ) AS p95_latency_ms
    FROM base b
    GROUP BY b.function_name
  ),
  last_err AS (
    SELECT DISTINCT ON (b.function_name)
      b.function_name, b.created_at AS last_error_at,
      b.status AS last_error_status,
      b.classified_error AS last_error_class,
      LEFT(b.error_message, 240) AS last_error_message
    FROM base b
    WHERE b.status >= 400
    ORDER BY b.function_name, b.created_at DESC
  )
  SELECT a.function_name, a.total, a.errors, a.error_rate, a.p95_latency_ms,
         le.last_error_at, le.last_error_status, le.last_error_class, le.last_error_message
  FROM agg a
  LEFT JOIN last_err le USING (function_name)
  ORDER BY a.errors DESC, a.total DESC;
END;
$$;
