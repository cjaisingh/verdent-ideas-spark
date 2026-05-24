
-- Task 1: auto-heartbeat from capability_events
create or replace function public.auto_module_heartbeat_from_event()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  _owning_module text;
begin
  select owning_module into _owning_module
  from public.capabilities
  where id = new.capability_id;

  if _owning_module is null then
    return new;
  end if;

  insert into public.module_heartbeats (owning_module, version, capability_ids, sender, payload)
  values (
    _owning_module,
    coalesce((select version from public.capabilities where id = new.capability_id), 'auto'),
    array[new.capability_id]::text[],
    'auto:capability_events',
    jsonb_build_object('event_type', new.event_type, 'capability_event_id', new.id)
  );
  return new;
end;
$$;

drop trigger if exists trg_auto_module_heartbeat on public.capability_events;
create trigger trg_auto_module_heartbeat
after insert on public.capability_events
for each row execute function public.auto_module_heartbeat_from_event();

comment on function public.auto_module_heartbeat_from_event() is
  'Auto-emits a module_heartbeats row from every capability_events insert; eliminates module_silent_24h recurrence.';

-- Task 2: stale-lesson auto-rejector
create or replace function public.auto_reject_stale_lessons(_days int default 30)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  _affected int := 0;
begin
  with stale as (
    select l.id
    from public.lessons l
    where l.status = 'proposed'
      and l.created_at < now() - make_interval(days => _days)
      and not exists (
        select 1 from public.lesson_events e
        where e.lesson_id = l.id and e.created_at > l.created_at
      )
  ), upd as (
    update public.lessons
       set status = 'rejected',
           applied_as = coalesce(applied_as, '{}'::jsonb)
             || jsonb_build_object('auto_rejected_at', now(), 'reason', 'no_firing_signal_30d'),
           updated_at = now()
     where id in (select id from stale)
     returning id
  )
  insert into public.lesson_events (lesson_id, event_type, actor_label, payload)
  select id, 'auto_rejected', 'auto_reject_stale_lessons',
         jsonb_build_object('reason', 'no_firing_signal_' || _days || 'd')
  from upd;
  get diagnostics _affected = row_count;
  return _affected;
end;
$$;

comment on function public.auto_reject_stale_lessons(int) is
  'Auto-rejects lessons stuck in proposed > N days with no lesson_events. Called weekly by lessons-synthesize.';

-- Task 6: rebuild explicit alias view requested by action 654527bc
drop view if exists public.v_resolver_decisions cascade;
create view public.v_resolver_decisions as
  select * from public.v_resolver_decisions_summary;

comment on view public.v_resolver_decisions is
  'Alias of v_resolver_decisions_summary — preserved name from discussion_action #654527bc.';
