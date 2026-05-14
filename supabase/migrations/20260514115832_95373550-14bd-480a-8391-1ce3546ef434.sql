drop view if exists public.heygen_videos_month_count;
create view public.heygen_videos_month_count
  with (security_invoker = true) as
  select count(*)::int as used,
         3 as monthly_quota,
         date_trunc('month', now()) as month_start
  from public.heygen_videos
  where created_at >= date_trunc('month', now());

grant select on public.heygen_videos_month_count to authenticated;