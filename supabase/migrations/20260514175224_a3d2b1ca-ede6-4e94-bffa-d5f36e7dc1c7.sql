-- W7 closeout slice 2a: auto-link governance + backfill
-- Maps roadmap_tasks to a canonical ontology entity by module/title and inserts
-- governance_links rows. Idempotent (uses NOT EXISTS guard) so safe to re-run.

create or replace function public.infer_task_entity(_module text, _title text)
returns text
language sql
immutable
as $$
  select case
    when coalesce(_module,'') ilike '%sentinel%' or coalesce(_title,'') ilike '%sentinel%' then 'SentinelFinding'
    when coalesce(_module,'') ilike '%audit%'    or coalesce(_title,'') ilike '%audit%'    then 'AuditFinding'
    when coalesce(_module,'') ilike '%lesson%'   or coalesce(_title,'') ilike '%lesson%'   then 'Lesson'
    when coalesce(_module,'') ilike '%capabil%'  or coalesce(_title,'') ilike '%capabil%'  then 'Capability'
    when coalesce(_module,'') ilike '%okr%'      or coalesce(_title,'') ilike '%okr%'      then 'OkrNode'
    when coalesce(_module,'') ilike '%tenant%'   or coalesce(_title,'') ilike '%tenant%'   then 'Tenant'
    when coalesce(_module,'') ilike '%test%'     or coalesce(_title,'') ilike '%test%'
      or coalesce(_module,'') ilike 'ci%'        or coalesce(_title,'') ilike '%ci %'      then 'TestRun'
    when coalesce(_module,'') ilike '%roadmap%'  or coalesce(_module,'') ilike '%phase%'
      or coalesce(_title,'')  ilike '%phase%'                                              then 'RoadmapPhase'
    else 'DiscussionAction'
  end
$$;

comment on function public.infer_task_entity is
  'W7 closeout: heuristically map a roadmap_task (module/title) to one canonical ontology entity for governance linking.';

-- Trigger: when a discussion_action gets promoted to a task, auto-link the task
-- to (1) DiscussionAction and (2) the inferred entity from the task itself.
create or replace function public.auto_link_promoted_task()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  inferred text;
  t_module text;
  t_title text;
begin
  if new.promoted_task_id is null then
    return new;
  end if;
  if tg_op = 'UPDATE' and old.promoted_task_id is not distinct from new.promoted_task_id then
    return new;
  end if;

  -- (1) task ↔ DiscussionAction (always — it literally was one)
  insert into public.governance_links (left_kind, left_ref, right_kind, right_ref, relation, note, created_by)
  select 'task', new.promoted_task_id::text, 'entity', 'DiscussionAction', 'touches',
         'auto: promoted from discussion_action #' || new.short_num, null
  where not exists (
    select 1 from public.governance_links
     where left_kind='task' and left_ref=new.promoted_task_id::text
       and right_kind='entity' and right_ref='DiscussionAction'
       and relation='touches'
  );

  -- (2) task ↔ inferred entity from task module/title
  select module, title into t_module, t_title
    from public.roadmap_tasks where id = new.promoted_task_id;
  inferred := public.infer_task_entity(t_module, t_title);

  if inferred is not null and inferred <> 'DiscussionAction' then
    insert into public.governance_links (left_kind, left_ref, right_kind, right_ref, relation, note, created_by)
    select 'task', new.promoted_task_id::text, 'entity', inferred, 'touches',
           'auto: inferred from task module/title', null
    where not exists (
      select 1 from public.governance_links
       where left_kind='task' and left_ref=new.promoted_task_id::text
         and right_kind='entity' and right_ref=inferred
         and relation='touches'
    );
  end if;

  return new;
end;
$$;

drop trigger if exists trg_auto_link_promoted_task on public.discussion_actions;
create trigger trg_auto_link_promoted_task
  after insert or update of promoted_task_id on public.discussion_actions
  for each row
  execute function public.auto_link_promoted_task();

-- Backfill: every roadmap_task gets an entity link based on inference.
-- Idempotent.
insert into public.governance_links (left_kind, left_ref, right_kind, right_ref, relation, note)
select 'task', t.id::text, 'entity',
       public.infer_task_entity(t.module, t.title),
       'touches',
       'auto-backfill: W7 closeout'
from public.roadmap_tasks t
where not exists (
  select 1 from public.governance_links gl
   where ((gl.left_kind='task' and gl.left_ref=t.id::text and gl.right_kind='entity')
       or (gl.right_kind='task' and gl.right_ref=t.id::text and gl.left_kind='entity'))
);

-- Also backfill DiscussionAction link for any historically-promoted action.
insert into public.governance_links (left_kind, left_ref, right_kind, right_ref, relation, note)
select 'task', da.promoted_task_id::text, 'entity', 'DiscussionAction', 'touches',
       'auto-backfill: was promoted from discussion_action #' || da.short_num
from public.discussion_actions da
where da.promoted_task_id is not null
  and not exists (
    select 1 from public.governance_links gl
     where gl.left_kind='task' and gl.left_ref=da.promoted_task_id::text
       and gl.right_kind='entity' and gl.right_ref='DiscussionAction'
       and gl.relation='touches'
  );