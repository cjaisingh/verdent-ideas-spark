-- Jobs status panel: link runs ↔ steps ↔ logs via request_id, expose ETA baselines

alter table public.automation_runs add column if not exists request_id text;
create index if not exists idx_automation_runs_request_id on public.automation_runs(request_id) where request_id is not null;
create index if not exists idx_automation_runs_recent on public.automation_runs(created_at desc);

alter table public.automation_steps add column if not exists request_id text;
create index if not exists idx_automation_steps_request_id on public.automation_steps(request_id) where request_id is not null;

-- Recent runs window for the live panel (6h). Status column already exists.
create or replace view public.v_jobs_recent as
select
  r.id              as run_id,
  r.job,
  r.trigger,
  r.status,
  r.status_code,
  r.created_at      as started_at,
  r.duration_ms,
  r.request_id,
  r.message,
  r.detail,
  greatest(0, extract(epoch from (now() - r.created_at))*1000)::int as elapsed_ms
from public.automation_runs r
where r.created_at > now() - interval '6 hours'
order by r.created_at desc;

-- Baseline per job over last 30 days of successful runs. Used for ETA + overdue flag.
create or replace view public.v_job_eta_baseline as
select
  job,
  count(*)                                                                as samples,
  percentile_cont(0.5)  within group (order by duration_ms)::int          as median_ms,
  percentile_cont(0.95) within group (order by duration_ms)::int          as p95_ms,
  max(duration_ms)                                                        as max_ms
from public.automation_runs
where status = 'ok'
  and duration_ms is not null
  and created_at > now() - interval '30 days'
group by job;

grant select on public.v_jobs_recent      to authenticated;
grant select on public.v_job_eta_baseline to authenticated;