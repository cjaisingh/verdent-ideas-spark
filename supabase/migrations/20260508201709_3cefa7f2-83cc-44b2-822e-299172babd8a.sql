create table public.ai_usage_log (
  id uuid primary key default gen_random_uuid(),
  job text not null,
  model text not null,
  trigger text not null default 'manual',
  status text not null default 'ok',
  status_code integer,
  prompt_tokens integer,
  completion_tokens integer,
  total_tokens integer,
  latency_ms integer,
  error text,
  request_ref jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index ai_usage_log_job_created_idx on public.ai_usage_log (job, created_at desc);
create index ai_usage_log_model_created_idx on public.ai_usage_log (model, created_at desc);

alter table public.ai_usage_log enable row level security;

create policy "operators read ai_usage_log"
on public.ai_usage_log for select to authenticated
using (has_role(auth.uid(), 'operator'::app_role) or has_role(auth.uid(), 'admin'::app_role));

create policy "no client write ai_usage_log"
on public.ai_usage_log for all to authenticated
using (false) with check (false);

alter publication supabase_realtime add table public.ai_usage_log;