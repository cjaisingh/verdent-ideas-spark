
ALTER TABLE public.discussion_actions
  ADD COLUMN IF NOT EXISTS ci_workflow_file text,
  ADD COLUMN IF NOT EXISTS ci_branch text DEFAULT 'main',
  ADD COLUMN IF NOT EXISTS ci_close_on_success boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS ci_last_status text,
  ADD COLUMN IF NOT EXISTS ci_last_conclusion text,
  ADD COLUMN IF NOT EXISTS ci_last_run_id bigint,
  ADD COLUMN IF NOT EXISTS ci_last_run_url text,
  ADD COLUMN IF NOT EXISTS ci_last_run_sha text,
  ADD COLUMN IF NOT EXISTS ci_last_checked_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_discussion_actions_ci_workflow_open
  ON public.discussion_actions (ci_workflow_file)
  WHERE ci_workflow_file IS NOT NULL AND status = 'open';

-- Replace the event trigger fn to also record CI sync events
CREATE OR REPLACE FUNCTION public.log_discussion_action_event()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  uid uuid := auth.uid();
  label text;
begin
  select email into label from auth.users where id = uid;
  if label is null then label := 'system'; end if;

  if TG_OP = 'INSERT' then
    insert into public.discussion_action_events(action_id, discussion_id, event_type, actor, actor_label, payload)
      values (new.id, new.discussion_id,
              case when new.source = 'extracted' then 'accepted' else 'created' end,
              uid, label,
              jsonb_build_object(
                'title', new.title,
                'priority', new.priority,
                'risk', new.risk,
                'source', new.source,
                'owner', new.owner,
                'status', new.status,
                'extracted_confidence', new.extracted_confidence
              ));
    return new;

  elsif TG_OP = 'UPDATE' then
    if new.status is distinct from old.status then
      insert into public.discussion_action_events(action_id, discussion_id, event_type, actor, actor_label, payload)
        values (new.id, new.discussion_id, 'status_changed', uid, label,
                jsonb_build_object('from', old.status, 'to', new.status));
    end if;
    if new.owner is distinct from old.owner then
      insert into public.discussion_action_events(action_id, discussion_id, event_type, actor, actor_label, payload)
        values (new.id, new.discussion_id, 'owner_changed', uid, label,
                jsonb_build_object('from', old.owner, 'to', new.owner));
    end if;
    if new.due_at is distinct from old.due_at then
      insert into public.discussion_action_events(action_id, discussion_id, event_type, actor, actor_label, payload)
        values (new.id, new.discussion_id, 'due_changed', uid, label,
                jsonb_build_object('from', old.due_at, 'to', new.due_at));
    end if;
    if new.priority is distinct from old.priority then
      insert into public.discussion_action_events(action_id, discussion_id, event_type, actor, actor_label, payload)
        values (new.id, new.discussion_id, 'priority_changed', uid, label,
                jsonb_build_object('from', old.priority, 'to', new.priority));
    end if;
    if new.risk is distinct from old.risk then
      insert into public.discussion_action_events(action_id, discussion_id, event_type, actor, actor_label, payload)
        values (new.id, new.discussion_id, 'risk_changed', uid, label,
                jsonb_build_object('from', old.risk, 'to', new.risk));
    end if;
    if coalesce(new.night_override_reason,'') is distinct from coalesce(old.night_override_reason,'') then
      insert into public.discussion_action_events(action_id, discussion_id, event_type, actor, actor_label, payload)
        values (new.id, new.discussion_id, 'night_override', uid, label,
                jsonb_build_object('from', old.night_override_reason, 'to', new.night_override_reason, 'risk', new.risk));
    end if;
    if new.title is distinct from old.title then
      insert into public.discussion_action_events(action_id, discussion_id, event_type, actor, actor_label, payload)
        values (new.id, new.discussion_id, 'title_changed', uid, label,
                jsonb_build_object('from', old.title, 'to', new.title));
    end if;
    if new.promoted_task_id is distinct from old.promoted_task_id and new.promoted_task_id is not null then
      insert into public.discussion_action_events(action_id, discussion_id, event_type, actor, actor_label, payload)
        values (new.id, new.discussion_id, 'promoted', uid, label,
                jsonb_build_object('task_id', new.promoted_task_id));
    end if;
    if (new.ci_last_conclusion is distinct from old.ci_last_conclusion)
       or (new.ci_last_status is distinct from old.ci_last_status) then
      insert into public.discussion_action_events(action_id, discussion_id, event_type, actor, actor_label, payload)
        values (new.id, new.discussion_id, 'ci_status_changed', uid, label,
                jsonb_build_object(
                  'workflow', new.ci_workflow_file,
                  'branch', new.ci_branch,
                  'from_status', old.ci_last_status,
                  'to_status', new.ci_last_status,
                  'from_conclusion', old.ci_last_conclusion,
                  'to_conclusion', new.ci_last_conclusion,
                  'run_id', new.ci_last_run_id,
                  'run_url', new.ci_last_run_url,
                  'sha', new.ci_last_run_sha
                ));
    end if;
    return new;

  elsif TG_OP = 'DELETE' then
    insert into public.discussion_action_events(action_id, discussion_id, event_type, actor, actor_label, payload)
      values (null, old.discussion_id, 'deleted', uid, label,
              jsonb_build_object('short_num', old.short_num, 'title', old.title));
    return old;
  end if;
  return null;
end;
$function$;

-- Backfill links for existing open jobs that map cleanly to a workflow
UPDATE public.discussion_actions
   SET ci_workflow_file='lint-and-typecheck.yml', ci_branch='main', ci_close_on_success=true
 WHERE id='594fb59b-af36-4577-8c65-80a4a58d09e3';

UPDATE public.discussion_actions
   SET ci_workflow_file='lint-and-typecheck.yml', ci_branch='main', ci_close_on_success=false
 WHERE id='ee7937ce-99d5-47db-ae12-78da20f954e2';
