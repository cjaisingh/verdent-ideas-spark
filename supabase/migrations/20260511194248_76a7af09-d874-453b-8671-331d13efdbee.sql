
-- Morning Review panel discussions: per-(review, panel) chat thread
create table public.morning_review_discussions (
  id uuid primary key default gen_random_uuid(),
  review_id uuid not null references public.morning_reviews(id) on delete cascade,
  panel_ref text not null,
  panel_title text,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  closed_at timestamptz,
  outcome text check (outcome in ('mirrored','deferred','done','skipped'))
);

create unique index morning_review_discussions_open_uniq
  on public.morning_review_discussions (review_id, panel_ref)
  where closed_at is null;

create index morning_review_discussions_review_idx
  on public.morning_review_discussions (review_id);

alter table public.morning_review_discussions enable row level security;

create policy "operators read mr discussions"
  on public.morning_review_discussions for select
  using (public.has_role(auth.uid(),'operator') or public.has_role(auth.uid(),'admin'));
create policy "operators insert mr discussions"
  on public.morning_review_discussions for insert
  with check (public.has_role(auth.uid(),'operator') or public.has_role(auth.uid(),'admin'));
create policy "operators update mr discussions"
  on public.morning_review_discussions for update
  using (public.has_role(auth.uid(),'operator') or public.has_role(auth.uid(),'admin'));

create trigger morning_review_discussions_set_updated_at
  before update on public.morning_review_discussions
  for each row execute function public.update_updated_at_column();

-- Messages
create table public.morning_review_discussion_messages (
  id uuid primary key default gen_random_uuid(),
  discussion_id uuid not null references public.morning_review_discussions(id) on delete cascade,
  role text not null check (role in ('user','assistant','system')),
  body text not null,
  model text,
  created_at timestamptz not null default now()
);

create index morning_review_discussion_messages_discussion_idx
  on public.morning_review_discussion_messages (discussion_id, created_at);

alter table public.morning_review_discussion_messages enable row level security;

create policy "operators read mr discussion messages"
  on public.morning_review_discussion_messages for select
  using (public.has_role(auth.uid(),'operator') or public.has_role(auth.uid(),'admin'));
create policy "operators insert mr discussion messages"
  on public.morning_review_discussion_messages for insert
  with check (public.has_role(auth.uid(),'operator') or public.has_role(auth.uid(),'admin'));

alter publication supabase_realtime add table public.morning_review_discussions;
alter publication supabase_realtime add table public.morning_review_discussion_messages;
