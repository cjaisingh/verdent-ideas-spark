create or replace function public.resolve_truth_service(_entity text, _entity_id uuid, _field text default '*')
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  rules jsonb;
  scored jsonb;
  winner jsonb;
  status_text text;
  score_gap numeric;
begin
  select coalesce(jsonb_agg(r order by r.precedence), '[]'::jsonb)
    into rules
  from (
    select source, precedence, weight, override_policy, notes
    from public.decision_authorities
    where entity = _entity
      and (field = _field or field = '*')
    order by case when field = _field then 0 else 1 end, precedence
  ) r;

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

  select (scored->0) into winner;

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

revoke all on function public.resolve_truth_service(text, uuid, text) from public;
revoke all on function public.resolve_truth_service(text, uuid, text) from anon, authenticated;
grant execute on function public.resolve_truth_service(text, uuid, text) to service_role;