-- 1. Config table
create table if not exists public.table_surface_probes (
  surface_id text primary key,
  table_name text not null,
  freshness_column text not null default 'created_at',
  filter_expr text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.table_surface_probes enable row level security;

create policy "operators read probes"
on public.table_surface_probes for select
to authenticated
using (public.has_role(auth.uid(), 'operator'));

create policy "operators write probes"
on public.table_surface_probes for all
to authenticated
using (public.has_role(auth.uid(), 'operator'))
with check (public.has_role(auth.uid(), 'operator'));

create trigger trg_table_surface_probes_updated
before update on public.table_surface_probes
for each row execute function public.update_updated_at_column();

-- 2. Seed probes (preserves existing resolver_decisions behaviour + closes the 3 unknowns)
insert into public.table_surface_probes (surface_id, table_name, freshness_column, filter_expr, notes) values
  ('resolver_decisions', 'resolver_decisions', 'created_at', null, 'Truth-arbitration writes; existed as hard-coded CASE before this migration'),
  ('adr_bench_results:adr-0003', 'adr_bench_results', 'created_at', 'adr_id = ''adr-0003''', 'Phase 5 ADR bench corpus runs'),
  ('entity_resolution_events_alias_revoke', 'entity_resolution_events', 'created_at', 'kind = ''alias_revoke''', 'Alias revoke audit trail'),
  ('v_resolver_health', 'v_resolver_health', 'last_event_at', null, 'Per-tenant resolver activity rollup view')
on conflict (surface_id) do update
  set table_name = excluded.table_name,
      freshness_column = excluded.freshness_column,
      filter_expr = excluded.filter_expr,
      notes = coalesce(excluded.notes, public.table_surface_probes.notes);

-- 3. Resolver function (SECURITY DEFINER, parameterised by trusted probe rows only)
create or replace function public.table_surface_last_seen(_surface_id text)
returns timestamptz
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  _probe public.table_surface_probes%rowtype;
  _sql text;
  _ts timestamptz;
begin
  select * into _probe from public.table_surface_probes where surface_id = _surface_id;
  if not found then
    return null;
  end if;

  -- Validate identifiers against information_schema to prevent injection via probe config.
  if not exists (
    select 1 from information_schema.tables
    where table_schema = 'public' and table_name = _probe.table_name
  ) then
    return null;
  end if;
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = _probe.table_name
      and column_name = _probe.freshness_column
  ) then
    return null;
  end if;

  _sql := format(
    'select max(%I) from public.%I %s',
    _probe.freshness_column,
    _probe.table_name,
    case when _probe.filter_expr is not null and length(trim(_probe.filter_expr)) > 0
         then 'where ' || _probe.filter_expr
         else '' end
  );

  execute _sql into _ts;
  return _ts;
exception when others then
  return null;
end;
$$;

revoke all on function public.table_surface_last_seen(text) from public;
grant execute on function public.table_surface_last_seen(text) to authenticated, service_role;

-- 4. Rewrite the freshness view to use the probe registry for all table surfaces
create or replace view public.v_observability_registry_status as
with cron_cron as (
  select observability_cron_last_seen.jobname as surface_id,
         observability_cron_last_seen.last_seen_at
  from observability_cron_last_seen() observability_cron_last_seen(jobname, last_seen_at)
),
cron_automation as (
  select automation_runs.job as surface_id,
         max(automation_runs.created_at) as last_seen_at
  from automation_runs
  where automation_runs.created_at > (now() - interval '180 days')
  group by automation_runs.job
),
cron_last as (
  select u.surface_id, max(u.last_seen_at) as last_seen_at
  from (
    select surface_id, last_seen_at from cron_cron
    union all
    select surface_id, last_seen_at from cron_automation
  ) u
  group by u.surface_id
),
edge_last as (
  select edge_request_logs.function_name as surface_id,
         max(edge_request_logs.created_at) as last_seen_at
  from edge_request_logs
  where edge_request_logs.created_at > (now() - interval '14 days')
  group by edge_request_logs.function_name
),
last_seen as (
  select r.surface_kind, r.surface_id, cl.last_seen_at
  from observability_registry r
  left join cron_last cl on cl.surface_id = r.surface_id
  where r.surface_kind = 'cron'
  union all
  select r.surface_kind, r.surface_id, el.last_seen_at
  from observability_registry r
  left join edge_last el on el.surface_id = r.surface_id
  where r.surface_kind = 'edge_fn'
  union all
  select r.surface_kind, r.surface_id, public.table_surface_last_seen(r.surface_id) as last_seen_at
  from observability_registry r
  where r.surface_kind = 'table'
  union all
  select r.surface_kind, r.surface_id, null::timestamptz
  from observability_registry r
  where r.surface_kind not in ('cron','edge_fn','table')
)
select r.id,
       r.surface_kind,
       r.surface_id,
       r.expected_cadence_minutes,
       r.stale_multiplier,
       r.watcher_kinds,
       r.owner,
       r.declared_in,
       ls.last_seen_at,
       case
         when coalesce(array_length(r.watcher_kinds, 1), 0) = 0 then 'missing-watcher'
         when r.expected_cadence_minutes is not null
              and ls.last_seen_at is not null
              and (extract(epoch from now() - ls.last_seen_at) / 60::numeric)
                  > (r.expected_cadence_minutes::numeric * r.stale_multiplier) then 'stale'
         when ls.last_seen_at is null and r.surface_kind in ('cron','edge_fn') then 'stale'
         when ls.last_seen_at is null
              and r.surface_kind = 'table'
              and exists (select 1 from public.table_surface_probes p where p.surface_id = r.surface_id)
              then 'stale'
         when r.expected_cadence_minutes is not null and ls.last_seen_at is not null then 'ok'
         else 'unknown'
       end as status
from observability_registry r
left join last_seen ls on ls.surface_kind = r.surface_kind and ls.surface_id = r.surface_id;