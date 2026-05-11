-- W7.1.5 Governance Joins

create table if not exists public.governance_links (
  id uuid primary key default gen_random_uuid(),
  left_kind text not null check (left_kind in ('task','notebook','entity','authority_rule')),
  left_ref text not null,
  right_kind text not null check (right_kind in ('task','notebook','entity','authority_rule')),
  right_ref text not null,
  relation text not null check (relation in ('touches','justifies','governs','supersedes')),
  note text,
  created_by uuid,
  created_at timestamptz not null default now(),
  unique (left_kind, left_ref, right_kind, right_ref, relation)
);

create index if not exists idx_gov_links_left on public.governance_links(left_kind, left_ref);
create index if not exists idx_gov_links_right on public.governance_links(right_kind, right_ref);

alter table public.governance_links enable row level security;

create policy "operators read governance_links" on public.governance_links
  for select to authenticated
  using (has_role(auth.uid(),'operator') or has_role(auth.uid(),'admin'));
create policy "operators write governance_links" on public.governance_links
  for insert to authenticated
  with check (has_role(auth.uid(),'operator') or has_role(auth.uid(),'admin'));
create policy "operators delete governance_links" on public.governance_links
  for delete to authenticated
  using (has_role(auth.uid(),'operator') or has_role(auth.uid(),'admin'));

alter publication supabase_realtime add table public.governance_links;

create table if not exists public.governance_link_events (
  id uuid primary key default gen_random_uuid(),
  link_id uuid,
  event_type text not null check (event_type in ('created','deleted')),
  left_kind text not null,
  left_ref text not null,
  right_kind text not null,
  right_ref text not null,
  relation text not null,
  actor uuid,
  actor_label text,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

alter table public.governance_link_events enable row level security;

create policy "operators read gov_link_events" on public.governance_link_events
  for select to authenticated
  using (has_role(auth.uid(),'operator') or has_role(auth.uid(),'admin'));

create or replace function public.log_governance_link_event()
returns trigger language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); label text;
begin
  select email into label from auth.users where id = uid;
  if label is null then label := 'system'; end if;
  if TG_OP = 'INSERT' then
    insert into public.governance_link_events(link_id, event_type, left_kind, left_ref, right_kind, right_ref, relation, actor, actor_label, payload)
      values (new.id, 'created', new.left_kind, new.left_ref, new.right_kind, new.right_ref, new.relation, uid, label, jsonb_build_object('note', new.note));
    return new;
  elsif TG_OP = 'DELETE' then
    insert into public.governance_link_events(link_id, event_type, left_kind, left_ref, right_kind, right_ref, relation, actor, actor_label, payload)
      values (old.id, 'deleted', old.left_kind, old.left_ref, old.right_kind, old.right_ref, old.relation, uid, label, '{}'::jsonb);
    return old;
  end if;
  return null;
end $$;

drop trigger if exists trg_log_governance_link_event on public.governance_links;
create trigger trg_log_governance_link_event
  after insert or delete on public.governance_links
  for each row execute function public.log_governance_link_event();

-- Chain reader
create or replace function public.governance_chain(_anchor_kind text, _anchor_ref text)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  d1 jsonb;
  d2 jsonb;
  has_entity boolean := false;
  has_notebook boolean := false;
  has_rule boolean := false;
  gaps text[] := '{}';
begin
  if not (has_role(auth.uid(),'operator') or has_role(auth.uid(),'admin')) then
    raise exception 'not authorized';
  end if;

  -- depth 1 neighbors (either side)
  select coalesce(jsonb_agg(row_to_json(x)), '[]'::jsonb) into d1
  from (
    select id, left_kind, left_ref, right_kind, right_ref, relation, created_at
    from public.governance_links
    where (left_kind = _anchor_kind and left_ref = _anchor_ref)
       or (right_kind = _anchor_kind and right_ref = _anchor_ref)
    order by created_at desc
  ) x;

  -- depth 2: links from any depth-1 neighbor
  select coalesce(jsonb_agg(row_to_json(y)), '[]'::jsonb) into d2
  from (
    select distinct l2.id, l2.left_kind, l2.left_ref, l2.right_kind, l2.right_ref, l2.relation
    from public.governance_links l1
    join public.governance_links l2
      on (l2.left_kind = case when l1.left_kind = _anchor_kind and l1.left_ref = _anchor_ref then l1.right_kind else l1.left_kind end
          and l2.left_ref = case when l1.left_kind = _anchor_kind and l1.left_ref = _anchor_ref then l1.right_ref else l1.left_ref end)
      or (l2.right_kind = case when l1.left_kind = _anchor_kind and l1.left_ref = _anchor_ref then l1.right_kind else l1.left_kind end
          and l2.right_ref = case when l1.left_kind = _anchor_kind and l1.left_ref = _anchor_ref then l1.right_ref else l1.left_ref end)
    where (l1.left_kind = _anchor_kind and l1.left_ref = _anchor_ref)
       or (l1.right_kind = _anchor_kind and l1.right_ref = _anchor_ref)
  ) y;

  -- gap detection (anchor=task expectations: entity touched, notebook justifies, rule via entity)
  if _anchor_kind = 'task' then
    select exists (
      select 1 from public.governance_links
      where ((left_kind='task' and left_ref=_anchor_ref and right_kind='entity')
          or (right_kind='task' and right_ref=_anchor_ref and left_kind='entity'))
    ) into has_entity;
    select exists (
      select 1 from public.governance_links
      where ((left_kind='task' and left_ref=_anchor_ref and right_kind='notebook')
          or (right_kind='task' and right_ref=_anchor_ref and left_kind='notebook'))
    ) into has_notebook;
    select exists (
      select 1 from public.decision_authorities da
      where exists (
        select 1 from public.governance_links gl
        where ((gl.left_kind='task' and gl.left_ref=_anchor_ref and gl.right_kind='entity' and gl.right_ref=da.entity)
            or (gl.right_kind='task' and gl.right_ref=_anchor_ref and gl.left_kind='entity' and gl.left_ref=da.entity))
      )
    ) into has_rule;
    if not has_entity then gaps := gaps || 'entity'; end if;
    if not has_notebook then gaps := gaps || 'notebook'; end if;
    if not has_rule then gaps := gaps || 'authority_rule'; end if;
  end if;

  return jsonb_build_object(
    'anchor_kind', _anchor_kind,
    'anchor_ref', _anchor_ref,
    'depth1', d1,
    'depth2', d2,
    'gaps', to_jsonb(gaps)
  );
end $$;

-- Coverage rollup for /governance and /morning-review
create or replace function public.governance_coverage(_days integer default 30)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  total_tasks bigint;
  with_entity bigint;
  with_notebook bigint;
  with_rule bigint;
begin
  if not (has_role(auth.uid(),'operator') or has_role(auth.uid(),'admin')) then
    raise exception 'not authorized';
  end if;

  select count(*) into total_tasks
    from public.roadmap_tasks
   where status::text in ('done','shipped')
     and updated_at >= now() - (_days || ' days')::interval;

  select count(distinct t.id) into with_entity
    from public.roadmap_tasks t
    join public.governance_links gl
      on (gl.left_kind='task' and gl.left_ref=t.id::text and gl.right_kind='entity')
      or (gl.right_kind='task' and gl.right_ref=t.id::text and gl.left_kind='entity')
   where t.status::text in ('done','shipped')
     and t.updated_at >= now() - (_days || ' days')::interval;

  select count(distinct t.id) into with_notebook
    from public.roadmap_tasks t
    join public.governance_links gl
      on (gl.left_kind='task' and gl.left_ref=t.id::text and gl.right_kind='notebook')
      or (gl.right_kind='task' and gl.right_ref=t.id::text and gl.left_kind='notebook')
   where t.status::text in ('done','shipped')
     and t.updated_at >= now() - (_days || ' days')::interval;

  select count(distinct t.id) into with_rule
    from public.roadmap_tasks t
    join public.governance_links gl
      on (gl.left_kind='task' and gl.left_ref=t.id::text and gl.right_kind='entity')
      or (gl.right_kind='task' and gl.right_ref=t.id::text and gl.left_kind='entity')
    join public.decision_authorities da
      on da.entity = case when gl.left_kind='entity' then gl.left_ref else gl.right_ref end
   where t.status::text in ('done','shipped')
     and t.updated_at >= now() - (_days || ' days')::interval;

  return jsonb_build_object(
    'window_days', _days,
    'tasks_shipped', total_tasks,
    'with_entity', with_entity,
    'with_notebook', with_notebook,
    'with_authority_rule', with_rule
  );
end $$;