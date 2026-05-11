create table public.overnight_recommendations (
  id uuid primary key default gen_random_uuid(),
  generated_at timestamptz not null default now(),
  scheduled_for date not null,
  phase_id uuid not null references public.roadmap_phases(id) on delete cascade,
  phase_key text not null,
  score int not null default 0,
  reasons jsonb not null default '[]'::jsonb,
  blockers jsonb not null default '[]'::jsonb,
  status text not null default 'open',
  acted_at timestamptz,
  acted_by uuid,
  created_at timestamptz not null default now(),
  unique (scheduled_for, phase_id)
);

create index idx_overnight_recs_scheduled on public.overnight_recommendations(scheduled_for desc, score desc);
create index idx_overnight_recs_status on public.overnight_recommendations(status, scheduled_for desc);

alter table public.overnight_recommendations enable row level security;

create policy "operators read overnight recs"
  on public.overnight_recommendations for select
  to authenticated
  using (has_role(auth.uid(),'operator') or has_role(auth.uid(),'admin'));

create policy "operators update overnight recs"
  on public.overnight_recommendations for update
  to authenticated
  using (has_role(auth.uid(),'operator') or has_role(auth.uid(),'admin'))
  with check (has_role(auth.uid(),'operator') or has_role(auth.uid(),'admin'));

create policy "no client insert overnight recs"
  on public.overnight_recommendations for insert
  to authenticated
  with check (false);

create policy "no client delete overnight recs"
  on public.overnight_recommendations for delete
  to authenticated
  using (false);

alter publication supabase_realtime add table public.overnight_recommendations;

insert into public.retention_settings (table_name, retention_days, description)
  values ('overnight_recommendations', 14, 'Nightly phase-overnight suggestions; 14d history is plenty.')
  on conflict (table_name) do nothing;