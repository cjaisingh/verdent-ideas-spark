
create table if not exists public.short_links (
  slug text primary key,
  target_path text not null,
  target_query jsonb not null default '{}'::jsonb,
  target_hash text not null unique,
  created_by uuid,
  created_at timestamptz not null default now(),
  hit_count integer not null default 0,
  last_used_at timestamptz
);

create index if not exists short_links_created_at_idx on public.short_links (created_at desc);

alter table public.short_links enable row level security;

create policy "short_links readable to authenticated"
  on public.short_links for select
  to authenticated
  using (true);

create policy "short_links insert by authenticated"
  on public.short_links for insert
  to authenticated
  with check (true);

create or replace function public.short_link_resolve(_slug text)
returns table(target_path text, target_query jsonb)
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.short_links
     set hit_count = hit_count + 1,
         last_used_at = now()
   where slug = _slug;

  return query
    select sl.target_path, sl.target_query
      from public.short_links sl
     where sl.slug = _slug;
end;
$$;

revoke all on function public.short_link_resolve(text) from public;
grant execute on function public.short_link_resolve(text) to authenticated;
