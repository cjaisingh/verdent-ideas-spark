
do $$ begin
  create type public.tenant_node_kind as enum ('org','team','project','individual');
exception when duplicate_object then null; end $$;

create table if not exists public.tenant_nodes (
  id uuid primary key default gen_random_uuid(),
  kind public.tenant_node_kind not null,
  display_name text not null check (length(trim(display_name)) > 0),
  parent_id uuid references public.tenant_nodes(id) on delete restrict,
  metadata jsonb not null default '{}'::jsonb,
  status text not null default 'active' check (status in ('active','archived','pending')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint tenant_nodes_no_self_parent check (parent_id is null or parent_id <> id)
);
create index if not exists idx_tenant_nodes_parent on public.tenant_nodes(parent_id);
create index if not exists idx_tenant_nodes_kind on public.tenant_nodes(kind);
create index if not exists idx_tenant_nodes_status on public.tenant_nodes(status);

drop trigger if exists set_tenant_nodes_updated_at on public.tenant_nodes;
create trigger set_tenant_nodes_updated_at before update on public.tenant_nodes
for each row execute function public.update_updated_at_column();

create table if not exists public.tenant_node_memberships (
  id uuid primary key default gen_random_uuid(),
  child_id uuid not null references public.tenant_nodes(id) on delete cascade,
  parent_id uuid not null references public.tenant_nodes(id) on delete restrict,
  relation text not null default 'shared' check (relation in ('shared','delegated')),
  created_at timestamptz not null default now(),
  unique (child_id, parent_id),
  constraint tenant_node_memberships_no_self check (child_id <> parent_id)
);
create index if not exists idx_tenant_node_memberships_child on public.tenant_node_memberships(child_id);
create index if not exists idx_tenant_node_memberships_parent on public.tenant_node_memberships(parent_id);

create table if not exists public.tenant_node_events (
  id uuid primary key default gen_random_uuid(),
  subject_type text not null check (subject_type in ('tenant_node','tenant_node_membership')),
  subject_id uuid not null,
  event_type text not null check (event_type in ('created','updated','archived','restored','membership_added','membership_removed')),
  actor text not null default coalesce(current_setting('request.jwt.claims', true), 'system'),
  before jsonb,
  after jsonb,
  correlation_id uuid,
  parent_event_id uuid references public.tenant_node_events(id),
  created_at timestamptz not null default now()
);
create index if not exists idx_tenant_node_events_subject on public.tenant_node_events(subject_id, created_at desc);
create index if not exists idx_tenant_node_events_type on public.tenant_node_events(event_type, created_at desc);

create or replace function public.log_tenant_node_event()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_event text;
  v_before jsonb;
  v_after jsonb;
begin
  if tg_op = 'INSERT' then
    v_event := 'created'; v_before := null; v_after := to_jsonb(new);
  elsif tg_op = 'UPDATE' then
    if new.status = 'archived' and old.status <> 'archived' then v_event := 'archived';
    elsif old.status = 'archived' and new.status <> 'archived' then v_event := 'restored';
    else v_event := 'updated';
    end if;
    v_before := to_jsonb(old); v_after := to_jsonb(new);
  end if;
  insert into public.tenant_node_events (subject_type, subject_id, event_type, before, after)
  values ('tenant_node', coalesce(new.id, old.id), v_event, v_before, v_after);
  return new;
end $$;

drop trigger if exists log_tenant_node_event_trg on public.tenant_nodes;
create trigger log_tenant_node_event_trg after insert or update on public.tenant_nodes
for each row execute function public.log_tenant_node_event();

create or replace function public.log_tenant_node_membership_event()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    insert into public.tenant_node_events (subject_type, subject_id, event_type, after)
    values ('tenant_node_membership', new.id, 'membership_added', to_jsonb(new));
  elsif tg_op = 'DELETE' then
    insert into public.tenant_node_events (subject_type, subject_id, event_type, before)
    values ('tenant_node_membership', old.id, 'membership_removed', to_jsonb(old));
  end if;
  return coalesce(new, old);
end $$;

drop trigger if exists log_tenant_node_membership_event_trg on public.tenant_node_memberships;
create trigger log_tenant_node_membership_event_trg after insert or delete on public.tenant_node_memberships
for each row execute function public.log_tenant_node_membership_event();

alter table public.tenant_nodes enable row level security;
alter table public.tenant_node_memberships enable row level security;
alter table public.tenant_node_events enable row level security;

create policy "tenant_nodes operator full access" on public.tenant_nodes
for all to authenticated using (public.has_role(auth.uid(),'operator'::app_role))
with check (public.has_role(auth.uid(),'operator'::app_role));

create policy "tenant_node_memberships operator full access" on public.tenant_node_memberships
for all to authenticated using (public.has_role(auth.uid(),'operator'::app_role))
with check (public.has_role(auth.uid(),'operator'::app_role));

create policy "tenant_node_events operator select" on public.tenant_node_events
for select to authenticated using (public.has_role(auth.uid(),'operator'::app_role));
create policy "tenant_node_events insert" on public.tenant_node_events
for insert to authenticated with check (public.has_role(auth.uid(),'operator'::app_role));

do $$
begin
  begin alter publication supabase_realtime add table public.tenant_nodes; exception when duplicate_object then null; end;
  begin alter publication supabase_realtime add table public.tenant_node_memberships; exception when duplicate_object then null; end;
  begin alter publication supabase_realtime add table public.tenant_node_events; exception when duplicate_object then null; end;
end $$;

insert into public.decision_authorities (entity, field, source, precedence, weight, override_policy)
values
  ('tenant_node','identity','operator',100,1.0,'operator_only'),
  ('tenant_node','merge','operator',100,1.0,'operator_only'),
  ('tenant_node','split','operator',100,1.0,'operator_only')
on conflict do nothing;

insert into public.observability_registry (surface_kind, surface_id, expected_cadence_minutes, watcher_kinds, owner, notes, declared_in)
values (
  'table','tenant_node_events',10080,array['stale_surface']::text[],'operator',
  'Phase 5 entity-resolution event stream. Will fire observability_stale_surface only after first activity if it then goes silent >7d.',
  's5.1/t1'
) on conflict do nothing;
