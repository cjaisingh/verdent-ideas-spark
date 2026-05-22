-- ============================================================
-- authoritative_id_systems (global registry, 7 seeds)
-- ============================================================
create table public.authoritative_id_systems (
  id text primary key,                 -- e.g. 'bim_ifc_guid'
  label text not null,
  description text,
  alias_kind text not null,            -- maps to tenant_node_aliases.kind value
  match_rules jsonb not null default '{}'::jsonb, -- e.g. {"case":"upper","strip_ws":true}
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.authoritative_id_systems enable row level security;

create policy "operators read authoritative_id_systems"
  on public.authoritative_id_systems for select
  to authenticated
  using (public.has_role(auth.uid(), 'operator') or public.has_role(auth.uid(), 'admin'));

create policy "admins write authoritative_id_systems"
  on public.authoritative_id_systems for all
  to authenticated
  using (public.has_role(auth.uid(), 'admin'))
  with check (public.has_role(auth.uid(), 'admin'));

create trigger tg_authoritative_id_systems_updated
  before update on public.authoritative_id_systems
  for each row execute function public.update_updated_at_column();

insert into public.authoritative_id_systems (id, label, description, alias_kind, match_rules) values
  ('bim_ifc_guid', 'BIM IFC GUID',     'ISO 16739-1 GlobalId for BIM elements',          'bim_ifc_guid', '{"case":"preserve","strip_ws":true}'::jsonb),
  ('rics_id',      'RICS ID',           'Royal Institution of Chartered Surveyors id',   'rics_id',      '{"case":"upper","strip_ws":true}'::jsonb),
  ('os_uprn',      'OS UPRN',           'Ordnance Survey Unique Property Reference Number','os_uprn',    '{"case":"upper","strip_ws":true,"numeric_only":true}'::jsonb),
  ('sap_floc',     'SAP FLOC',          'SAP Functional Location code',                  'sap_floc',     '{"case":"upper","strip_ws":true}'::jsonb),
  ('duns',         'D-U-N-S Number',    'Dun & Bradstreet 9-digit company identifier',   'duns',         '{"case":"upper","strip_ws":true,"numeric_only":true}'::jsonb),
  ('stripe_customer','Stripe Customer ID','Stripe customer id (cus_*)',                  'stripe_customer','{"case":"preserve","strip_ws":true,"prefix":"cus_"}'::jsonb),
  ('internal',     'Internal ID',       'Tenant-private canonical id',                   'internal',     '{"case":"preserve","strip_ws":true}'::jsonb);

-- ============================================================
-- resolver_decisions (per-call audit log)
-- ============================================================
create table public.resolver_decisions (
  id uuid primary key default gen_random_uuid(),
  request_id text,
  tenant_id uuid not null,
  descriptors jsonb not null,            -- normalised descriptors passed to /resolve
  candidate_count integer not null default 0,
  winning_node_id uuid references public.tenant_nodes(id) on delete set null,
  match_source text,                     -- 'authoritative' | 'alias_exact' | 'alias_fts' | 'embedding_hint' | null
  score numeric(5,4),                    -- top score, 0..1
  confidence_band text not null,         -- 'auto_bind' | 'conflict' | 'no_match'
  authoritative_hit boolean not null default false,
  embedding_hint_used boolean not null default false,
  latency_ms integer,
  actor uuid,
  actor_label text,
  created_at timestamptz not null default now(),
  constraint resolver_decisions_band_chk
    check (confidence_band in ('auto_bind','conflict','no_match')),
  constraint resolver_decisions_source_chk
    check (match_source is null or match_source in ('authoritative','alias_exact','alias_fts','embedding_hint'))
);

create index idx_resolver_decisions_tenant_created
  on public.resolver_decisions (tenant_id, created_at desc);
create index idx_resolver_decisions_band_created
  on public.resolver_decisions (confidence_band, created_at desc);
create index idx_resolver_decisions_request
  on public.resolver_decisions (request_id) where request_id is not null;

alter table public.resolver_decisions enable row level security;

create policy "operators read resolver_decisions"
  on public.resolver_decisions for select
  to authenticated
  using (public.has_role(auth.uid(), 'operator') or public.has_role(auth.uid(), 'admin'));

-- writes are service-role only (no insert/update/delete policies for authenticated)

-- realtime + observability
alter publication supabase_realtime add table public.authoritative_id_systems;
alter publication supabase_realtime add table public.resolver_decisions;

insert into public.observability_registry
  (surface_kind, surface_id, expected_cadence_minutes, watcher_kinds, owner, notes, declared_in)
values
  ('table', 'resolver_decisions', 1440, array['table_inserts'],
   'phase-5', 'One row per /resolve call from entity-resolve. Daily cadence is a floor; expect bursts.',
   'supabase/migrations/phase-5-finishing.sql')
on conflict do nothing;