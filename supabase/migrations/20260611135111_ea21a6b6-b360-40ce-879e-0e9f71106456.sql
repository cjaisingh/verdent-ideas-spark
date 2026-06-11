
-- #20 — fix v_resolver_decisions auto_bind_rate (band name is 'auto_bind', not 'auto')
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
  (sum((confidence_band = 'auto_bind')::int)::numeric / nullif(count(*),0))::numeric(5,4) as auto_bind_rate,
  (sum((confidence_band = 'conflict')::int)::numeric  / nullif(count(*),0))::numeric(5,4) as conflict_rate,
  (sum((confidence_band = 'no_match')::int)::numeric  / nullif(count(*),0))::numeric(5,4) as no_match_rate,
  (sum(embedding_hint_used::int)::numeric             / nullif(count(*),0))::numeric(5,4) as embedding_hint_rate,
  percentile_cont(0.50) within group (order by latency_ms)::int as p50_latency_ms,
  percentile_cont(0.95) within group (order by latency_ms)::int as p95_latency_ms,
  mode() within group (order by match_source) as top_match_source
from daily
group by tenant_id, day;

alter view public.v_resolver_decisions set (security_invoker = on);
grant select on public.v_resolver_decisions to authenticated;
comment on view public.v_resolver_decisions is
  'Per-tenant per-day resolver health: band rates (auto_bind/conflict/no_match), embedding hint usage, p50/p95 latency, top match_source.';

-- #21 — raw_records: include tenant_id in the idempotency unique
alter table public.raw_records
  drop constraint if exists raw_records_adapter_id_idempotency_key_key;
alter table public.raw_records
  add constraint raw_records_tenant_adapter_ikey_key
  unique (tenant_id, adapter_id, idempotency_key);

-- #22 — source_mappings: include tenant_id in version unique
alter table public.source_mappings
  drop constraint if exists source_mappings_adapter_id_version_key;
alter table public.source_mappings
  add constraint source_mappings_tenant_adapter_version_key
  unique (tenant_id, adapter_id, version);

-- #23 — ingested_files: dedup files with no engagement_id by sha256 alone
create unique index if not exists ingested_files_global_sha256_uk
  on public.ingested_files (sha256)
  where engagement_id is null;
