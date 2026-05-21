create or replace view public.v_observability_registry_status as
with last_seen as (
  -- cron surfaces: most recent automation_runs row per job
  select r.surface_kind, r.surface_id, max(ar.created_at) as last_seen_at
  from public.observability_registry r
  left join public.automation_runs ar
    on r.surface_kind = 'cron' and ar.job = r.surface_id
  where r.surface_kind = 'cron'
  group by r.surface_kind, r.surface_id
  union all
  -- edge_fn surfaces: most recent edge_request_logs row per function
  select r.surface_kind, r.surface_id, max(el.created_at) as last_seen_at
  from public.observability_registry r
  left join public.edge_request_logs el
    on r.surface_kind = 'edge_fn' and el.function_name = r.surface_id
  where r.surface_kind = 'edge_fn'
  group by r.surface_kind, r.surface_id
  union all
  -- other kinds: no last_seen lookup
  select r.surface_kind, r.surface_id, null::timestamptz
  from public.observability_registry r
  where r.surface_kind not in ('cron', 'edge_fn')
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
    when ls.last_seen_at is null and r.surface_kind in ('cron', 'edge_fn')
      then 'stale'
    when r.expected_cadence_minutes is not null and ls.last_seen_at is not null
      then 'ok'
    else 'unknown'
  end as status
from public.observability_registry r
left join last_seen ls
  on ls.surface_kind = r.surface_kind and ls.surface_id = r.surface_id;

comment on view public.v_observability_registry_status is
  'Per-surface status (ok/stale/missing-watcher/unknown) for observability_registry. Used by sentinel-tick to fire observability_missing_watcher (high) and observability_stale_surface (medium) findings.';