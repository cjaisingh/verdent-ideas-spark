-- s5.3: alias lifecycle columns
alter table public.tenant_node_aliases
  add column if not exists supersedes_alias_id uuid references public.tenant_node_aliases(id) on delete set null,
  add column if not exists merge_group_id uuid,
  add column if not exists hard_revoked boolean not null default false,
  add column if not exists revoke_reason text;

create index if not exists idx_tenant_node_aliases_supersedes
  on public.tenant_node_aliases(supersedes_alias_id)
  where supersedes_alias_id is not null;

create index if not exists idx_tenant_node_aliases_merge_group
  on public.tenant_node_aliases(merge_group_id)
  where merge_group_id is not null;

-- Hard revokes must carry a reason ≥ 8 chars
alter table public.tenant_node_aliases
  drop constraint if exists tenant_node_aliases_hard_revoke_reason_chk;
alter table public.tenant_node_aliases
  add constraint tenant_node_aliases_hard_revoke_reason_chk
  check (hard_revoked = false or (revoke_reason is not null and length(revoke_reason) >= 8));

-- Extend resolution-event enum
do $$
begin
  if not exists (select 1 from pg_enum where enumtypid = 'public.entity_resolution_event_kind'::regtype and enumlabel = 'alias_merge') then
    alter type public.entity_resolution_event_kind add value 'alias_merge';
  end if;
  if not exists (select 1 from pg_enum where enumtypid = 'public.entity_resolution_event_kind'::regtype and enumlabel = 'alias_split') then
    alter type public.entity_resolution_event_kind add value 'alias_split';
  end if;
  if not exists (select 1 from pg_enum where enumtypid = 'public.entity_resolution_event_kind'::regtype and enumlabel = 'alias_hard_revoke') then
    alter type public.entity_resolution_event_kind add value 'alias_hard_revoke';
  end if;
end$$;

-- Effective-alias resolver (follows supersedes chain, depth-capped)
create or replace function public.tenant_node_alias_effective(_alias_id uuid)
returns uuid
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  cur uuid := _alias_id;
  nxt uuid;
  hops int := 0;
begin
  loop
    select id into nxt
    from public.tenant_node_aliases
    where supersedes_alias_id = cur and revoked_at is null
    limit 1;
    exit when nxt is null;
    cur := nxt;
    hops := hops + 1;
    if hops > 32 then exit; end if;
  end loop;
  return cur;
end$$;

-- pgvector store for last-resort embedding-hint
create extension if not exists vector;

create table if not exists public.tenant_node_alias_embeddings (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  alias_id uuid not null references public.tenant_node_aliases(id) on delete cascade,
  node_id uuid not null,
  content text not null,
  embedding vector(1536) not null,
  model text not null default 'openai/text-embedding-3-small',
  created_at timestamptz not null default now(),
  unique (alias_id)
);

create index if not exists idx_alias_emb_tenant on public.tenant_node_alias_embeddings(tenant_id);
create index if not exists idx_alias_emb_node on public.tenant_node_alias_embeddings(node_id);
create index if not exists idx_alias_emb_vec
  on public.tenant_node_alias_embeddings
  using hnsw (embedding vector_cosine_ops)
  with (m = 16, ef_construction = 64);

alter table public.tenant_node_alias_embeddings enable row level security;

drop policy if exists "admins read alias embeddings" on public.tenant_node_alias_embeddings;
create policy "admins read alias embeddings"
  on public.tenant_node_alias_embeddings
  for select
  to authenticated
  using (public.has_role(auth.uid(), 'admin'));

drop policy if exists "admins write alias embeddings" on public.tenant_node_alias_embeddings;
create policy "admins write alias embeddings"
  on public.tenant_node_alias_embeddings
  for all
  to authenticated
  using (public.has_role(auth.uid(), 'admin'))
  with check (public.has_role(auth.uid(), 'admin'));

alter publication supabase_realtime add table public.tenant_node_alias_embeddings;

-- Lineage health view (operator-readable)
create or replace view public.v_alias_lineage_health as
select
  tenant_id,
  count(*) filter (where revoked_at is null and supersedes_alias_id is null)            as active_aliases,
  count(*) filter (where revoked_at is not null and hard_revoked = false)               as soft_revoked,
  count(*) filter (where hard_revoked = true)                                           as hard_revoked,
  count(*) filter (where supersedes_alias_id is not null)                               as superseded_count,
  count(distinct merge_group_id) filter (where merge_group_id is not null)              as merge_groups,
  count(*) filter (where revoked_at >= now() - interval '24 hours')                     as revokes_24h,
  count(*) filter (where revoked_at >= now() - interval '1 hour')                       as revokes_1h
from public.tenant_node_aliases
group by tenant_id;

comment on view public.v_alias_lineage_health is
  's5.3 lineage health — surfaces alias activity per tenant for /entities/aliases admin and alias_revoke_burst sentinel.';