-- Phase 5 s5.3 M3
-- 1) Tenant-scoped vector match for alias embedding-hint branch.
create or replace function public.match_alias_embedding(
  _tenant_id uuid,
  _query vector(1536),
  _min_similarity float default 0.6,
  _top_k int default 10
)
returns table (
  alias_id uuid,
  node_id uuid,
  kind alias_descriptor_kind,
  similarity float
)
language sql
stable
security definer
set search_path = public
as $$
  select
    a.id as alias_id,
    a.node_id,
    a.kind,
    1 - (e.embedding <=> _query) as similarity
  from public.tenant_node_alias_embeddings e
  join public.tenant_node_aliases a on a.id = e.alias_id
  where e.tenant_id = _tenant_id
    and a.tenant_id = _tenant_id
    and a.revoked_at is null
    and 1 - (e.embedding <=> _query) >= _min_similarity
  order by e.embedding <=> _query
  limit greatest(1, least(_top_k, 50));
$$;

grant execute on function public.match_alias_embedding(uuid, vector, float, int) to authenticated, service_role;

-- 2) Revocation-lookup index (ADR-0004 acceptance bench will measure p95 against this).
create index if not exists idx_alias_tenant_revoked
  on public.tenant_node_aliases (tenant_id, revoked_at);

-- 3) Observability registry row for the new sentinel check (added in this sprint).
insert into public.observability_registry
  (surface_kind, surface_id, expected_cadence_minutes, watcher_kinds, owner, notes, declared_in)
values
  ('table', 'entity_resolution_events_alias_revoke', 15,
   array['alias_revoke_burst'], 'phase-5',
   'Watches alias_revoke event spikes per tenant (>10 in 15 min = high).',
   'docs/adr/0004-alias-revocation-cascade.md')
on conflict (surface_kind, surface_id) do update
  set watcher_kinds = excluded.watcher_kinds,
      expected_cadence_minutes = excluded.expected_cadence_minutes,
      notes = excluded.notes,
      declared_in = excluded.declared_in,
      updated_at = now();