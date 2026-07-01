alter table public.canonical_facts
  add column if not exists content_tsv tsvector
  generated always as (
    to_tsvector(
      'simple',
      coalesce(fact_type, '') || ' ' || coalesce(value::text, '')
    )
  ) stored;

create index if not exists canonical_facts_content_tsv_idx
  on public.canonical_facts using gin (content_tsv);

create or replace function public.search_canonical_facts(
  q text,
  engagement uuid,
  match_count int default 20
)
returns table (
  fact_id uuid,
  tenant_node_id uuid,
  fact_type text,
  value jsonb,
  effective_at timestamptz,
  file_id uuid,
  filename text,
  lexical_score real
)
language sql
stable
security definer
set search_path = public
as $$
  select
    cf.id,
    cf.tenant_node_id,
    cf.fact_type,
    cf.value,
    cf.effective_at,
    f.id,
    f.filename,
    case
      when coalesce(q, '') = '' then 0::real
      else ts_rank_cd(cf.content_tsv, websearch_to_tsquery('simple', q))
    end as lexical_score
  from public.canonical_facts cf
  join public.raw_records rr
    on rr.id = cf.raw_record_id
   and rr.source_kind = 'file'
  join public.ingested_files f
    on f.id::text = rr.source_id
  where f.engagement_id = engagement
    and cf.superseded_by is null
    and (
      coalesce(q, '') = ''
      or cf.content_tsv @@ websearch_to_tsquery('simple', q)
    )
  order by lexical_score desc, cf.effective_at desc
  limit greatest(match_count, 1);
$$;

grant execute on function public.search_canonical_facts(text, uuid, int)
  to authenticated, service_role;

comment on function public.search_canonical_facts is
  'W9.1 structured retrieval leg. Lexical search over canonical_facts joined via raw_records.source_id → ingested_files.id (cast) to an engagement. Returns live facts only (superseded_by IS NULL). Called by ingest-search when include_facts=true.';