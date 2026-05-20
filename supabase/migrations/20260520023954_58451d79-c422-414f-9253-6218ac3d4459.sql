-- UX telemetry for the /governance deep-link workflow.
-- Separate from governance_link_events (which records actual mutations) so
-- copy/open noise can't pollute the audit stream.
create table public.governance_deeplink_events (
  id uuid primary key default gen_random_uuid(),
  event_type text not null check (event_type in ('copy', 'open')),
  task_id uuid not null,
  missing text not null check (missing in ('entity', 'notebook', 'authority_rule')),
  source text not null default 'uncovered_panel',
  actor uuid,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index governance_deeplink_events_created_at_idx
  on public.governance_deeplink_events (created_at desc);
create index governance_deeplink_events_task_idx
  on public.governance_deeplink_events (task_id);

alter table public.governance_deeplink_events enable row level security;

create policy "operators read deeplink events"
  on public.governance_deeplink_events
  for select
  to authenticated
  using (has_role(auth.uid(), 'operator'::app_role) or has_role(auth.uid(), 'admin'::app_role));

create policy "operators insert deeplink events"
  on public.governance_deeplink_events
  for insert
  to authenticated
  with check (has_role(auth.uid(), 'operator'::app_role) or has_role(auth.uid(), 'admin'::app_role));

-- 30-day rollup: per missing target, how many copies, opens, distinct tasks,
-- and how many of those tasks actually got a governance_link created within
-- 24 h of the deep-link event. That last column is the conversion signal.
create or replace view public.v_governance_deeplink_funnel
with (security_invoker = true)
as
with windowed as (
  select *
  from public.governance_deeplink_events
  where created_at > now() - interval '30 days'
),
conversions as (
  select distinct w.missing, w.task_id
  from windowed w
  join public.governance_links gl
    on gl.left_kind = 'task'
   and gl.left_ref::text = w.task_id::text
   and gl.created_at between w.created_at and w.created_at + interval '24 hours'
)
select
  w.missing,
  count(*) filter (where w.event_type = 'copy') as copies_30d,
  count(*) filter (where w.event_type = 'open') as opens_30d,
  count(distinct w.task_id) as distinct_tasks_30d,
  (select count(*) from conversions c where c.missing = w.missing) as tasks_linked_within_24h
from windowed w
group by w.missing
order by w.missing;

comment on table public.governance_deeplink_events is
  'UX telemetry for /governance deep-link copies and opens. Used to measure which missing target (entity/notebook/authority_rule) drives operators to add governance links.';
comment on view public.v_governance_deeplink_funnel is
  '30-day funnel per missing target: copies, opens, distinct tasks touched, and tasks that gained a governance_link within 24h of the deep-link event.';