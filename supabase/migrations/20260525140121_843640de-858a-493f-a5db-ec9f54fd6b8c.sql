-- Phase 6 s6.1 t1: ingest pipeline schema

create type public.source_mapping_status as enum ('draft','approved','deprecated');
create type public.raw_source_kind        as enum ('file','api','webhook','voice','email','bms_batch');
create type public.staged_validation_status as enum ('pending','passed','failed','quarantined');
create type public.fact_conflict_status   as enum ('open','resolved','dismissed');
create type public.fact_conflict_resolution as enum ('keep_existing','accept_incoming','superseded_by_rule','manual_value');
create type public.ingest_event_type as enum (
  'row_staged','row_promoted','row_quarantined',
  'conflict_raised','conflict_resolved',
  'mapping_approved','mapping_superseded','fact_superseded'
);

create table public.source_mappings (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null,
  adapter_id    text not null,
  version       int  not null,
  status        public.source_mapping_status not null default 'draft',
  mapping       jsonb not null default '{}'::jsonb,
  approved_by   uuid,
  approved_at   timestamptz,
  superseded_by uuid references public.source_mappings(id) on delete set null,
  notes         text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (adapter_id, version)
);
create index idx_source_mappings_tenant on public.source_mappings(tenant_id);
create index idx_source_mappings_adapter_status on public.source_mappings(adapter_id, status);

create or replace function public.tg_source_mappings_lock_approved()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if old.status = 'approved' then
    if new.adapter_id is distinct from old.adapter_id
       or new.version is distinct from old.version
       or new.tenant_id is distinct from old.tenant_id
       or new.mapping is distinct from old.mapping
       or new.status is distinct from old.status
       or new.approved_by is distinct from old.approved_by
       or new.approved_at is distinct from old.approved_at then
      raise exception 'source_mappings: approved rows are immutable (only superseded_by may change).';
    end if;
  end if;
  new.updated_at := now();
  return new;
end $$;
create trigger tg_source_mappings_lock_approved
  before update on public.source_mappings
  for each row execute function public.tg_source_mappings_lock_approved();

create table public.raw_records (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null,
  adapter_id      text not null,
  source_kind     public.raw_source_kind not null,
  source_id       text not null,
  received_at     timestamptz not null,
  payload         jsonb not null,
  payload_hash    bytea not null,
  bytes           int not null,
  idempotency_key text not null,
  pii_declared    jsonb not null default '[]'::jsonb,
  retain_until    timestamptz,
  created_at      timestamptz not null default now(),
  unique (adapter_id, idempotency_key)
);
create index idx_raw_records_tenant on public.raw_records(tenant_id);
create index idx_raw_records_received_at on public.raw_records(received_at desc);

create table public.staged_records (
  raw_record_id        uuid not null references public.raw_records(id) on delete cascade,
  staging_batch_id     uuid not null,
  row_no               int  not null,
  source_mapping_id    uuid not null references public.source_mappings(id) on delete restrict,
  tenant_id            uuid not null,
  tenant_node_id       uuid references public.tenant_nodes(id) on delete restrict,
  descriptors          jsonb not null default '{}'::jsonb,
  fact_type            text not null,
  value                jsonb not null,
  value_hash           bytea not null,
  effective_at         timestamptz not null,
  validation_status    public.staged_validation_status not null default 'pending',
  validation_errors    jsonb not null default '[]'::jsonb,
  promoted_canonical_id uuid,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  primary key (staging_batch_id, row_no),
  constraint staged_records_promoted_requires_pass
    check (promoted_canonical_id is null or validation_status = 'passed')
);
create index idx_staged_records_mapping_status on public.staged_records(source_mapping_id, validation_status);
create index idx_staged_records_raw on public.staged_records(raw_record_id);
create index idx_staged_records_tenant_node on public.staged_records(tenant_node_id) where tenant_node_id is not null;
create trigger tg_staged_records_touch
  before update on public.staged_records
  for each row execute function public.update_updated_at_column();

create table public.canonical_facts (
  id                uuid primary key default gen_random_uuid(),
  tenant_id         uuid not null,
  tenant_node_id    uuid not null references public.tenant_nodes(id) on delete restrict,
  fact_type         text not null,
  value             jsonb not null,
  value_hash        bytea not null,
  effective_at      timestamptz not null,
  recorded_at       timestamptz not null default now(),
  raw_record_id     uuid not null references public.raw_records(id) on delete restrict,
  source_mapping_id uuid not null references public.source_mappings(id) on delete restrict,
  staging_batch_id  uuid not null,
  staged_row_no     int  not null,
  promoted_at       timestamptz not null default now(),
  promoted_by       uuid,
  auto_promoted     boolean not null,
  superseded_by     uuid references public.canonical_facts(id) on delete set null,
  supersedes_id     uuid references public.canonical_facts(id) on delete set null,
  ancestry_ids      uuid[] not null default '{}'::uuid[],
  constraint canonical_facts_auto_has_no_actor
    check (auto_promoted = false or promoted_by is null),
  constraint canonical_facts_no_self_supersede
    check (superseded_by is null or superseded_by <> id)
);
create unique index uq_canonical_facts_live
  on public.canonical_facts (tenant_node_id, fact_type, effective_at)
  where superseded_by is null;
create index idx_canonical_facts_tenant on public.canonical_facts(tenant_id);
create index idx_canonical_facts_node_type on public.canonical_facts(tenant_node_id, fact_type);
create index idx_canonical_facts_ancestry on public.canonical_facts using gin (ancestry_ids);

create or replace function public.tg_canonical_facts_set_ancestry()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  select ancestry_ids into new.ancestry_ids from public.tenant_nodes where id = new.tenant_node_id;
  if new.ancestry_ids is null then new.ancestry_ids := '{}'::uuid[]; end if;
  return new;
end $$;
create trigger tg_canonical_facts_set_ancestry
  before insert on public.canonical_facts
  for each row execute function public.tg_canonical_facts_set_ancestry();

create or replace function public.tg_canonical_facts_forbid_update()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if old.superseded_by is not null then
    raise exception 'canonical_facts: row is already superseded.';
  end if;
  if new.id is distinct from old.id
     or new.tenant_id is distinct from old.tenant_id
     or new.tenant_node_id is distinct from old.tenant_node_id
     or new.fact_type is distinct from old.fact_type
     or new.value is distinct from old.value
     or new.value_hash is distinct from old.value_hash
     or new.effective_at is distinct from old.effective_at
     or new.recorded_at is distinct from old.recorded_at
     or new.raw_record_id is distinct from old.raw_record_id
     or new.source_mapping_id is distinct from old.source_mapping_id
     or new.staging_batch_id is distinct from old.staging_batch_id
     or new.staged_row_no is distinct from old.staged_row_no
     or new.promoted_at is distinct from old.promoted_at
     or new.promoted_by is distinct from old.promoted_by
     or new.auto_promoted is distinct from old.auto_promoted
     or new.supersedes_id is distinct from old.supersedes_id
     or new.ancestry_ids is distinct from old.ancestry_ids then
    raise exception 'canonical_facts: append-only; only superseded_by may change.';
  end if;
  return new;
end $$;
create trigger tg_canonical_facts_forbid_update
  before update on public.canonical_facts
  for each row execute function public.tg_canonical_facts_forbid_update();

create or replace function public.tg_canonical_facts_forbid_delete()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  raise exception 'canonical_facts: hard delete forbidden (use the DSAR path).';
end $$;
create trigger tg_canonical_facts_forbid_delete
  before delete on public.canonical_facts
  for each row execute function public.tg_canonical_facts_forbid_delete();

create table public.fact_conflicts (
  id                    uuid primary key default gen_random_uuid(),
  tenant_id             uuid not null,
  tenant_node_id        uuid not null references public.tenant_nodes(id) on delete restrict,
  fact_type             text not null,
  incoming_value        jsonb not null,
  existing_value        jsonb not null,
  value_pair_hash       bytea not null,
  source_mapping_id     uuid not null references public.source_mappings(id) on delete restrict,
  staging_batch_id      uuid not null,
  row_no                int  not null,
  existing_canonical_id uuid not null references public.canonical_facts(id) on delete restrict,
  status                public.fact_conflict_status not null default 'open',
  resolution            public.fact_conflict_resolution,
  resolved_by           uuid,
  resolved_at           timestamptz,
  resolved_canonical_id uuid references public.canonical_facts(id) on delete set null,
  applied_rule_id       uuid,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);
create index idx_fact_conflicts_mapping_hash on public.fact_conflicts(source_mapping_id, fact_type, value_pair_hash);
create index idx_fact_conflicts_status on public.fact_conflicts(status) where status = 'open';
create unique index uq_fact_conflicts_open_row
  on public.fact_conflicts (staging_batch_id, row_no)
  where status = 'open';
create trigger tg_fact_conflicts_touch
  before update on public.fact_conflicts
  for each row execute function public.update_updated_at_column();

create table public.conflict_rules (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid,
  fact_type     text not null,
  precedence    int  not null,
  description   text not null,
  match_pattern jsonb not null default '{}'::jsonb,
  resolution    public.fact_conflict_resolution not null,
  active        boolean not null default true,
  superseded_by uuid references public.conflict_rules(id) on delete set null,
  created_by    uuid,
  revoked_by    uuid,
  revoked_at    timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index idx_conflict_rules_lookup on public.conflict_rules(fact_type, active, precedence desc);
create trigger tg_conflict_rules_touch
  before update on public.conflict_rules
  for each row execute function public.update_updated_at_column();

alter table public.fact_conflicts
  add constraint fact_conflicts_applied_rule_fk
  foreign key (applied_rule_id) references public.conflict_rules(id) on delete set null;

create table public.ingest_events (
  id               uuid primary key default gen_random_uuid(),
  event_type       public.ingest_event_type not null,
  tenant_id        uuid not null,
  subject_type     text not null,
  subject_id       uuid not null,
  actor_id         uuid,
  auto             boolean not null default false,
  correlation_id   uuid,
  parent_event_id  uuid references public.ingest_events(id) on delete set null,
  payload          jsonb not null default '{}'::jsonb,
  recorded_at      timestamptz not null default now()
);
create index idx_ingest_events_subject on public.ingest_events(subject_type, subject_id, recorded_at desc);
create index idx_ingest_events_correlation on public.ingest_events(correlation_id) where correlation_id is not null;

create or replace function public.tg_ingest_events_append_only()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  raise exception 'ingest_events: append-only (no UPDATE or DELETE permitted).';
end $$;
create trigger tg_ingest_events_no_update
  before update on public.ingest_events
  for each row execute function public.tg_ingest_events_append_only();
create trigger tg_ingest_events_no_delete
  before delete on public.ingest_events
  for each row execute function public.tg_ingest_events_append_only();

create or replace view public.v_ingest_pipeline_health as
with staged as (
  select tenant_id, source_mapping_id,
         count(*) filter (where validation_status = 'pending')     as staged_pending,
         count(*) filter (where validation_status = 'quarantined') as quarantined_total
  from public.staged_records group by 1,2
),
mappings as (select id, adapter_id, tenant_id from public.source_mappings),
promoted as (
  select tenant_id, source_mapping_id,
         count(*) filter (where promoted_at > now() - interval '24 hours') as promoted_24h
  from public.canonical_facts group by 1,2
),
conflicts as (
  select tenant_id, source_mapping_id,
         count(*) filter (where status = 'open') as conflicts_open,
         count(*) filter (where status = 'resolved' and resolved_at > now() - interval '24 hours') as conflicts_resolved_24h
  from public.fact_conflicts group by 1,2
)
select m.tenant_id, m.adapter_id, m.id as source_mapping_id,
  coalesce(s.staged_pending, 0)         as staged_pending,
  coalesce(s.quarantined_total, 0)      as quarantined_total,
  coalesce(p.promoted_24h, 0)           as promoted_24h,
  coalesce(c.conflicts_open, 0)         as conflicts_open,
  coalesce(c.conflicts_resolved_24h, 0) as conflicts_resolved_24h
from mappings m
left join staged    s on s.source_mapping_id = m.id
left join promoted  p on p.source_mapping_id = m.id
left join conflicts c on c.source_mapping_id = m.id;

alter table public.source_mappings  enable row level security;
alter table public.raw_records      enable row level security;
alter table public.staged_records   enable row level security;
alter table public.canonical_facts  enable row level security;
alter table public.fact_conflicts   enable row level security;
alter table public.conflict_rules   enable row level security;
alter table public.ingest_events    enable row level security;

do $$
declare t text;
begin
  foreach t in array array[
    'source_mappings','raw_records','staged_records',
    'canonical_facts','fact_conflicts','conflict_rules','ingest_events'
  ] loop
    execute format($f$
      create policy "%1$s_operator_all" on public.%1$I
        for all to authenticated
        using (public.has_role(auth.uid(), 'operator'::app_role))
        with check (public.has_role(auth.uid(), 'operator'::app_role));
    $f$, t);
  end loop;
end $$;

alter publication supabase_realtime add table public.staged_records;
alter publication supabase_realtime add table public.fact_conflicts;
alter publication supabase_realtime add table public.ingest_events;

comment on table public.canonical_facts is 'Append-only truth layer. UPDATE allowed only to set superseded_by NULL->non-null. DELETE forbidden except via DSAR path.';
comment on table public.fact_conflicts is 'Raised when a staged row would supersede a live canonical with a value outside tolerance. Never silent overwrite.';
comment on table public.ingest_events is 'Append-only ingest event stream (UPDATE/DELETE blocked by trigger).';
