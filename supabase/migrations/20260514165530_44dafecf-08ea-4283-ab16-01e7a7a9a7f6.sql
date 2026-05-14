drop view if exists public.truth_conflicts;
create view public.truth_conflicts
with (security_invoker = true) as
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