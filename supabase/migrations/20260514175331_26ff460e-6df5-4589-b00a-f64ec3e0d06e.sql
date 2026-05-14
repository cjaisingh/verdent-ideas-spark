-- W7 closeout slice 2b: real claim sources (TestRun + RoadmapTask)

-- 1. RoadmapTask isn't yet in the rule table; add the standard precedence triple.
insert into public.decision_authorities (entity, field, source, precedence, weight, override_policy, notes) values
  ('RoadmapTask', '*', 'operator', 10, 1.0, 'soft',          'Operator wins for any RoadmapTask field by default.'),
  ('RoadmapTask', '*', 'ai',       50, 0.5, 'operator_only', 'AI suggestions about RoadmapTask are subordinate to operator.'),
  ('RoadmapTask', '*', 'system',   30, 0.7, 'soft',          'System-emitted state from roadmap_task_activity.')
on conflict do nothing;

-- 2. CI test runs → TestRun claims.
create or replace function public.file_testrun_claim_from_automation_run()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if new.job <> 'record-test-run' then
    return new;
  end if;
  -- Idempotency: one claim per automation_runs row.
  if exists (
    select 1 from public.claims
    where entity = 'TestRun' and entity_id = new.id and source = 'ci'
  ) then
    return new;
  end if;

  insert into public.claims (entity, entity_id, field, source, value, confidence, evidence_ref, claimed_by_label)
  values ('TestRun', new.id, 'status', 'ci',
          jsonb_build_object('status', new.status, 'status_code', new.status_code, 'duration_ms', new.duration_ms),
          1.0,
          jsonb_build_object('automation_run_id', new.id, 'job', new.job, 'trigger', new.trigger),
          'ci');
  return new;
end;
$$;

drop trigger if exists trg_file_testrun_claim on public.automation_runs;
create trigger trg_file_testrun_claim
  after insert on public.automation_runs
  for each row
  execute function public.file_testrun_claim_from_automation_run();

-- 3. Roadmap task activity → RoadmapTask claims (status field only — most signal-rich).
create or replace function public.file_roadmap_task_claim_from_activity()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if new.field <> 'status' then
    return new;
  end if;
  if exists (
    select 1 from public.claims
    where entity = 'RoadmapTask'
      and entity_id = new.task_id
      and source = 'system'
      and field = 'status'
      and (evidence_ref->>'activity_id') = new.id::text
  ) then
    return new;
  end if;

  insert into public.claims (entity, entity_id, field, source, value, confidence, evidence_ref, claimed_by_label)
  values ('RoadmapTask', new.task_id, 'status', 'system',
          jsonb_build_object('from', new.old_value, 'to', new.new_value),
          0.9,
          jsonb_build_object('activity_id', new.id, 'author_label', new.author_label),
          coalesce(new.author_label, 'system'));
  return new;
end;
$$;

drop trigger if exists trg_file_roadmap_task_claim on public.roadmap_task_activity;
create trigger trg_file_roadmap_task_claim
  after insert on public.roadmap_task_activity
  for each row
  execute function public.file_roadmap_task_claim_from_activity();