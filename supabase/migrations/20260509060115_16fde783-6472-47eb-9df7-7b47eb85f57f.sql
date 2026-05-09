-- ============================================================
-- W2: Morning Review + Lessons Loop + Deferrals Registry
-- ============================================================

-- ---------- morning_reviews ----------
create table if not exists public.morning_reviews (
  id uuid primary key default gen_random_uuid(),
  review_date date not null unique,
  kpis jsonb not null default '{}'::jsonb,
  stuck_jobs jsonb not null default '[]'::jsonb,
  promotion_drift jsonb not null default '[]'::jsonb,
  night_throughput jsonb not null default '{}'::jsonb,
  open_findings jsonb not null default '[]'::jsonb,
  top_actions jsonb not null default '[]'::jsonb,
  revisit_items jsonb not null default '[]'::jsonb,
  generated_by text not null default 'cron',
  acknowledged_at timestamptz,
  acknowledged_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists idx_morning_reviews_date on public.morning_reviews(review_date desc);
alter table public.morning_reviews enable row level security;

create policy "operators read morning_reviews"
  on public.morning_reviews for select
  to authenticated
  using (public.has_role(auth.uid(), 'operator'));

create policy "admins ack morning_reviews"
  on public.morning_reviews for update
  to authenticated
  using (public.has_role(auth.uid(), 'admin'))
  with check (public.has_role(auth.uid(), 'admin'));

alter publication supabase_realtime add table public.morning_reviews;

-- ---------- lessons ----------
create table if not exists public.lessons (
  id uuid primary key default gen_random_uuid(),
  category text not null,
  severity text not null check (severity in ('low','medium','high','critical')),
  title text not null,
  recommendation text not null,
  evidence jsonb not null default '[]'::jsonb,
  dedupe_key text not null unique,
  status text not null default 'proposed' check (status in ('proposed','applied','deferred','rejected','reopened')),
  applied_as jsonb,
  source_window_start timestamptz,
  source_window_end timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  applied_at timestamptz,
  applied_by uuid references auth.users(id) on delete set null
);

create index if not exists idx_lessons_status on public.lessons(status, created_at desc);
create index if not exists idx_lessons_category on public.lessons(category, severity);
alter table public.lessons enable row level security;

create policy "operators read lessons"
  on public.lessons for select
  to authenticated
  using (public.has_role(auth.uid(), 'operator'));

create policy "admins write lessons"
  on public.lessons for all
  to authenticated
  using (public.has_role(auth.uid(), 'admin'))
  with check (public.has_role(auth.uid(), 'admin'));

create trigger lessons_updated_at
  before update on public.lessons
  for each row execute function public.update_updated_at_column();

alter publication supabase_realtime add table public.lessons;

-- ---------- lesson_events ----------
create table if not exists public.lesson_events (
  id uuid primary key default gen_random_uuid(),
  lesson_id uuid not null references public.lessons(id) on delete cascade,
  event_type text not null,
  actor uuid references auth.users(id) on delete set null,
  actor_label text,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_lesson_events_lesson on public.lesson_events(lesson_id, created_at desc);
alter table public.lesson_events enable row level security;

create policy "operators read lesson_events"
  on public.lesson_events for select
  to authenticated
  using (public.has_role(auth.uid(), 'operator'));

create policy "admins insert lesson_events"
  on public.lesson_events for insert
  to authenticated
  with check (public.has_role(auth.uid(), 'admin'));

-- ---------- lessons_backfill_runs ----------
create table if not exists public.lessons_backfill_runs (
  id uuid primary key default gen_random_uuid(),
  window_days int not null,
  status text not null check (status in ('running','succeeded','failed')),
  lessons_created int,
  cost_usd numeric,
  error text,
  triggered_by uuid references auth.users(id) on delete set null,
  started_at timestamptz not null default now(),
  finished_at timestamptz
);

alter table public.lessons_backfill_runs enable row level security;

create policy "operators read lessons_backfill_runs"
  on public.lessons_backfill_runs for select
  to authenticated
  using (public.has_role(auth.uid(), 'operator'));

create policy "admins write lessons_backfill_runs"
  on public.lessons_backfill_runs for all
  to authenticated
  using (public.has_role(auth.uid(), 'admin'))
  with check (public.has_role(auth.uid(), 'admin'));

-- ---------- deferred_items ----------
create table if not exists public.deferred_items (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  reason text not null,
  originating_context jsonb not null default '{}'::jsonb,
  defer_until date not null default (current_date + interval '90 days'),
  severity text not null default 'medium' check (severity in ('low','medium','high','critical')),
  status text not null default 'deferred' check (status in ('deferred','revisit_now','accepted','rejected')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  revisited_at timestamptz,
  resolved_at timestamptz,
  resolved_by uuid references auth.users(id) on delete set null
);

create index if not exists idx_deferred_items_status on public.deferred_items(status, defer_until);
create index if not exists idx_deferred_items_revisit on public.deferred_items(defer_until) where status = 'deferred';
alter table public.deferred_items enable row level security;

create policy "operators read deferred_items"
  on public.deferred_items for select
  to authenticated
  using (public.has_role(auth.uid(), 'operator'));

create policy "admins write deferred_items"
  on public.deferred_items for all
  to authenticated
  using (public.has_role(auth.uid(), 'admin'))
  with check (public.has_role(auth.uid(), 'admin'));

-- Enforce: a freshly-deferred item must point at a future date.
create or replace function public.validate_deferred_item()
returns trigger
language plpgsql
set search_path to 'public'
as $$
begin
  if NEW.status = 'deferred' and NEW.defer_until <= current_date then
    raise exception 'defer_until must be in the future for status=deferred (got %)', NEW.defer_until;
  end if;
  if TG_OP = 'UPDATE' and NEW.status <> OLD.status and NEW.status in ('accepted','rejected') then
    NEW.resolved_at := coalesce(NEW.resolved_at, now());
  end if;
  return NEW;
end $$;

drop trigger if exists deferred_items_validate on public.deferred_items;
create trigger deferred_items_validate
  before insert or update on public.deferred_items
  for each row execute function public.validate_deferred_item();

create trigger deferred_items_updated_at
  before update on public.deferred_items
  for each row execute function public.update_updated_at_column();

alter publication supabase_realtime add table public.deferred_items;

-- Add new tables to retention settings (lessons/morning_reviews kept long-term; events trimmed)
insert into public.retention_settings (table_name, retention_days, description)
values
  ('lesson_events', 365, 'Lesson status transitions; trim after 1 year'),
  ('lessons_backfill_runs', 365, 'One-shot backfill audit trail; trim after 1 year')
on conflict (table_name) do nothing;