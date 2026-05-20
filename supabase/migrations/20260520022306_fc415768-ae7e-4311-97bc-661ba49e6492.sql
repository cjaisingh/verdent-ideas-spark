create or replace function public.governance_uncovered_tasks(_days integer default 30, _missing text default 'any')
returns table(
  id uuid,
  key text,
  title text,
  status text,
  updated_at timestamptz,
  has_entity boolean,
  has_notebook boolean,
  has_authority_rule boolean
)
language plpgsql stable security definer set search_path = public as $$
begin
  if not (has_role(auth.uid(),'operator') or has_role(auth.uid(),'admin')) then
    raise exception 'not authorized';
  end if;
  if _missing not in ('entity','notebook','authority_rule','any') then
    raise exception 'invalid _missing: %', _missing;
  end if;

  return query
  with base as (
    select t.id, t.key, t.title, t.status::text as status, t.updated_at
      from public.roadmap_tasks t
     where t.status::text in ('done','shipped')
       and t.updated_at >= now() - (_days || ' days')::interval
  ),
  flags as (
    select b.*,
      exists (
        select 1 from public.governance_links gl
         where ((gl.left_kind='task' and gl.left_ref=b.id::text and gl.right_kind='entity')
             or (gl.right_kind='task' and gl.right_ref=b.id::text and gl.left_kind='entity'))
      ) as has_entity,
      exists (
        select 1 from public.governance_links gl
         where ((gl.left_kind='task' and gl.left_ref=b.id::text and gl.right_kind='notebook')
             or (gl.right_kind='task' and gl.right_ref=b.id::text and gl.left_kind='notebook'))
      ) as has_notebook,
      exists (
        select 1 from public.governance_links gl
         where ((gl.left_kind='task' and gl.left_ref=b.id::text and gl.right_kind='authority_rule')
             or (gl.right_kind='task' and gl.right_ref=b.id::text and gl.left_kind='authority_rule'))
      ) as has_authority_rule
    from base b
  )
  select f.id, f.key, f.title, f.status, f.updated_at,
         f.has_entity, f.has_notebook, f.has_authority_rule
    from flags f
   where case _missing
           when 'entity'         then not f.has_entity
           when 'notebook'       then not f.has_notebook
           when 'authority_rule' then not f.has_authority_rule
           else not (f.has_entity and f.has_notebook and f.has_authority_rule)
         end
   order by f.updated_at desc
   limit 200;
end $$;