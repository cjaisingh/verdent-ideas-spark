-- 1. New columns
alter table public.discussion_actions
  add column if not exists risk text not null default 'med',
  add column if not exists night_override_reason text;

-- 2. Constraint
alter table public.discussion_actions
  drop constraint if exists discussion_actions_risk_chk;
alter table public.discussion_actions
  add constraint discussion_actions_risk_chk
  check (risk in ('low','med','high','critical'));

-- 3. Backfill (defensive — default already covers new rows)
update public.discussion_actions set risk = 'med' where risk is null;

-- 4. Gate trigger
create or replace function public.enforce_night_eligibility_by_risk()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.risk = 'critical' then
    new.night_eligible := false;
    new.night_override_reason := null;
  elsif new.risk = 'high' then
    if coalesce(trim(new.night_override_reason), '') = '' then
      new.night_eligible := false;
    end if;
  else
    -- low / med: override reason is meaningless, clear it
    new.night_override_reason := null;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_enforce_night_eligibility on public.discussion_actions;
create trigger trg_enforce_night_eligibility
before insert or update on public.discussion_actions
for each row execute function public.enforce_night_eligibility_by_risk();

-- 5. Audit-log additions: extend log_discussion_action_event to capture risk + override
create or replace function public.log_discussion_action_event()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  uid uuid := auth.uid();
  label text;
begin
  select email into label from auth.users where id = uid;
  if label is null then label := 'system'; end if;

  if TG_OP = 'INSERT' then
    insert into public.discussion_action_events(action_id, discussion_id, event_type, actor, actor_label, payload)
      values (new.id, new.discussion_id,
              case when new.source = 'extracted' then 'accepted' else 'created' end,
              uid, label,
              jsonb_build_object(
                'title', new.title,
                'priority', new.priority,
                'risk', new.risk,
                'source', new.source,
                'owner', new.owner,
                'status', new.status,
                'extracted_confidence', new.extracted_confidence
              ));
    return new;

  elsif TG_OP = 'UPDATE' then
    if new.status is distinct from old.status then
      insert into public.discussion_action_events(action_id, discussion_id, event_type, actor, actor_label, payload)
        values (new.id, new.discussion_id, 'status_changed', uid, label,
                jsonb_build_object('from', old.status, 'to', new.status));
    end if;
    if new.owner is distinct from old.owner then
      insert into public.discussion_action_events(action_id, discussion_id, event_type, actor, actor_label, payload)
        values (new.id, new.discussion_id, 'owner_changed', uid, label,
                jsonb_build_object('from', old.owner, 'to', new.owner));
    end if;
    if new.due_at is distinct from old.due_at then
      insert into public.discussion_action_events(action_id, discussion_id, event_type, actor, actor_label, payload)
        values (new.id, new.discussion_id, 'due_changed', uid, label,
                jsonb_build_object('from', old.due_at, 'to', new.due_at));
    end if;
    if new.priority is distinct from old.priority then
      insert into public.discussion_action_events(action_id, discussion_id, event_type, actor, actor_label, payload)
        values (new.id, new.discussion_id, 'priority_changed', uid, label,
                jsonb_build_object('from', old.priority, 'to', new.priority));
    end if;
    if new.risk is distinct from old.risk then
      insert into public.discussion_action_events(action_id, discussion_id, event_type, actor, actor_label, payload)
        values (new.id, new.discussion_id, 'risk_changed', uid, label,
                jsonb_build_object('from', old.risk, 'to', new.risk));
    end if;
    if coalesce(new.night_override_reason,'') is distinct from coalesce(old.night_override_reason,'') then
      insert into public.discussion_action_events(action_id, discussion_id, event_type, actor, actor_label, payload)
        values (new.id, new.discussion_id, 'night_override', uid, label,
                jsonb_build_object('from', old.night_override_reason, 'to', new.night_override_reason, 'risk', new.risk));
    end if;
    if new.title is distinct from old.title then
      insert into public.discussion_action_events(action_id, discussion_id, event_type, actor, actor_label, payload)
        values (new.id, new.discussion_id, 'title_changed', uid, label,
                jsonb_build_object('from', old.title, 'to', new.title));
    end if;
    if new.promoted_task_id is distinct from old.promoted_task_id and new.promoted_task_id is not null then
      insert into public.discussion_action_events(action_id, discussion_id, event_type, actor, actor_label, payload)
        values (new.id, new.discussion_id, 'promoted', uid, label,
                jsonb_build_object('task_id', new.promoted_task_id));
    end if;
    return new;

  elsif TG_OP = 'DELETE' then
    insert into public.discussion_action_events(action_id, discussion_id, event_type, actor, actor_label, payload)
      values (null, old.discussion_id, 'deleted', uid, label,
              jsonb_build_object('short_num', old.short_num, 'title', old.title));
    return old;
  end if;
  return null;
end;
$function$;
