
create table public.heygen_videos (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('quarterly_recap','external_pitch')),
  title text not null,
  script text not null,
  status text not null default 'queued' check (status in ('queued','processing','ready','failed')),
  heygen_video_id text,
  video_url text,
  thumbnail_url text,
  duration_s numeric,
  error text,
  requested_by uuid,
  subject_kind text,
  subject_ref text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index idx_heygen_videos_status on public.heygen_videos(status);
create index idx_heygen_videos_created on public.heygen_videos(created_at desc);

alter table public.heygen_videos enable row level security;

create policy "Operators read heygen_videos"
  on public.heygen_videos for select to authenticated
  using (public.has_role(auth.uid(),'operator') or public.has_role(auth.uid(),'admin'));

create policy "Operators insert heygen_videos"
  on public.heygen_videos for insert to authenticated
  with check (public.has_role(auth.uid(),'operator') or public.has_role(auth.uid(),'admin'));

create policy "Operators update heygen_videos"
  on public.heygen_videos for update to authenticated
  using (public.has_role(auth.uid(),'operator') or public.has_role(auth.uid(),'admin'));

create trigger trg_heygen_videos_updated
  before update on public.heygen_videos
  for each row execute function public.update_updated_at_column();

alter publication supabase_realtime add table public.heygen_videos;

create or replace view public.heygen_videos_month_count as
  select count(*)::int as used,
         3 as monthly_quota,
         date_trunc('month', now()) as month_start
  from public.heygen_videos
  where created_at >= date_trunc('month', now());

grant select on public.heygen_videos_month_count to authenticated;
