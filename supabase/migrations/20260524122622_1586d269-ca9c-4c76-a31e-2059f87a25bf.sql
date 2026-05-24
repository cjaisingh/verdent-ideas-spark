
drop view if exists public.v_resolver_decisions cascade;
create view public.v_resolver_decisions as
with daily as (
  select
    tenant_id,
    date_trunc('day', created_at)::date as day,
    confidence_band,
    match_source,
    embedding_hint_used,
    latency_ms
  from public.resolver_decisions
)
select
  tenant_id,
  day,
  count(*)::int as total,
  (sum((confidence_band = 'auto')::int)::numeric    / nullif(count(*),0))::numeric(5,4) as auto_bind_rate,
  (sum((confidence_band = 'conflict')::int)::numeric/ nullif(count(*),0))::numeric(5,4) as conflict_rate,
  (sum((confidence_band = 'no_match')::int)::numeric/ nullif(count(*),0))::numeric(5,4) as no_match_rate,
  (sum(embedding_hint_used::int)::numeric           / nullif(count(*),0))::numeric(5,4) as embedding_hint_rate,
  percentile_cont(0.50) within group (order by latency_ms)::int as p50_latency_ms,
  percentile_cont(0.95) within group (order by latency_ms)::int as p95_latency_ms,
  mode() within group (order by match_source) as top_match_source
from daily
group by tenant_id, day;

comment on view public.v_resolver_decisions is
  'Per-tenant per-day resolver health: band rates, embedding hint usage, p50/p95 latency, top match_source. Reads resolver_decisions audit log.';
