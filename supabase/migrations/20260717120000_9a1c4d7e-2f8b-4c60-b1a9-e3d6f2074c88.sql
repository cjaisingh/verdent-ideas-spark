-- W9.1 — semantic index enrichment layer (integrates with hybrid retrieval)
-- Adds entity-aware, hierarchically structured semantic fields on top of the
-- existing hybrid (dense + lexical + RRF) retrieval already on main. Extends
-- hybrid_match_ingested_chunks to return + filter on the semantic columns so
-- ranking happens over the filtered corpus. Adds document-level coarse
-- retrieval, an entity audit table, and an atomic failure marker.

-- 1. Document-level embedding + chunk_count on ingested_files
alter table public.ingested_files
  add column if not exists doc_embedding vector(1536),
  add column if not exists chunk_count int not null default 0;

create index if not exists ingested_files_doc_embedding_idx
  on public.ingested_files using hnsw (doc_embedding vector_cosine_ops);

-- 2. Semantic index columns on ingested_file_chunks
alter table public.ingested_file_chunks
  add column if not exists chunk_type text not null default 'general'
    check (chunk_type in (
      'maintenance_record', 'asset_spec', 'compliance_clause',
      'inspection_note', 'procedure', 'general'
    )),
  add column if not exists section_id text,
  add column if not exists section_embedding vector(1536),
  add column if not exists parent_chunk_id uuid
    references public.ingested_file_chunks(id) on delete set null,
  add column if not exists entity_refs uuid[] not null default '{}',
  add column if not exists is_section_root bool not null default false;

create index if not exists ingested_file_chunks_entity_refs_idx
  on public.ingested_file_chunks using gin (entity_refs);

create index if not exists ingested_file_chunks_type_idx
  on public.ingested_file_chunks (chunk_type);

-- 3. Entity extraction audit: maps chunk → entity with confidence
create table if not exists public.ingested_chunk_entities (
  id uuid primary key default gen_random_uuid(),
  chunk_id uuid not null
    references public.ingested_file_chunks(id) on delete cascade,
  entity_id uuid not null,
  raw_mention text not null,
  confidence float not null check (confidence between 0 and 1),
  extraction_method text not null default 'string_match'
    check (extraction_method in ('string_match', 'alias_match', 'llm_extract')),
  created_at timestamptz not null default now()
);

create unique index if not exists ingested_chunk_entities_chunk_entity_uk
  on public.ingested_chunk_entities (chunk_id, entity_id);
create index if not exists ingested_chunk_entities_entity_idx
  on public.ingested_chunk_entities (entity_id);

grant select, insert, update, delete on public.ingested_chunk_entities to authenticated;
grant all on public.ingested_chunk_entities to service_role;

alter table public.ingested_chunk_entities enable row level security;

create policy "ingested_chunk_entities operator read"
  on public.ingested_chunk_entities for select to authenticated
  using (public.has_role(auth.uid(), 'operator') or public.has_role(auth.uid(), 'admin'));

create policy "ingested_chunk_entities operator write"
  on public.ingested_chunk_entities for all to authenticated
  using (public.has_role(auth.uid(), 'operator') or public.has_role(auth.uid(), 'admin'))
  with check (public.has_role(auth.uid(), 'operator') or public.has_role(auth.uid(), 'admin'));

-- 4. Extend event_type enum with the new pipeline stages
alter table public.ingested_file_events
  drop constraint if exists ingested_file_events_event_type_check;

alter table public.ingested_file_events
  add constraint ingested_file_events_event_type_check
  check (event_type in (
    'uploaded', 'parse_started', 'parse_heartbeat', 'parsed', 'chunked', 'embedded',
    'failed', 'retry_queued', 'superseded', 'metadata_only',
    'entities_extracted', 'doc_embedded'
  ));

-- 5. Keep chunk_count in sync + backfill existing rows
create or replace function public.tg_sync_chunk_count()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    update public.ingested_files set chunk_count = chunk_count + 1 where id = new.file_id;
  elsif tg_op = 'DELETE' then
    update public.ingested_files set chunk_count = greatest(0, chunk_count - 1) where id = old.file_id;
  end if;
  return null;
end;
$$;

drop trigger if exists ingested_file_chunks_sync_count on public.ingested_file_chunks;
create trigger ingested_file_chunks_sync_count
  after insert or delete on public.ingested_file_chunks
  for each row execute function public.tg_sync_chunk_count();

update public.ingested_files f
set chunk_count = (
  select count(*)::int from public.ingested_file_chunks c where c.file_id = f.id
);

-- 6. Atomic failure marker (no read-modify-write race on attempts)
create or replace function public.mark_ingest_failed(
  p_file_id uuid,
  p_failure_reason text
)
returns void
language sql
security definer
set search_path = public
as $$
  update public.ingested_files
  set status = 'failed',
      failure_reason = p_failure_reason,
      attempts = coalesce(attempts, 0) + 1
  where id = p_file_id;
$$;

grant execute on function public.mark_ingest_failed(uuid, text) to service_role;

-- 7. Document-level coarse retrieval (hierarchical first pass)
create or replace function public.match_ingested_documents(
  query_embedding vector(1536),
  p_engagement_id uuid,
  p_domain_ids uuid[] default null,
  match_count int default 5
)
returns table (
  file_id uuid,
  filename text,
  similarity float,
  domain_id uuid,
  chunk_count int,
  status text
)
language sql
stable
security invoker
set search_path = public
as $$
  select
    f.id as file_id,
    f.filename,
    1 - (f.doc_embedding <=> query_embedding) as similarity,
    f.domain_id,
    f.chunk_count,
    f.status
  from public.ingested_files f
  where f.engagement_id = p_engagement_id
    and (p_domain_ids is null or f.domain_id = any(p_domain_ids))
    and f.doc_embedding is not null
    and f.status in ('parsed', 'metadata_only')
  order by f.doc_embedding <=> query_embedding
  limit greatest(1, least(match_count, 20));
$$;

grant execute on function public.match_ingested_documents(vector, uuid, uuid[], int)
  to authenticated, service_role;

-- 8. Extend hybrid_match_ingested_chunks with semantic columns + filters.
-- Drop the existing (7-arg) signature first: both the return shape and the
-- parameter list change, so create-or-replace alone would be rejected.
drop function if exists public.hybrid_match_ingested_chunks(
  vector, text, uuid, uuid[], int, int, int
);

create or replace function public.hybrid_match_ingested_chunks(
  query_embedding vector(1536),
  query_text text,
  p_engagement_id uuid,
  p_domain_ids uuid[] default null,
  match_count int default 8,
  rrf_k int default 60,
  candidate_pool int default 50,
  p_entity_ids uuid[] default null,
  p_chunk_types text[] default null
)
returns table (
  chunk_id uuid,
  file_id uuid,
  chunk_index int,
  content text,
  metadata jsonb,
  filename text,
  domain_id uuid,
  chunk_type text,
  section_id text,
  entity_refs uuid[],
  dense_rank int,
  lexical_rank int,
  dense_similarity float,
  lexical_score float,
  rrf_score float
)
language sql
stable
security invoker
set search_path = public
as $$
  with
  scope as (
    select c.id, c.file_id, c.chunk_index, c.content, c.metadata, c.embedding, c.content_tsv,
           c.chunk_type, c.section_id, c.entity_refs,
           f.filename, f.domain_id
    from public.ingested_file_chunks c
    join public.ingested_files f on f.id = c.file_id
    where f.engagement_id = p_engagement_id
      and (p_domain_ids is null or f.domain_id = any(p_domain_ids))
      -- Semantic filters applied inside retrieval so ranking + candidate_pool
      -- operate over the filtered corpus, not a post-hoc slice of top-K.
      and (p_chunk_types is null or c.chunk_type = any(p_chunk_types))
      and (p_entity_ids is null or c.entity_refs && p_entity_ids)
  ),
  dense as (
    select s.id,
           1 - (s.embedding <=> query_embedding) as similarity,
           row_number() over (order by s.embedding <=> query_embedding) as rnk
    from scope s
    where query_embedding is not null
      and s.embedding is not null
    order by s.embedding <=> query_embedding
    limit greatest(1, candidate_pool)
  ),
  lex_q as (
    select case
      when coalesce(nullif(trim(query_text), ''), '') = '' then null
      else websearch_to_tsquery('english', query_text)
    end as q
  ),
  lex as (
    select s.id,
           ts_rank_cd(s.content_tsv, lex_q.q) as score,
           row_number() over (order by ts_rank_cd(s.content_tsv, lex_q.q) desc) as rnk
    from scope s, lex_q
    where lex_q.q is not null
      and s.content_tsv @@ lex_q.q
    order by ts_rank_cd(s.content_tsv, lex_q.q) desc
    limit greatest(1, candidate_pool)
  ),
  fused as (
    select coalesce(d.id, l.id) as id,
           d.rnk as dense_rnk,
           l.rnk as lex_rnk,
           d.similarity as dense_sim,
           l.score as lex_score,
           coalesce(1.0 / (rrf_k + d.rnk), 0.0)
             + coalesce(1.0 / (rrf_k + l.rnk), 0.0) as rrf
    from dense d
    full outer join lex l on l.id = d.id
  )
  select s.id,
         s.file_id,
         s.chunk_index,
         s.content,
         s.metadata,
         s.filename,
         s.domain_id,
         s.chunk_type,
         s.section_id,
         s.entity_refs,
         f.dense_rnk::int,
         f.lex_rnk::int,
         f.dense_sim::float,
         f.lex_score::float,
         f.rrf::float
  from fused f
  join scope s on s.id = f.id
  where f.rrf > 0
  order by f.rrf desc nulls last
  limit greatest(1, least(match_count, 50));
$$;

grant execute on function public.hybrid_match_ingested_chunks(
  vector, text, uuid, uuid[], int, int, int, uuid[], text[]
) to authenticated, service_role;
