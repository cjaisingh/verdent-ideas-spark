create table public.morning_review_triage (
  id uuid primary key default gen_random_uuid(),
  item_kind text not null check (item_kind in (
    'discussion_action','sentinel_finding','code_review_finding',
    'cron_stuck','deferred','promotion_drift','night_throughput'
  )),
  item_ref text not null,
  state text not null check (state in ('focus','revisit','done','skip')),
  note text,
  set_by uuid,
  set_at timestamptz not null default now(),
  cleared_at timestamptz
);

create unique index morning_review_triage_active_uniq
  on public.morning_review_triage (item_kind, item_ref)
  where cleared_at is null;

create index morning_review_triage_lookup
  on public.morning_review_triage (item_kind, item_ref, cleared_at);

alter table public.morning_review_triage enable row level security;

create policy "operators read triage"
  on public.morning_review_triage for select to authenticated
  using (public.has_role(auth.uid(),'operator') or public.has_role(auth.uid(),'admin'));

create policy "operators insert triage"
  on public.morning_review_triage for insert to authenticated
  with check (public.has_role(auth.uid(),'operator') or public.has_role(auth.uid(),'admin'));

create policy "operators update triage"
  on public.morning_review_triage for update to authenticated
  using (public.has_role(auth.uid(),'operator') or public.has_role(auth.uid(),'admin'));

create or replace function public.clear_previous_morning_review_triage()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.morning_review_triage
     set cleared_at = now()
   where item_kind = new.item_kind
     and item_ref = new.item_ref
     and id <> new.id
     and cleared_at is null;
  return new;
end;
$$;

create trigger morning_review_triage_clear_previous
after insert on public.morning_review_triage
for each row execute function public.clear_previous_morning_review_triage();

create or replace view public.morning_review_triage_active as
  select id, item_kind, item_ref, state, note, set_by, set_at
    from public.morning_review_triage
   where cleared_at is null;

alter publication supabase_realtime add table public.morning_review_triage;