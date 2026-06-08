-- Switch to SECURITY INVOKER (RLS on chunks+files already gates access)
create or replace function public.match_ingested_chunks(
  query_embedding vector(1536),
  p_engagement_id uuid,
  p_domain_ids uuid[] default null,
  match_count int default 8
)
returns table (
  file_id uuid,
  chunk_index int,
  content text,
  similarity float,
  metadata jsonb,
  filename text,
  domain_id uuid
)
language sql
stable
security invoker
set search_path = public
as $$
  select
    c.file_id,
    c.chunk_index,
    c.content,
    1 - (c.embedding <=> query_embedding) as similarity,
    c.metadata,
    f.filename,
    f.domain_id
  from public.ingested_file_chunks c
  join public.ingested_files f on f.id = c.file_id
  where f.engagement_id = p_engagement_id
    and (p_domain_ids is null or f.domain_id = any(p_domain_ids))
    and c.embedding is not null
  order by c.embedding <=> query_embedding
  limit greatest(1, least(match_count, 50));
$$;

-- Storage RLS on ingested-files bucket
create policy "ingested-files operator read"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'ingested-files'
    and (public.has_role(auth.uid(),'operator') or public.has_role(auth.uid(),'admin'))
  );

create policy "ingested-files operator write"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'ingested-files'
    and (public.has_role(auth.uid(),'operator') or public.has_role(auth.uid(),'admin'))
  );

create policy "ingested-files operator delete"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'ingested-files'
    and (public.has_role(auth.uid(),'operator') or public.has_role(auth.uid(),'admin'))
  );