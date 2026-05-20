
create table if not exists public.automation_steps (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  run_id uuid null,
  job text not null,
  step_key text not null,
  step_label text not null,
  phase_kind text not null check (phase_kind in ('ai_call','db_scan','lock_wait','backoff','external_http','compute','other')),
  started_at timestamptz not null default now(),
  finished_at timestamptz null,
  duration_ms integer null,
  status text not null default 'running' check (status in ('running','ok','error','skipped')),
  detail jsonb not null default '{}'::jsonb
);

create index if not exists automation_steps_job_started_idx on public.automation_steps (job, started_at desc);
create index if not exists automation_steps_running_idx on public.automation_steps (status) where status = 'running';
create index if not exists automation_steps_step_key_idx on public.automation_steps (step_key, started_at desc);

alter table public.automation_steps enable row level security;

create policy "Admins can view automation steps"
on public.automation_steps for select
to authenticated
using (public.has_role(auth.uid(), 'admin'));

alter publication supabase_realtime add table public.automation_steps;
alter table public.automation_steps replica identity full;

create or replace view public.v_automation_step_p95_30d as
select
  job,
  step_key,
  phase_kind,
  count(*)::int as sample_count,
  percentile_cont(0.5) within group (order by duration_ms)::int as p50_ms,
  percentile_cont(0.95) within group (order by duration_ms)::int as p95_ms,
  max(duration_ms)::int as max_ms
from public.automation_steps
where status = 'ok'
  and duration_ms is not null
  and started_at > now() - interval '30 days'
group by job, step_key, phase_kind;

grant select on public.v_automation_step_p95_30d to authenticated;
