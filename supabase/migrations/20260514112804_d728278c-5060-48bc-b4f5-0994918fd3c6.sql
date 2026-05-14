-- Hermes slice 2: post-write delta lint runs
create table if not exists public.lint_delta_runs (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  caller text not null,
  request_id text,
  file_path text not null,
  language text not null check (language in ('ts','tsx','js','jsx','json','md','other')),
  status text not null check (status in ('ok','failed','skipped','error')),
  duration_ms int not null default 0,
  bytes int not null default 0,
  error_class text check (error_class in ('syntax','type','parse','timeout','runtime')),
  error_message text,
  meta jsonb not null default '{}'::jsonb
);

create index if not exists lint_delta_runs_created_idx on public.lint_delta_runs (created_at desc);
create index if not exists lint_delta_runs_caller_idx on public.lint_delta_runs (caller, created_at desc);
create index if not exists lint_delta_runs_status_idx on public.lint_delta_runs (status, created_at desc);

alter table public.lint_delta_runs enable row level security;

create policy "operators read lint_delta_runs"
  on public.lint_delta_runs for select
  using (public.has_role(auth.uid(),'operator') or public.has_role(auth.uid(),'admin'));

create policy "operators insert lint_delta_runs"
  on public.lint_delta_runs for insert
  with check (public.has_role(auth.uid(),'operator') or public.has_role(auth.uid(),'admin'));

create policy "operators delete lint_delta_runs"
  on public.lint_delta_runs for delete
  using (public.has_role(auth.uid(),'operator') or public.has_role(auth.uid(),'admin'));

alter publication supabase_realtime add table public.lint_delta_runs;

insert into public.retention_settings (table_name, retention_days, description)
  values ('lint_delta_runs', 30, 'Post-write delta-lint history (Hermes slice 2)')
  on conflict (table_name) do nothing;