-- #32 — fact-conflict resolution
--
-- Phase 6 detected conflicts (ingest-csv-adapter raises fact_conflicts on a
-- live-value mismatch) but nothing could resolve them. This adds an operator
-- RPC that closes an open conflict and, when accepting the incoming value,
-- supersedes the live canonical fact — respecting the append-only triggers and
-- the uq_canonical_facts_live partial unique index.
--
-- Resolutions:
--   keep_existing        → existing canonical wins; conflict closed, no fact change.
--   accept_incoming      → supersede live canonical with the staged incoming value.
--   superseded_by_rule   → same supersede path, tagged as a rule outcome.
--   (dismiss)            → _dismiss=true; conflict marked dismissed, no fact change.
--   manual_value         → not supported in v1 (would need a matching value_hash
--                          scheme; deferred).
-- Every resolution emits a conflict_resolved ingest_event (a supersede also
-- emits fact_superseded).

-- The self-referential canonical_facts FKs are made DEFERRABLE INITIALLY
-- DEFERRED so a supersede can set the old row's superseded_by to the (not yet
-- inserted) replacement id first — taking the old row out of the live partial
-- unique index — then insert the replacement, with the FK validated at commit.
alter table public.canonical_facts
  drop constraint canonical_facts_superseded_by_fkey,
  add constraint canonical_facts_superseded_by_fkey
    foreign key (superseded_by) references public.canonical_facts(id)
    on delete set null deferrable initially deferred;

alter table public.canonical_facts
  drop constraint canonical_facts_supersedes_id_fkey,
  add constraint canonical_facts_supersedes_id_fkey
    foreign key (supersedes_id) references public.canonical_facts(id)
    on delete set null deferrable initially deferred;

create or replace function public.resolve_fact_conflict(
  _conflict_id uuid,
  _resolution public.fact_conflict_resolution default null,
  _dismiss boolean default false
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  _actor uuid := auth.uid();
  _cf public.fact_conflicts;
  _live public.canonical_facts;
  _staged public.staged_records;
  _new_id uuid;
  _resolved_canonical uuid;
begin
  -- SECURITY DEFINER bypasses RLS, so gate explicitly on the operator role.
  if _actor is null or not public.has_role(_actor, 'operator'::app_role) then
    raise exception 'forbidden: operator role required';
  end if;

  select * into _cf from public.fact_conflicts where id = _conflict_id for update;
  if not found then raise exception 'fact_conflict % not found', _conflict_id; end if;
  if _cf.status <> 'open' then
    raise exception 'fact_conflict % already %', _conflict_id, _cf.status;
  end if;

  -- Dismiss: close the conflict, leave the canonical fact untouched.
  if _dismiss then
    update public.fact_conflicts
      set status = 'dismissed', resolved_by = _actor, resolved_at = now()
      where id = _conflict_id;
    insert into public.ingest_events
      (event_type, tenant_id, subject_type, subject_id, actor_id, auto, payload)
      values ('conflict_resolved', _cf.tenant_id, 'fact_conflicts', _cf.id, _actor, false,
              jsonb_build_object('outcome', 'dismissed',
                                 'fact_type', _cf.fact_type, 'row_no', _cf.row_no));
    return jsonb_build_object('status', 'dismissed', 'conflict_id', _cf.id);
  end if;

  if _resolution is null then
    raise exception 'a resolution is required unless dismissing';
  end if;
  if _resolution = 'manual_value' then
    raise exception 'manual_value resolution is not supported in v1';
  end if;

  if _resolution = 'keep_existing' then
    _resolved_canonical := _cf.existing_canonical_id;
  else
    -- accept_incoming / superseded_by_rule: supersede the live canonical.
    select * into _live from public.canonical_facts
      where id = _cf.existing_canonical_id for update;
    if not found then
      raise exception 'existing canonical % missing', _cf.existing_canonical_id;
    end if;
    if _live.superseded_by is not null then
      raise exception 'existing canonical % already superseded — conflict is stale', _live.id;
    end if;

    select * into _staged from public.staged_records
      where staging_batch_id = _cf.staging_batch_id and row_no = _cf.row_no;
    if not found then
      raise exception 'staged provenance not found for conflict %', _conflict_id;
    end if;

    _new_id := gen_random_uuid();
    -- Flip the old row out of the live index first (FK deferred to commit).
    update public.canonical_facts set superseded_by = _new_id where id = _live.id;
    insert into public.canonical_facts (
      id, tenant_id, tenant_node_id, fact_type, value, value_hash, effective_at,
      raw_record_id, source_mapping_id, staging_batch_id, staged_row_no,
      promoted_by, auto_promoted, supersedes_id
    ) values (
      _new_id, _live.tenant_id, _live.tenant_node_id, _live.fact_type,
      _staged.value, _staged.value_hash, _live.effective_at,
      _staged.raw_record_id, _cf.source_mapping_id, _cf.staging_batch_id, _cf.row_no,
      _actor, false, _live.id
    );
    _resolved_canonical := _new_id;

    insert into public.ingest_events
      (event_type, tenant_id, subject_type, subject_id, actor_id, auto, payload)
      values ('fact_superseded', _live.tenant_id, 'canonical_facts', _new_id, _actor, false,
              jsonb_build_object('superseded', _live.id, 'fact_type', _live.fact_type));
  end if;

  update public.fact_conflicts
    set status = 'resolved', resolution = _resolution, resolved_by = _actor,
        resolved_at = now(), resolved_canonical_id = _resolved_canonical
    where id = _conflict_id;

  insert into public.ingest_events
    (event_type, tenant_id, subject_type, subject_id, actor_id, auto, payload)
    values ('conflict_resolved', _cf.tenant_id, 'fact_conflicts', _cf.id, _actor, false,
            jsonb_build_object('outcome', _resolution,
                               'resolved_canonical', _resolved_canonical,
                               'fact_type', _cf.fact_type, 'row_no', _cf.row_no));

  return jsonb_build_object('status', 'resolved', 'resolution', _resolution,
                            'conflict_id', _cf.id, 'resolved_canonical_id', _resolved_canonical);
end;
$$;

revoke execute on function public.resolve_fact_conflict(uuid, public.fact_conflict_resolution, boolean) from public;
grant execute on function public.resolve_fact_conflict(uuid, public.fact_conflict_resolution, boolean) to authenticated;
