-- 1. Tables
create table public.workstream_signoffs (
  workstream text primary key,
  locked boolean not null default true,
  signed_off_at timestamptz not null default now(),
  signed_off_by uuid references auth.users(id),
  signed_off_by_label text not null,
  evidence jsonb not null default '{}'::jsonb,
  overrides jsonb not null default '[]'::jsonb,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.workstream_signoff_events (
  id uuid primary key default gen_random_uuid(),
  workstream text not null,
  event_type text not null check (event_type in ('signed_off','unlocked','re_signed')),
  actor uuid,
  actor_label text not null,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index workstream_signoff_events_ws_idx on public.workstream_signoff_events(workstream, created_at desc);

alter table public.workstream_signoffs enable row level security;
alter table public.workstream_signoff_events enable row level security;

create policy "operators read signoffs" on public.workstream_signoffs
  for select to authenticated
  using (has_role(auth.uid(),'operator') or has_role(auth.uid(),'admin'));

create policy "operators read signoff events" on public.workstream_signoff_events
  for select to authenticated
  using (has_role(auth.uid(),'operator') or has_role(auth.uid(),'admin'));

-- No direct insert/update/delete policies — writes go through SECURITY DEFINER functions.

create trigger trg_workstream_signoffs_updated
  before update on public.workstream_signoffs
  for each row execute function public.update_updated_at_column();

alter publication supabase_realtime add table public.workstream_signoffs;

-- 2. Helpers
create or replace function public.is_workstream_locked(_workstream text)
returns boolean
language sql stable security definer
set search_path = public
as $$
  select coalesce((select locked from public.workstream_signoffs where workstream = _workstream), false);
$$;

-- 3. Sign-off function
create or replace function public.sign_off_workstream(
  _workstream text,
  _evidence jsonb,
  _overrides jsonb default '[]'::jsonb,
  _notes text default null
) returns jsonb
language plpgsql security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  label text;
  failing_keys text[];
  override_keys text[];
  missing text[];
  existing public.workstream_signoffs%rowtype;
  event_kind text;
  phase_updated int := 0;
begin
  if not has_role(uid,'admin') then
    raise exception 'admin role required to sign off workstreams';
  end if;
  if _workstream is null or length(trim(_workstream)) = 0 then
    raise exception 'workstream is required';
  end if;
  if jsonb_typeof(_evidence) <> 'object' then
    raise exception 'evidence must be a JSON object of {check_id: pass|fail|pending}';
  end if;

  -- Identify failing checks (anything not 'pass') and ensure each has an override entry with reason
  select coalesce(array_agg(k), '{}') into failing_keys
    from jsonb_each_text(_evidence) e(k, v)
   where v <> 'pass';

  select coalesce(array_agg(o->>'check_id'), '{}') into override_keys
    from jsonb_array_elements(coalesce(_overrides, '[]'::jsonb)) o
   where coalesce(length(trim(o->>'reason')), 0) > 0;

  missing := (select coalesce(array_agg(k), '{}') from unnest(failing_keys) k where k <> all(override_keys));
  if array_length(missing,1) > 0 then
    raise exception 'missing written justification for failing checks: %', array_to_string(missing, ', ');
  end if;

  select email into label from auth.users where id = uid;
  if label is null then label := 'admin'; end if;

  select * into existing from public.workstream_signoffs where workstream = _workstream;

  if existing.workstream is null then
    insert into public.workstream_signoffs(workstream, locked, signed_off_by, signed_off_by_label, evidence, overrides, notes)
      values (_workstream, true, uid, label, _evidence, coalesce(_overrides,'[]'::jsonb), _notes);
    event_kind := 'signed_off';
  else
    update public.workstream_signoffs
       set locked = true,
           signed_off_at = now(),
           signed_off_by = uid,
           signed_off_by_label = label,
           evidence = _evidence,
           overrides = coalesce(_overrides,'[]'::jsonb),
           notes = _notes
     where workstream = _workstream;
    event_kind := 're_signed';
  end if;

  insert into public.workstream_signoff_events(workstream, event_type, actor, actor_label, payload)
    values (_workstream, event_kind, uid, label,
            jsonb_build_object('evidence', _evidence, 'overrides', coalesce(_overrides,'[]'::jsonb), 'notes', _notes));

  -- Best-effort: mark matching roadmap phase done if one exists
  update public.roadmap_phases
     set status = 'done'::roadmap_status
   where key = _workstream
     and status::text not in ('done','shipped','cancelled');
  get diagnostics phase_updated = row_count;

  return jsonb_build_object(
    'workstream', _workstream,
    'locked', true,
    'signed_off_by', label,
    'phase_marked_done', phase_updated > 0
  );
end $$;

-- 4. Unlock function (admin-only escape hatch)
create or replace function public.unlock_workstream(_workstream text, _reason text)
returns void
language plpgsql security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  label text;
begin
  if not has_role(uid,'admin') then
    raise exception 'admin role required to unlock';
  end if;
  if _reason is null or length(trim(_reason)) < 5 then
    raise exception 'unlock requires a written reason (5+ chars)';
  end if;
  select email into label from auth.users where id = uid;
  if label is null then label := 'admin'; end if;

  update public.workstream_signoffs set locked = false where workstream = _workstream;
  insert into public.workstream_signoff_events(workstream, event_type, actor, actor_label, payload)
    values (_workstream, 'unlocked', uid, label, jsonb_build_object('reason', _reason));
end $$;

-- 5. Lock-enforcement triggers
create or replace function public.enforce_workstream_lock_on_task()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if public.is_workstream_locked('W7') then
    if coalesce(new.module,'') ilike '%w7%' or coalesce(new.title,'') ilike '%w7%'
       or coalesce(new.module,'') ilike '%governance%' then
      raise exception 'W7 is locked — sign-off recorded. Unlock the workstream before adding/modifying W7 tasks.';
    end if;
  end if;
  return new;
end $$;

create trigger trg_block_w7_tasks_when_locked
  before insert or update on public.roadmap_tasks
  for each row execute function public.enforce_workstream_lock_on_task();

create or replace function public.enforce_workstream_lock_on_action()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if public.is_workstream_locked('W7') then
    if coalesce(new.title,'') ilike '%w7%' or coalesce(new.title,'') ilike '%governance substrate%' then
      raise exception 'W7 is locked — sign-off recorded. Unlock the workstream before adding/modifying W7 discussion actions.';
    end if;
  end if;
  return new;
end $$;

create trigger trg_block_w7_actions_when_locked
  before insert or update on public.discussion_actions
  for each row execute function public.enforce_workstream_lock_on_action();