-- Session lifecycle: session_summaries log for end-of-session retros
create table if not exists public.session_summaries (
  id uuid primary key default gen_random_uuid(),
  session_id text not null,
  agent text not null default 'lovable',
  started_at timestamptz not null,
  ended_at timestamptz not null default now(),
  duration_minutes integer generated always as (extract(epoch from (ended_at - started_at))/60) stored,
  goal text,
  outcome text not null,
  files_touched text[] not null default '{}',
  migrations_applied text[] not null default '{}',
  edge_fns_touched text[] not null default '{}',
  open_findings_at_start integer not null default 0,
  open_actions_at_start integer not null default 0,
  open_findings_at_end integer not null default 0,
  open_actions_at_end integer not null default 0,
  decisions text[] not null default '{}',
  followups text[] not null default '{}',
  unresolved text[] not null default '{}',
  bootstrap_acknowledged boolean not null default false,
  created_at timestamptz not null default now()
);

create index if not exists idx_session_summaries_started_at on public.session_summaries (started_at desc);
create index if not exists idx_session_summaries_agent on public.session_summaries (agent, started_at desc);

alter table public.session_summaries enable row level security;

create policy "operator can read session summaries"
  on public.session_summaries for select
  to authenticated
  using (public.has_role(auth.uid(), 'admin'));

create policy "operator can insert session summaries"
  on public.session_summaries for insert
  to authenticated
  with check (public.has_role(auth.uid(), 'admin'));

-- service token writes (from edge fns) allowed via service_role bypass

alter publication supabase_realtime add table public.session_summaries;