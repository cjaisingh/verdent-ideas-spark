-- pgvector
create extension if not exists vector;

-- ============================================================
-- ingested_files
-- ============================================================
create table public.ingested_files (
  id uuid primary key default gen_random_uuid(),
  engagement_id uuid,           -- FK added in W9 when engagements table lands
  domain_id uuid,               -- FK added in W9 when domains table lands
  storage_bucket text not null default 'ingested-files',
  storage_path text not null,
  filename text not null,
  mime text not null,
  size_bytes bigint not null,
  sha256 text not null,
  source text not null check (source in ('upload','inbox','notebook','gha-bulk','engagement-intake')),
  status text not null default 'pending'
    check (status in ('pending','parsing','parsed','metadata_only','failed','superseded')),
  parser text,
  parser_version text,
  failure_reason text,
  uploaded_by uuid references auth.users(id) on delete set null,
  cad_fm boolean not null default false,
  declared_discipline text,
  attempts int not null default 0,
  max_attempts int not null default 3,
  last_heartbeat_at timestamptz,
  parsed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index ingested_files_engagement_sha256_uk
  on public.ingested_files (engagement_id, sha256)
  where engagement_id is not null;

create index ingested_files_status_idx on public.ingested_files (status, created_at);
create index ingested_files_engagement_idx on public.ingested_files (engagement_id, domain_id);
create index ingested_files_uploader_idx on public.ingested_files (uploaded_by);

grant select, insert, update, delete on public.ingested_files to authenticated;
grant all on public.ingested_files to service_role;

alter table public.ingested_files enable row level security;

create policy "ingested_files operator read"
  on public.ingested_files for select to authenticated
  using (public.has_role(auth.uid(), 'operator') or public.has_role(auth.uid(), 'admin'));

create policy "ingested_files operator write"
  on public.ingested_files for all to authenticated
  using (public.has_role(auth.uid(), 'operator') or public.has_role(auth.uid(), 'admin'))
  with check (public.has_role(auth.uid(), 'operator') or public.has_role(auth.uid(), 'admin'));

-- ============================================================
-- ingested_file_chunks
-- ============================================================
create table public.ingested_file_chunks (
  id uuid primary key default gen_random_uuid(),
  file_id uuid not null references public.ingested_files(id) on delete cascade,
  chunk_index int not null,
  content text not null,
  tokens int,
  embedding vector(1536),
  metadata jsonb not null default '{}'::jsonb,
  embed_model text,
  created_at timestamptz not null default now(),
  unique (file_id, chunk_index)
);

create index ingested_file_chunks_file_idx on public.ingested_file_chunks (file_id);
create index ingested_file_chunks_embedding_idx
  on public.ingested_file_chunks using hnsw (embedding vector_cosine_ops);

grant select, insert, update, delete on public.ingested_file_chunks to authenticated;
grant all on public.ingested_file_chunks to service_role;

alter table public.ingested_file_chunks enable row level security;

create policy "ingested_file_chunks operator read"
  on public.ingested_file_chunks for select to authenticated
  using (public.has_role(auth.uid(), 'operator') or public.has_role(auth.uid(), 'admin'));

create policy "ingested_file_chunks operator write"
  on public.ingested_file_chunks for all to authenticated
  using (public.has_role(auth.uid(), 'operator') or public.has_role(auth.uid(), 'admin'))
  with check (public.has_role(auth.uid(), 'operator') or public.has_role(auth.uid(), 'admin'));

-- ============================================================
-- ingested_file_events
-- ============================================================
create table public.ingested_file_events (
  id uuid primary key default gen_random_uuid(),
  file_id uuid not null references public.ingested_files(id) on delete cascade,
  event_type text not null check (event_type in (
    'uploaded','parse_started','parse_heartbeat','parsed','chunked','embedded',
    'failed','retry_queued','superseded','metadata_only'
  )),
  actor text,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index ingested_file_events_file_idx
  on public.ingested_file_events (file_id, created_at desc);

grant select, insert on public.ingested_file_events to authenticated;
grant all on public.ingested_file_events to service_role;

alter table public.ingested_file_events enable row level security;

create policy "ingested_file_events operator read"
  on public.ingested_file_events for select to authenticated
  using (public.has_role(auth.uid(), 'operator') or public.has_role(auth.uid(), 'admin'));

create policy "ingested_file_events operator insert"
  on public.ingested_file_events for insert to authenticated
  with check (public.has_role(auth.uid(), 'operator') or public.has_role(auth.uid(), 'admin'));

-- ============================================================
-- updated_at trigger
-- ============================================================
create or replace function public.tg_touch_ingested_files()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger ingested_files_touch
  before update on public.ingested_files
  for each row execute function public.tg_touch_ingested_files();

-- ============================================================
-- similarity search helper
-- ============================================================
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
security definer
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

grant execute on function public.match_ingested_chunks(vector, uuid, uuid[], int)
  to authenticated, service_role;

-- ============================================================
-- realtime
-- ============================================================
alter publication supabase_realtime add table public.ingested_files;
alter publication supabase_realtime add table public.ingested_file_events;