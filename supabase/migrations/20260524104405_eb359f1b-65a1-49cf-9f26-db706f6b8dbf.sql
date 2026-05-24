
CREATE OR REPLACE VIEW public.v_resolver_decisions_summary
WITH (security_invoker = true) AS
WITH base AS (
  SELECT * FROM public.resolver_decisions
  WHERE created_at > now() - interval '7 days'
),
totals AS (
  SELECT
    count(*)::int AS total,
    count(*) FILTER (WHERE confidence_band='high')::int   AS band_high,
    count(*) FILTER (WHERE confidence_band='medium')::int AS band_medium,
    count(*) FILTER (WHERE confidence_band='low')::int    AS band_low,
    count(*) FILTER (WHERE confidence_band='none')::int   AS band_none,
    count(*) FILTER (WHERE winning_node_id IS NOT NULL)::int AS hits,
    percentile_cont(0.5) WITHIN GROUP (ORDER BY latency_ms) AS p50_latency_ms,
    percentile_cont(0.95) WITHIN GROUP (ORDER BY latency_ms) AS p95_latency_ms
  FROM base
),
top_kinds AS (
  SELECT jsonb_agg(jsonb_build_object('kind', kind, 'count', c) ORDER BY c DESC) AS kinds
  FROM (
    SELECT d->>'kind' AS kind, count(*)::int AS c
    FROM base, jsonb_array_elements(descriptors) AS d
    GROUP BY 1
    ORDER BY 2 DESC
    LIMIT 10
  ) t
)
SELECT
  t.total, t.hits,
  t.band_high, t.band_medium, t.band_low, t.band_none,
  t.p50_latency_ms, t.p95_latency_ms,
  COALESCE(k.kinds, '[]'::jsonb) AS top_descriptor_kinds,
  now() AS computed_at
FROM totals t LEFT JOIN top_kinds k ON true;

GRANT SELECT ON public.v_resolver_decisions_summary TO authenticated;

INSERT INTO public.observability_registry
  (surface_kind, surface_id, expected_cadence_minutes, watcher_kinds, owner, notes, declared_in)
VALUES
  ('table', 'resolver_decisions', 1440,
   ARRAY['observability_stale_surface'],
   'phase-5/resolver',
   'Fires medium if zero resolver_decisions writes in 24h (only meaningful once a tenant is live).',
   'mem://features/entity-resolver')
ON CONFLICT DO NOTHING;
