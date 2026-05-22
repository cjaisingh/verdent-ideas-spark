-- Helper: SECURITY DEFINER reader for cron.job_run_details (cron schema is restricted)
create or replace function public.observability_cron_last_seen()
returns table(jobname text, last_seen_at timestamptz)
language sql
security definer
stable
set search_path = public, cron
as $$
  select j.jobname::text, max(jrd.start_time) as last_seen_at
  from cron.job j
  left join cron.job_run_details jrd on jrd.jobid = j.jobid
  group by j.jobname
$$;

revoke all on function public.observability_cron_last_seen() from public;
grant execute on function public.observability_cron_last_seen() to authenticated, service_role;

comment on function public.observability_cron_last_seen() is
  'Returns last start_time per pg_cron jobname. Used by v_observability_registry_status to detect cron staleness authoritatively (cron.job_run_details is the source of truth, automation_runs.job uses function names not cron schedule names).';

create or replace view public.v_observability_registry_status as
with cron_last as (
  select jobname as surface_id, last_seen_at
  from public.observability_cron_last_seen()
),
edge_last as (
  select function_name as surface_id, max(created_at) as last_seen_at
  from public.edge_request_logs
  where created_at > now() - interval '14 days'
  group by function_name
),
table_last as (
  -- hard-listed registered tables; one branch per table
  select 'resolver_decisions'::text as surface_id, max(created_at) as last_seen_at
  from public.resolver_decisions
),
last_seen as (
  select r.surface_kind, r.surface_id, cl.last_seen_at
    from public.observability_registry r
    left join cron_last cl on cl.surface_id = r.surface_id
   where r.surface_kind = 'cron'
  union all
  select r.surface_kind, r.surface_id, el.last_seen_at
    from public.observability_registry r
    left join edge_last el on el.surface_id = r.surface_id
   where r.surface_kind = 'edge_fn'
  union all
  select r.surface_kind, r.surface_id, tl.last_seen_at
    from public.observability_registry r
    left join table_last tl on tl.surface_id = r.surface_id
   where r.surface_kind = 'table'
  union all
  select r.surface_kind, r.surface_id, null::timestamptz
    from public.observability_registry r
   where r.surface_kind not in ('cron','edge_fn','table')
)
select
  r.id,
  r.surface_kind,
  r.surface_id,
  r.expected_cadence_minutes,
  r.watcher_kinds,
  r.owner,
  r.declared_in,
  ls.last_seen_at,
  case
    when coalesce(array_length(r.watcher_kinds, 1), 0) = 0
      then 'missing-watcher'
    when r.expected_cadence_minutes is not null and ls.last_seen_at is not null
         and extract(epoch from (now() - ls.last_seen_at)) / 60
             > r.expected_cadence_minutes * 3
      then 'stale'
    when ls.last_seen_at is null and r.surface_kind in ('cron','edge_fn','table')
      then 'stale'
    when r.expected_cadence_minutes is not null and ls.last_seen_at is not null
      then 'ok'
    else 'unknown'
  end as status
from public.observability_registry r
left join last_seen ls
  on ls.surface_kind = r.surface_kind and ls.surface_id = r.surface_id;

comment on view public.v_observability_registry_status is
  'Per-surface status (ok/stale/missing-watcher/unknown) for observability_registry. cron→cron.job_run_details via observability_cron_last_seen(); edge_fn→edge_request_logs; table→hard-listed (resolver_decisions today).';

-- Resolver analytics view
create or replace view public.v_resolver_decisions as
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