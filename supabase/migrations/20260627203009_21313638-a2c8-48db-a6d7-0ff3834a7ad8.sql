
alter table public.ingested_file_chunks
  add column if not exists content_tsv tsvector
    generated always as (to_tsvector('english', coalesce(content, ''))) stored;

create index if not exists ingested_file_chunks_tsv_idx
  on public.ingested_file_chunks using gin (content_tsv);

create or replace function public.hybrid_match_ingested_chunks(
  query_embedding vector(1536),
  query_text text,
  p_engagement_id uuid,
  p_domain_ids uuid[] default null,
  match_count int default 8,
  rrf_k int default 60,
  candidate_pool int default 50
)
returns table (
  file_id uuid,
  chunk_index int,
  content text,
  metadata jsonb,
  filename text,
  domain_id uuid,
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
           f.filename, f.domain_id
    from public.ingested_file_chunks c
    join public.ingested_files f on f.id = c.file_id
    where f.engagement_id = p_engagement_id
      and (p_domain_ids is null or f.domain_id = any(p_domain_ids))
  ),
  dense as (
    select s.id,
           1 - (s.embedding <=> query_embedding) as similarity,
           row_number() over (order by s.embedding <=> query_embedding) as rnk
    from scope s
    where s.embedding is not null
    order by s.embedding <=> query_embedding
    limit greatest(1, candidate_pool)
  ),
  lex_q as (
    select websearch_to_tsquery('english', coalesce(query_text, '')) as q
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
  select s.file_id,
         s.chunk_index,
         s.content,
         s.metadata,
         s.filename,
         s.domain_id,
         f.dense_rnk::int,
         f.lex_rnk::int,
         f.dense_sim::float,
         f.lex_score::float,
         f.rrf::float
  from fused f
  join scope s on s.id = f.id
  order by f.rrf desc nulls last
  limit greatest(1, least(match_count, 50));
$$;

grant execute on function public.hybrid_match_ingested_chunks(
  vector, text, uuid, uuid[], int, int, int
) to authenticated, service_role;
