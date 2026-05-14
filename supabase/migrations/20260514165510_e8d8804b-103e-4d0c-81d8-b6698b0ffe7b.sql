-- W7.2 Claims pipeline
create table if not exists public.claims (
  id uuid primary key default gen_random_uuid(),
  entity text not null,
  entity_id uuid not null,
  field text not null default '*',
  source text not null,
  value jsonb not null,
  confidence numeric not null default 1.0 check (confidence >= 0 and confidence <= 1),
  evidence_ref jsonb not null default '{}'::jsonb,
  supersedes_id uuid references public.claims(id) on delete set null,
  valid_from timestamptz not null default now(),
  valid_to timestamptz,
  voided_at timestamptz,
  voided_reason text,
  claimed_by uuid,
  claimed_by_label text,
  note text,
  created_at timestamptz not null default now(),
  check (valid_to is null or valid_to > valid_from)
);

create index if not exists idx_claims_entity_field on public.claims (entity, entity_id, field);
create index if not exists idx_claims_supersedes on public.claims (supersedes_id);
create index if not exists idx_claims_active on public.claims (entity, entity_id, field) where voided_at is null;

alter table public.claims enable row level security;

create policy "operators read claims" on public.claims for select
  using (public.has_role(auth.uid(),'operator') or public.has_role(auth.uid(),'admin'));
create policy "operators write claims" on public.claims for insert
  with check (public.has_role(auth.uid(),'operator') or public.has_role(auth.uid(),'admin'));
create policy "operators update claims" on public.claims for update
  using (public.has_role(auth.uid(),'operator') or public.has_role(auth.uid(),'admin'));

-- Claim audit events
create table if not exists public.claim_events (
  id uuid primary key default gen_random_uuid(),
  claim_id uuid,
  entity text not null,
  entity_id uuid not null,
  field text not null,
  source text not null,
  event_type text not null check (event_type in ('created','superseded','voided','expired')),
  actor uuid,
  actor_label text,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

alter table public.claim_events enable row level security;
create policy "operators read claim_events" on public.claim_events for select
  using (public.has_role(auth.uid(),'operator') or public.has_role(auth.uid(),'admin'));

create or replace function public.log_claim_event()
returns trigger language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); label text; supers public.claims%rowtype;
begin
  select email into label from auth.users where id = uid;
  if label is null then label := coalesce(new.claimed_by_label, 'system'); end if;

  if TG_OP = 'INSERT' then
    insert into public.claim_events(claim_id, entity, entity_id, field, source, event_type, actor, actor_label, payload)
      values (new.id, new.entity, new.entity_id, new.field, new.source, 'created', uid, label,
              jsonb_build_object('value', new.value, 'confidence', new.confidence,
                                 'supersedes_id', new.supersedes_id,
                                 'evidence_ref', new.evidence_ref,
                                 'valid_from', new.valid_from, 'valid_to', new.valid_to));
    if new.supersedes_id is not null then
      select * into supers from public.claims where id = new.supersedes_id;
      if found then
        update public.claims
           set voided_at = coalesce(voided_at, now()),
               voided_reason = coalesce(voided_reason, 'superseded by ' || new.id::text)
         where id = new.supersedes_id;
        insert into public.claim_events(claim_id, entity, entity_id, field, source, event_type, actor, actor_label, payload)
          values (supers.id, supers.entity, supers.entity_id, supers.field, supers.source, 'superseded',
                  uid, label, jsonb_build_object('superseded_by', new.id));
      end if;
    end if;
    return new;
  elsif TG_OP = 'UPDATE' then
    if old.voided_at is null and new.voided_at is not null then
      insert into public.claim_events(claim_id, entity, entity_id, field, source, event_type, actor, actor_label, payload)
        values (new.id, new.entity, new.entity_id, new.field, new.source, 'voided', uid, label,
                jsonb_build_object('reason', new.voided_reason));
    end if;
    return new;
  end if;
  return null;
end $$;

drop trigger if exists claims_log on public.claims;
create trigger claims_log
  after insert or update on public.claims
  for each row execute function public.log_claim_event();

-- Resolver: real winner selection
create or replace function public.resolve_truth(_entity text, _entity_id uuid, _field text default '*')
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  rules jsonb;
  scored jsonb;
  winner jsonb;
  status_text text;
  best record;
  runner record;
  score_gap numeric;
begin
  if not (public.has_role(auth.uid(),'operator') or public.has_role(auth.uid(),'admin')) then
    raise exception 'not authorized';
  end if;

  select coalesce(jsonb_agg(r order by r.precedence), '[]'::jsonb)
    into rules
  from (
    select source, precedence, weight, override_policy, notes
    from public.decision_authorities
    where entity = _entity
      and (field = _field or field = '*')
    order by case when field = _field then 0 else 1 end, precedence
  ) r;

  -- Score all active claims for this entity/field
  select coalesce(jsonb_agg(s order by s.precedence asc, s.score desc), '[]'::jsonb)
    into scored
  from (
    select c.id, c.source, c.value, c.confidence, c.valid_from, c.valid_to,
           c.evidence_ref, c.claimed_by_label, c.created_at,
           coalesce(da.precedence, 999) as precedence,
           coalesce(da.weight, 0.1) * c.confidence as score,
           coalesce(da.override_policy, 'soft') as override_policy
    from public.claims c
    left join public.decision_authorities da
      on da.entity = c.entity
     and (da.field = c.field or da.field = '*')
     and da.source = c.source
    where c.entity = _entity
      and c.entity_id = _entity_id
      and (c.field = _field or _field = '*')
      and c.voided_at is null
      and c.valid_from <= now()
      and (c.valid_to is null or c.valid_to > now())
    order by precedence asc, score desc, created_at desc
  ) s;

  if jsonb_array_length(scored) = 0 then
    return jsonb_build_object('entity', _entity, 'entity_id', _entity_id, 'field', _field,
                              'winner', null, 'status', 'no-claims', 'rules', rules, 'claims', scored);
  end if;

  -- Pick winner: lowest precedence, then highest score, then most recent
  select (scored->0) into winner;

  -- Conflict check: if next claim shares precedence and score is within 10%, mark conflict
  status_text := 'resolved';
  if jsonb_array_length(scored) > 1 then
    if ((scored->0->>'precedence')::int = (scored->1->>'precedence')::int)
       and (scored->0->>'source') <> (scored->1->>'source') then
      score_gap := (scored->0->>'score')::numeric - (scored->1->>'score')::numeric;
      if (scored->0->>'score')::numeric > 0
         and score_gap / (scored->0->>'score')::numeric < 0.10 then
        status_text := 'conflict';
      end if;
    end if;
  end if;

  return jsonb_build_object(
    'entity', _entity,
    'entity_id', _entity_id,
    'field', _field,
    'winner', winner,
    'status', status_text,
    'rules', rules,
    'claims', scored
  );
end $$;

-- View: unresolved conflicts for sentinel
create or replace view public.truth_conflicts as
with active as (
  select c.entity, c.entity_id, c.field, c.source, c.value, c.confidence,
         coalesce(da.precedence, 999) as precedence,
         coalesce(da.weight, 0.1) * c.confidence as score,
         c.id as claim_id, c.created_at
  from public.claims c
  left join public.decision_authorities da
    on da.entity = c.entity and (da.field = c.field or da.field = '*') and da.source = c.source
  where c.voided_at is null
    and c.valid_from <= now()
    and (c.valid_to is null or c.valid_to > now())
), ranked as (
  select *, row_number() over (partition by entity, entity_id, field order by precedence asc, score desc, created_at desc) as rn
  from active
), top_two as (
  select entity, entity_id, field,
         max(case when rn=1 then source end) as top_source,
         max(case when rn=1 then score end) as top_score,
         max(case when rn=1 then precedence end) as top_precedence,
         max(case when rn=2 then source end) as next_source,
         max(case when rn=2 then score end) as next_score,
         max(case when rn=2 then precedence end) as next_precedence
  from ranked
  where rn <= 2
  group by entity, entity_id, field
)
select entity, entity_id, field, top_source, top_score, next_source, next_score
from top_two
where next_source is not null
  and top_precedence = next_precedence
  and top_source <> next_source
  and top_score > 0
  and (top_score - next_score) / top_score < 0.10;

alter publication supabase_realtime add table public.claims;
alter publication supabase_realtime add table public.claim_events;