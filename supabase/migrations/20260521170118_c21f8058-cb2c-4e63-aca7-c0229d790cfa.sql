
-- =====================================================================
-- Phase 5 sprint s5.1 — Entity & Tenant Resolution
-- =====================================================================

-- ---------- enums ----------------------------------------------------
do $$ begin
  create type public.tenant_node_status as enum ('active','merged','split','retired');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.alias_descriptor_kind as enum (
    'asset_code','name','address','postcode',
    'bim_ifc_guid','rics_id','os_uprn','sap_floc','other'
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.entity_conflict_status as enum ('open','resolved','dismissed');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.entity_resolution_event_kind as enum (
    'propose','bind','alias_create','alias_revoke',
    'conflict_open','conflict_resolve','node_upsert'
  );
exception when duplicate_object then null; end $$;

-- ---------- tenant_nodes ---------------------------------------------
create table if not exists public.tenant_nodes (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  parent_id uuid references public.tenant_nodes(id) on delete restrict,
  kind text not null,
  name text not null,
  external_ids jsonb not null default '{}'::jsonb,
  status public.tenant_node_status not null default 'active',
  superseded_by uuid references public.tenant_nodes(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_tenant_nodes_tenant on public.tenant_nodes(tenant_id);
create index if not exists idx_tenant_nodes_parent on public.tenant_nodes(parent_id);
create index if not exists idx_tenant_nodes_external_ids on public.tenant_nodes using gin (external_ids);

alter table public.tenant_nodes enable row level security;
alter table public.tenant_nodes replica identity full;

create policy "operator reads tenant_nodes" on public.tenant_nodes
  for select to authenticated
  using (public.has_role(auth.uid(),'operator') or public.has_role(auth.uid(),'admin'));
create policy "admin writes tenant_nodes" on public.tenant_nodes
  for all to authenticated
  using (public.has_role(auth.uid(),'admin'))
  with check (public.has_role(auth.uid(),'admin'));

-- ---------- tenant_node_aliases --------------------------------------
create or replace function public.normalise_alias(_v text)
returns text language sql immutable as $$
  select lower(regexp_replace(coalesce(_v,''), '\s+', ' ', 'g'))
$$;

create table if not exists public.tenant_node_aliases (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  node_id uuid not null references public.tenant_nodes(id) on delete cascade,
  kind public.alias_descriptor_kind not null,
  value text not null,
  normalised text generated always as (public.normalise_alias(value)) stored,
  source text not null default 'operator',
  authoritative boolean not null default false,
  approved_by uuid,
  approved_at timestamptz not null default now(),
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);
create unique index if not exists uq_alias_active
  on public.tenant_node_aliases(tenant_id, kind, normalised)
  where revoked_at is null;
create index if not exists idx_alias_node on public.tenant_node_aliases(node_id);
create index if not exists idx_alias_fts
  on public.tenant_node_aliases using gin (to_tsvector('simple', normalised));

alter table public.tenant_node_aliases enable row level security;
alter table public.tenant_node_aliases replica identity full;

create policy "operator reads tenant_node_aliases" on public.tenant_node_aliases
  for select to authenticated
  using (public.has_role(auth.uid(),'operator') or public.has_role(auth.uid(),'admin'));
create policy "admin writes tenant_node_aliases" on public.tenant_node_aliases
  for all to authenticated
  using (public.has_role(auth.uid(),'admin'))
  with check (public.has_role(auth.uid(),'admin'));

-- ---------- entity_resolution_conflicts ------------------------------
create table if not exists public.entity_resolution_conflicts (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  descriptors jsonb not null,
  candidates jsonb not null default '[]'::jsonb,
  status public.entity_conflict_status not null default 'open',
  opened_at timestamptz not null default now(),
  resolved_at timestamptz,
  resolved_by uuid,
  resolution_note text
);
create index if not exists idx_conflict_status on public.entity_resolution_conflicts(status);
create index if not exists idx_conflict_tenant on public.entity_resolution_conflicts(tenant_id);

alter table public.entity_resolution_conflicts enable row level security;
alter table public.entity_resolution_conflicts replica identity full;

create policy "operator reads entity_resolution_conflicts" on public.entity_resolution_conflicts
  for select to authenticated
  using (public.has_role(auth.uid(),'operator') or public.has_role(auth.uid(),'admin'));
create policy "admin writes entity_resolution_conflicts" on public.entity_resolution_conflicts
  for all to authenticated
  using (public.has_role(auth.uid(),'admin'))
  with check (public.has_role(auth.uid(),'admin'));

-- ---------- entity_resolution_events ---------------------------------
create table if not exists public.entity_resolution_events (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid,
  node_id uuid,
  alias_id uuid,
  conflict_id uuid,
  kind public.entity_resolution_event_kind not null,
  payload jsonb not null default '{}'::jsonb,
  actor uuid,
  actor_label text,
  request_id text,
  occurred_at timestamptz not null default now()
);
create index if not exists idx_eres_events_tenant on public.entity_resolution_events(tenant_id, occurred_at desc);
create index if not exists idx_eres_events_kind on public.entity_resolution_events(kind, occurred_at desc);

alter table public.entity_resolution_events enable row level security;
alter table public.entity_resolution_events replica identity full;

create policy "operator reads entity_resolution_events" on public.entity_resolution_events
  for select to authenticated
  using (public.has_role(auth.uid(),'operator') or public.has_role(auth.uid(),'admin'));
-- writes via service role only; no insert policy for authenticated.

-- ---------- triggers: auto-emit events -------------------------------
create or replace function public.emit_tenant_node_event()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.entity_resolution_events(tenant_id, node_id, kind, payload)
  values (
    coalesce(NEW.tenant_id, OLD.tenant_id),
    coalesce(NEW.id, OLD.id),
    'node_upsert',
    jsonb_build_object(
      'op', TG_OP,
      'status', coalesce(NEW.status::text, OLD.status::text),
      'kind', coalesce(NEW.kind, OLD.kind)
    )
  );
  return coalesce(NEW, OLD);
end $$;

drop trigger if exists trg_tenant_node_event on public.tenant_nodes;
create trigger trg_tenant_node_event
  after insert or update or delete on public.tenant_nodes
  for each row execute function public.emit_tenant_node_event();

create or replace function public.emit_tenant_alias_event()
returns trigger language plpgsql security definer set search_path = public as $$
declare _kind public.entity_resolution_event_kind;
begin
  if TG_OP='INSERT' then _kind := 'alias_create';
  elsif TG_OP='UPDATE' and NEW.revoked_at is not null and OLD.revoked_at is null then _kind := 'alias_revoke';
  else _kind := 'alias_create'; end if;
  insert into public.entity_resolution_events(tenant_id, node_id, alias_id, kind, payload)
  values (
    coalesce(NEW.tenant_id, OLD.tenant_id),
    coalesce(NEW.node_id, OLD.node_id),
    coalesce(NEW.id, OLD.id),
    _kind,
    jsonb_build_object('op', TG_OP, 'descriptor_kind', coalesce(NEW.kind::text, OLD.kind::text))
  );
  return coalesce(NEW, OLD);
end $$;

drop trigger if exists trg_tenant_alias_event on public.tenant_node_aliases;
create trigger trg_tenant_alias_event
  after insert or update on public.tenant_node_aliases
  for each row execute function public.emit_tenant_alias_event();

-- ---------- realtime -------------------------------------------------
do $$ begin
  alter publication supabase_realtime add table public.tenant_nodes;
exception when duplicate_object then null; end $$;
do $$ begin
  alter publication supabase_realtime add table public.tenant_node_aliases;
exception when duplicate_object then null; end $$;
do $$ begin
  alter publication supabase_realtime add table public.entity_resolution_conflicts;
exception when duplicate_object then null; end $$;
do $$ begin
  alter publication supabase_realtime add table public.entity_resolution_events;
exception when duplicate_object then null; end $$;

-- ---------- observability_registry row -------------------------------
insert into public.observability_registry
  (surface_kind, surface_id, expected_cadence_minutes, watcher_kinds, owner, notes, declared_in)
values
  ('edge_fn','entity-resolve', null, array['logger_coverage'], 'phase-5',
   'Phase 5 resolver. Read-only probe at /entities. Match order authoritative→alias_exact→alias_fts.',
   '.lovable/plan.md#s5.1')
on conflict (surface_kind, surface_id) do update
  set notes = excluded.notes, declared_in = excluded.declared_in, updated_at = now();
