-- Phase 5 s5.2 — resolver scoring + ancestry

alter table public.tenant_nodes
  add column if not exists ancestry_ids uuid[] not null default '{}'::uuid[];

create index if not exists idx_tenant_nodes_ancestry
  on public.tenant_nodes using gin (ancestry_ids);

create or replace function public.tenant_node_compute_ancestry(_node_id uuid, _parent_id uuid)
returns uuid[]
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  chain uuid[] := array[]::uuid[];
  cur uuid := _parent_id;
  guard int := 0;
  par uuid;
begin
  while cur is not null and guard < 32 loop
    chain := array_prepend(cur, chain);
    select parent_id into par from public.tenant_nodes where id = cur;
    cur := par;
    guard := guard + 1;
  end loop;
  return chain || _node_id;
end $$;

create or replace function public.tg_tenant_nodes_set_ancestry()
returns trigger
language plpgsql
as $$
begin
  new.ancestry_ids := public.tenant_node_compute_ancestry(new.id, new.parent_id);
  return new;
end $$;

drop trigger if exists trg_tenant_nodes_set_ancestry on public.tenant_nodes;
create trigger trg_tenant_nodes_set_ancestry
  before insert or update of parent_id on public.tenant_nodes
  for each row execute function public.tg_tenant_nodes_set_ancestry();

update public.tenant_nodes
  set ancestry_ids = public.tenant_node_compute_ancestry(id, parent_id);

create table if not exists public.descriptor_weights (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  kind public.alias_descriptor_kind not null,
  weight numeric(4,3) not null check (weight >= 0 and weight <= 1),
  created_by uuid,
  created_at timestamptz not null default now(),
  unique (tenant_id, kind)
);

alter table public.descriptor_weights enable row level security;
alter table public.descriptor_weights replica identity full;

create policy "operator reads descriptor_weights" on public.descriptor_weights
  for select to authenticated
  using (public.has_role(auth.uid(), 'operator') or public.has_role(auth.uid(), 'admin'));

create policy "admin writes descriptor_weights" on public.descriptor_weights
  for all to authenticated
  using (public.has_role(auth.uid(), 'admin'))
  with check (public.has_role(auth.uid(), 'admin'));

do $$ begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and tablename = 'descriptor_weights'
  ) then
    alter publication supabase_realtime add table public.descriptor_weights;
  end if;
end $$;

insert into public.descriptor_weights (tenant_id, kind, weight) values
  ('00000000-0000-0000-0000-000000000000', 'asset_code', 0.70),
  ('00000000-0000-0000-0000-000000000000', 'name',       0.70),
  ('00000000-0000-0000-0000-000000000000', 'address',    0.70),
  ('00000000-0000-0000-0000-000000000000', 'postcode',   0.90),
  ('00000000-0000-0000-0000-000000000000', 'bim_ifc_guid', 1.00),
  ('00000000-0000-0000-0000-000000000000', 'rics_id',    1.00),
  ('00000000-0000-0000-0000-000000000000', 'os_uprn',    1.00),
  ('00000000-0000-0000-0000-000000000000', 'sap_floc',   1.00),
  ('00000000-0000-0000-0000-000000000000', 'other',      0.50)
on conflict (tenant_id, kind) do nothing;

create or replace view public.v_resolver_health as
select
  tenant_id,
  coalesce(payload->>'confidence_band', 'unbanded') as band,
  count(*)::bigint as event_count,
  max(occurred_at) as last_event_at
from public.entity_resolution_events
where kind in ('propose','conflict_open')
  and occurred_at > now() - interval '24 hours'
group by tenant_id, coalesce(payload->>'confidence_band', 'unbanded');

grant select on public.v_resolver_health to authenticated;