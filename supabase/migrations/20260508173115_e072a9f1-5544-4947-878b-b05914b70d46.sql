create table public.operator_dashboards (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique,
  tabs jsonb not null default '[]'::jsonb,
  active_tab_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.operator_dashboards enable row level security;

create policy "own row select" on public.operator_dashboards
  for select using (auth.uid() = user_id);
create policy "own row insert" on public.operator_dashboards
  for insert with check (auth.uid() = user_id);
create policy "own row update" on public.operator_dashboards
  for update using (auth.uid() = user_id);

create trigger trg_operator_dashboards_updated_at
  before update on public.operator_dashboards
  for each row execute function public.update_updated_at_column();