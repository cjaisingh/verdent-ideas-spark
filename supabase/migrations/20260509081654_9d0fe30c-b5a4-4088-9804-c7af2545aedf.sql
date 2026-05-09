
-- Cost tracking: estimates registered per workstream/task, actuals derived from automation_runs.

create table if not exists public.cost_estimates (
  id uuid primary key default gen_random_uuid(),
  workstream_id uuid references public.plan_workstreams(id) on delete cascade,
  task_id uuid references public.plan_tasks(id) on delete cascade,
  kind text not null check (kind in ('monthly','oneshot')),
  estimated_usd numeric(12,4) not null check (estimated_usd >= 0),
  model text,
  job text,                       -- automation_runs.job to link actuals (nullable)
  notes text,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists cost_estimates_ws_idx on public.cost_estimates(workstream_id);
create index if not exists cost_estimates_job_idx on public.cost_estimates(job);

alter table public.cost_estimates enable row level security;

create policy "operators read cost_estimates" on public.cost_estimates
  for select to authenticated using (has_role(auth.uid(), 'operator'));
create policy "operators write cost_estimates" on public.cost_estimates
  for all to authenticated
  using (has_role(auth.uid(), 'operator'))
  with check (has_role(auth.uid(), 'operator'));

create trigger cost_estimates_touch
  before update on public.cost_estimates
  for each row execute function public.update_updated_at_column();

alter publication supabase_realtime add table public.cost_estimates;

-- Actuals (last 30 days) aggregated from automation_runs.detail->>'cost_usd'
create or replace view public.cost_actuals_30d
with (security_invoker = true) as
select
  job,
  count(*)                                                  as runs,
  coalesce(sum( (detail->>'cost_usd')::numeric ), 0)        as actual_usd_30d,
  coalesce(sum( (detail->>'prompt_tokens')::bigint ), 0)    as prompt_tokens_30d,
  coalesce(sum( (detail->>'completion_tokens')::bigint ), 0) as completion_tokens_30d,
  max(created_at)                                           as last_run_at
from public.automation_runs
where created_at >= now() - interval '30 days'
group by job;

grant select on public.cost_actuals_30d to authenticated;

-- Per-workstream rollup combining estimates with actuals (joined by job)
create or replace view public.cost_summary_by_workstream
with (security_invoker = true) as
with est as (
  select
    ce.workstream_id,
    sum(case when ce.kind = 'monthly' then ce.estimated_usd else 0 end) as est_monthly_usd,
    sum(case when ce.kind = 'oneshot' then ce.estimated_usd else 0 end) as est_oneshot_usd,
    array_agg(distinct ce.job) filter (where ce.job is not null) as jobs
  from public.cost_estimates ce
  group by ce.workstream_id
),
act as (
  select
    ce.workstream_id,
    sum(coalesce(a.actual_usd_30d, 0)) as actual_usd_30d
  from public.cost_estimates ce
  left join public.cost_actuals_30d a on a.job = ce.job
  where ce.job is not null
  group by ce.workstream_id
)
select
  w.id as workstream_id,
  w.slug,
  w.title,
  coalesce(est.est_monthly_usd, 0) as est_monthly_usd,
  coalesce(est.est_oneshot_usd, 0) as est_oneshot_usd,
  coalesce(act.actual_usd_30d, 0)  as actual_usd_30d,
  est.jobs
from public.plan_workstreams w
left join est on est.workstream_id = w.id
left join act on act.workstream_id = w.id;

grant select on public.cost_summary_by_workstream to authenticated;
