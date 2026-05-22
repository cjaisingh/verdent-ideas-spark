alter table public.observability_registry
  add column if not exists stale_multiplier numeric not null default 3
  check (stale_multiplier > 0);

comment on column public.observability_registry.stale_multiplier is
  'Multiplier applied to expected_cadence_minutes before marking a surface stale. Default 3; long-cadence surfaces (monthly/quarterly) typically use 1.25.';

update public.observability_registry
   set stale_multiplier = 1.25
 where surface_kind = 'cron'
   and surface_id in ('scheduled-deep-audit-monthly', 'scheduled-quarterly-review-open');

drop view if exists public.v_observability_registry_status;

create view public.v_observability_registry_status as
with cron_cron as (
  select jobname as surface_id, last_seen_at
  from public.observability_cron_last_seen()
),
cron_automation as (
  select job as surface_id, max(created_at) as last_seen_at
  from public.automation_runs
  where created_at > now() - interval '180 days'
  group by job
),
cron_last as (
  select surface_id, max(last_seen_at) as last_seen_at
  from (
    select * from cron_cron
    union all
    select * from cron_automation
  ) u
  group by surface_id
),
edge_last as (
  select function_name as surface_id, max(created_at) as last_seen_at
  from public.edge_request_logs
  where created_at > now() - interval '14 days'
  group by function_name
),
table_last as (
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
  r.stale_multiplier,
  r.watcher_kinds,
  r.owner,
  r.declared_in,
  ls.last_seen_at,
  case
    when coalesce(array_length(r.watcher_kinds, 1), 0) = 0
      then 'missing-watcher'
    when r.expected_cadence_minutes is not null and ls.last_seen_at is not null
         and extract(epoch from (now() - ls.last_seen_at)) / 60
             > r.expected_cadence_minutes * r.stale_multiplier
      then 'stale'
    when ls.last_seen_at is null and r.surface_kind in ('cron','edge_fn')
      then 'stale'
    when ls.last_seen_at is null and r.surface_kind = 'table'
         and r.surface_id = 'resolver_decisions'
      then 'stale'
    when r.expected_cadence_minutes is not null and ls.last_seen_at is not null
      then 'ok'
    else 'unknown'
  end as status
from public.observability_registry r
left join last_seen ls
  on ls.surface_kind = r.surface_kind and ls.surface_id = r.surface_id;

comment on view public.v_observability_registry_status is
  'Per-surface status (ok/stale/missing-watcher/unknown). Threshold = expected_cadence_minutes * stale_multiplier (default 3, monthly/quarterly use 1.25). cron→union(cron.job_run_details, automation_runs.job); edge_fn→edge_request_logs; table→resolver_decisions only.';