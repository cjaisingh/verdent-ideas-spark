create table if not exists public.deep_audit_runs (
  id uuid primary key default gen_random_uuid(),
  cadence text not null check (cadence in ('weekly','monthly','manual')),
  triggered_by text not null default 'cron',
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  status text not null default 'running' check (status in ('running','ok','warn','fail')),
  summary jsonb not null default '{}'::jsonb,
  modules jsonb not null default '[]'::jsonb,
  findings jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_deep_audit_runs_started on public.deep_audit_runs (started_at desc);
create index if not exists idx_deep_audit_runs_cadence on public.deep_audit_runs (cadence, started_at desc);

alter table public.deep_audit_runs enable row level security;
alter table public.deep_audit_runs replica identity full;

create policy "Operators read audit runs"
  on public.deep_audit_runs for select
  using (public.has_role(auth.uid(),'operator') or public.has_role(auth.uid(),'admin'));

-- realtime
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname='public' and tablename='deep_audit_runs'
  ) then
    execute 'alter publication supabase_realtime add table public.deep_audit_runs';
  end if;
end $$;
