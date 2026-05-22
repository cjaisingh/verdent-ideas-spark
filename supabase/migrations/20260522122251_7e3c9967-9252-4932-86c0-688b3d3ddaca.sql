drop view if exists public.v_observability_registry_status;

alter table public.observability_registry
  add column if not exists expected_silent boolean not null default false;

update public.observability_registry
set expected_silent = true
where surface_id in (
  'companion-cloud-chat','entity-resolve','gemini-tts','plan-footer-ingest',
  'session-summary-log','telegram-send','telegram-webhook','out_of_scope_stale'
);

update public.observability_registry
set expected_cadence_minutes = 15
where surface_id = 'sentinel-tick' and expected_cadence_minutes is null;

create view public.v_observability_registry_status as
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
  from (select surface_id, last_seen_at from cron_cron
        union all
        select surface_id, last_seen_at from cron_automation) u
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
  from observability_registry r left join cron_last cl on cl.surface_id = r.surface_id
  where r.surface_kind = 'cron'
  union all
  select r.surface_kind, r.surface_id, el.last_seen_at
  from observability_registry r left join edge_last el on el.surface_id = r.surface_id
  where r.surface_kind = 'edge_fn'
  union all
  select r.surface_kind, r.surface_id, public.table_surface_last_seen(r.surface_id)
  from observability_registry r where r.surface_kind = 'table'
  union all
  select r.surface_kind, r.surface_id, null::timestamptz
  from observability_registry r where r.surface_kind not in ('cron','edge_fn','table')
)
select r.id,
       r.surface_kind,
       r.surface_id,
       r.expected_cadence_minutes,
       r.stale_multiplier,
       r.expected_silent,
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
         when ls.last_seen_at is null and r.surface_kind in ('cron','edge_fn') and not r.expected_silent then 'stale'
         when ls.last_seen_at is null
              and r.surface_kind = 'table'
              and exists (select 1 from public.table_surface_probes p where p.surface_id = r.surface_id)
              then 'stale'
         when r.expected_silent then 'ok'
         when r.expected_cadence_minutes is not null and ls.last_seen_at is not null then 'ok'
         else 'unknown'
       end as status
from observability_registry r
left join last_seen ls on ls.surface_kind = r.surface_kind and ls.surface_id = r.surface_id;