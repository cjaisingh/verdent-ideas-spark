-- whats_new_entries
create table public.whats_new_entries (
  id uuid primary key default gen_random_uuid(),
  slug text unique,
  title text not null,
  area text not null check (area in ('schema','edge','ui','cron','policy','docs')),
  what text not null default '',
  why text not null default '',
  how_to_use text not null default '',
  impact text not null default '',
  source_refs jsonb not null default '{}'::jsonb,
  status text not null default 'draft' check (status in ('draft','published','dismissed')),
  shipped_at timestamptz not null default now(),
  published_at timestamptz,
  created_by uuid,
  model text,
  draft_meta jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index whats_new_entries_status_shipped_idx on public.whats_new_entries (status, shipped_at desc);
create index whats_new_entries_area_idx on public.whats_new_entries (area);

alter table public.whats_new_entries enable row level security;

create policy "operators read whats_new_entries"
  on public.whats_new_entries for select
  using (public.has_role(auth.uid(),'operator') or public.has_role(auth.uid(),'admin'));
create policy "operators insert whats_new_entries"
  on public.whats_new_entries for insert
  with check (public.has_role(auth.uid(),'operator') or public.has_role(auth.uid(),'admin'));
create policy "operators update whats_new_entries"
  on public.whats_new_entries for update
  using (public.has_role(auth.uid(),'operator') or public.has_role(auth.uid(),'admin'));
create policy "operators delete whats_new_entries"
  on public.whats_new_entries for delete
  using (public.has_role(auth.uid(),'operator') or public.has_role(auth.uid(),'admin'));

create trigger whats_new_entries_set_updated
  before update on public.whats_new_entries
  for each row execute function public.update_updated_at_column();

-- whats_new_sources (idempotency ledger)
create table public.whats_new_sources (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('migration','function','page','cron','policy','changelog','capability_event')),
  ref text not null,
  entry_id uuid references public.whats_new_entries(id) on delete set null,
  seen_at timestamptz not null default now(),
  dismissed boolean not null default false,
  meta jsonb not null default '{}'::jsonb,
  unique (kind, ref)
);
create index whats_new_sources_entry_idx on public.whats_new_sources (entry_id);

alter table public.whats_new_sources enable row level security;

create policy "operators read whats_new_sources"
  on public.whats_new_sources for select
  using (public.has_role(auth.uid(),'operator') or public.has_role(auth.uid(),'admin'));
create policy "operators write whats_new_sources"
  on public.whats_new_sources for all
  using (public.has_role(auth.uid(),'operator') or public.has_role(auth.uid(),'admin'))
  with check (public.has_role(auth.uid(),'operator') or public.has_role(auth.uid(),'admin'));

-- Realtime
alter publication supabase_realtime add table public.whats_new_entries;
alter publication supabase_realtime add table public.whats_new_sources;