-- W10-S3: stage transitions, auto-stamping on parse, approval-filtered retrieval.

-- Ladder helper: does a file's lifecycle meet a minimum approval state?
create or replace function public.lifecycle_meets(_lc public.doc_lifecycle, _min text)
returns boolean language sql immutable set search_path = public as $$
  select case coalesce(_min, 'approved')
    when 'any' then _lc not in ('rejected','quarantined','archived','superseded')
    when 'auto_approved' then _lc in ('auto_approved','approved')
    else _lc = 'approved'
  end
$$;

-- Operator-driven stage move with transition rules + four-eyes.
create or replace function public.transition_file_lifecycle(_file_id uuid, _to public.doc_lifecycle, _reason text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  _uid uuid := auth.uid();
  _f public.ingested_files%rowtype;
  _mode public.approval_mode;
  _submitter text;
  _evt text;
  _allowed boolean;
begin
  if _uid is null or not (public.has_role(_uid,'operator') or public.has_role(_uid,'admin')) then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  select * into _f from public.ingested_files where id = _file_id for update;
  if not found then raise exception 'file_not_found'; end if;

  _allowed := case _f.lifecycle
    when 'ingested'       then _to in ('pending_review','quarantined','rejected')
    when 'pending_review' then _to in ('approved','rejected','quarantined')
    when 'auto_approved'  then _to in ('approved','pending_review','quarantined','superseded','archived')
    when 'approved'       then _to in ('superseded','archived','quarantined')
    when 'quarantined'    then _to in ('pending_review','rejected')
    else false end;
  if not _allowed then
    raise exception 'invalid_transition: % -> %', _f.lifecycle, _to;
  end if;
  if _to in ('rejected','quarantined','archived') and coalesce(trim(_reason),'') = '' then
    raise exception 'reason_required';
  end if;

  if _to = 'approved' then
    select mode into _mode from public.document_approval_policies where records_class = _f.records_class;
    if _mode = 'four_eyes' then
      select actor into _submitter from public.ingested_file_events
        where file_id = _file_id and event_type = 'submitted_for_review'
        order by created_at desc limit 1;
      if _submitter = _uid::text then raise exception 'four_eyes_same_actor'; end if;
    end if;
    if _f.legal_hold is false and _f.revision_of is not null then
      update public.ingested_files set lifecycle = 'superseded', updated_at = now()
        where id = _f.revision_of and lifecycle in ('approved','auto_approved');
      if found then
        insert into public.ingested_file_events(file_id, event_type, actor, payload)
          values (_f.revision_of, 'revision_superseded', _uid::text, jsonb_build_object('by', _file_id));
      end if;
    end if;
  end if;

  update public.ingested_files set
    lifecycle = _to,
    approved_by = case when _to = 'approved' then _uid else approved_by end,
    approved_at = case when _to = 'approved' then now() else approved_at end,
    updated_at = now()
  where id = _file_id;

  _evt := case _to
    when 'pending_review' then 'submitted_for_review'
    when 'approved' then 'document_approved'
    when 'rejected' then 'document_rejected'
    when 'quarantined' then 'document_quarantined'
    when 'superseded' then 'superseded'
    else 'superseded' end;
  if _to = 'archived' then _evt := 'superseded'; end if;
  insert into public.ingested_file_events(file_id, event_type, actor, payload)
    values (_file_id, _evt, _uid::text,
            jsonb_build_object('from', _f.lifecycle, 'to', _to, 'reason', _reason));
  return jsonb_build_object('file_id', _file_id, 'from', _f.lifecycle, 'to', _to);
end $$;
revoke all on function public.transition_file_lifecycle(uuid, public.doc_lifecycle, text) from public, anon;
grant execute on function public.transition_file_lifecycle(uuid, public.doc_lifecycle, text) to authenticated, service_role;

-- System stamping after a successful parse: auto-approve or queue for review.
create or replace function public.stamp_file_lifecycle_on_parse(_file_id uuid)
returns public.doc_lifecycle language plpgsql security definer set search_path = public as $$
declare
  _f public.ingested_files%rowtype;
  _p public.document_approval_policies%rowtype;
  _ok boolean := true;
  _to public.doc_lifecycle;
begin
  select * into _f from public.ingested_files where id = _file_id for update;
  if not found or _f.lifecycle <> 'ingested' then return _f.lifecycle; end if;
  select * into _p from public.document_approval_policies where records_class = _f.records_class;
  if _p.mode = 'auto' then
    if coalesce((_p.auto_conditions->>'require_clean_parse')::boolean, false) and _f.status <> 'parsed' then _ok := false; end if;
    -- Lawful basis = file belongs to an engagement (engagement contract).
    if coalesce((_p.auto_conditions->>'require_lawful_basis')::boolean, false) and _f.engagement_id is null then _ok := false; end if;
  else
    _ok := false;
  end if;
  _to := case when _ok then 'auto_approved'::public.doc_lifecycle else 'pending_review'::public.doc_lifecycle end;
  update public.ingested_files set lifecycle = _to, updated_at = now() where id = _file_id;
  insert into public.ingested_file_events(file_id, event_type, actor, payload)
    values (_file_id, case when _ok then 'document_auto_approved' else 'submitted_for_review' end, 'system',
            jsonb_build_object('records_class', _f.records_class, 'mode', coalesce(_p.mode::text,'none')));
  return _to;
end $$;
revoke all on function public.stamp_file_lifecycle_on_parse(uuid) from public, anon, authenticated;
grant execute on function public.stamp_file_lifecycle_on_parse(uuid) to service_role;

-- Close the anon grant on set_legal_hold (follow-up from S1).
revoke execute on function public.set_legal_hold(uuid, boolean, text) from anon, public;

-- Approval-filtered hybrid retrieval (replaces 7-arg live version).
drop function if exists public.hybrid_match_ingested_chunks(vector, text, uuid, uuid[], integer, integer, integer);
create or replace function public.hybrid_match_ingested_chunks(
  query_embedding vector(1536), query_text text, p_engagement_id uuid,
  p_domain_ids uuid[] default null, match_count int default 8, rrf_k int default 60,
  candidate_pool int default 50, p_entity_ids uuid[] default null, p_chunk_types text[] default null,
  p_min_approval text default 'approved')
returns table (chunk_id uuid, file_id uuid, chunk_index int, content text, metadata jsonb, filename text,
  domain_id uuid, chunk_type text, section_id text, entity_refs uuid[], lifecycle text,
  dense_rank int, lexical_rank int, dense_similarity float, lexical_score float, rrf_score float)
language sql stable security invoker set search_path = public as $$
  with scope as (
    select c.id, c.file_id, c.chunk_index, c.content, c.metadata, c.embedding, c.content_tsv,
           f.filename, f.domain_id, f.lifecycle
    from public.ingested_file_chunks c
    join public.ingested_files f on f.id = c.file_id
    where f.engagement_id = p_engagement_id
      and (p_domain_ids is null or f.domain_id = any(p_domain_ids))
      and public.lifecycle_meets(f.lifecycle, p_min_approval)
  ),
  dense as (
    select s.id, 1 - (s.embedding <=> query_embedding) as similarity,
           row_number() over (order by s.embedding <=> query_embedding) as rnk
    from scope s where query_embedding is not null and s.embedding is not null
    order by s.embedding <=> query_embedding limit greatest(1, candidate_pool)
  ),
  lex_q as (
    select case when coalesce(nullif(trim(query_text), ''), '') = '' then null
                else websearch_to_tsquery('english', query_text) end as q
  ),
  lex as (
    select s.id, ts_rank_cd(s.content_tsv, lex_q.q) as score,
           row_number() over (order by ts_rank_cd(s.content_tsv, lex_q.q) desc) as rnk
    from scope s, lex_q where lex_q.q is not null and s.content_tsv @@ lex_q.q
    order by ts_rank_cd(s.content_tsv, lex_q.q) desc limit greatest(1, candidate_pool)
  ),
  fused as (
    select coalesce(d.id, l.id) as id, d.rnk as dense_rnk, l.rnk as lex_rnk,
           d.similarity as dense_sim, l.score as lex_score,
           coalesce(1.0 / (rrf_k + d.rnk), 0.0) + coalesce(1.0 / (rrf_k + l.rnk), 0.0) as rrf
    from dense d full outer join lex l on l.id = d.id
  )
  select s.id, s.file_id, s.chunk_index, s.content, s.metadata, s.filename, s.domain_id,
         null::text, null::text, null::uuid[], s.lifecycle::text,
         fu.dense_rnk::int, fu.lex_rnk::int, fu.dense_sim::float, fu.lex_score::float, fu.rrf::float
  from fused fu join scope s on s.id = fu.id
  order by fu.rrf desc limit greatest(1, match_count)
$$;
grant execute on function public.hybrid_match_ingested_chunks(vector, text, uuid, uuid[], int, int, int, uuid[], text[], text) to authenticated, service_role;

-- Same gate on the dense-only RPC.
create or replace function public.match_ingested_chunks_approved(
  query_embedding vector(1536), p_engagement_id uuid, p_domain_ids uuid[] default null,
  match_count int default 8, p_min_approval text default 'approved')
returns table (file_id uuid, chunk_index int, content text, metadata jsonb, filename text, similarity float)
language sql stable security invoker set search_path = public as $$
  select c.file_id, c.chunk_index, c.content, c.metadata, f.filename, 1 - (c.embedding <=> query_embedding)
  from public.ingested_file_chunks c join public.ingested_files f on f.id = c.file_id
  where f.engagement_id = p_engagement_id
    and (p_domain_ids is null or f.domain_id = any(p_domain_ids))
    and c.embedding is not null
    and public.lifecycle_meets(f.lifecycle, p_min_approval)
  order by c.embedding <=> query_embedding limit greatest(1, match_count)
$$;
grant execute on function public.match_ingested_chunks_approved(vector, uuid, uuid[], int, text) to authenticated, service_role;