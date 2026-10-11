create type public.records_class as enum (
  'contract', 'certificate', 'register', 'model', 'drawing',
  'correspondence', 'media', 'other'
);

create type public.bytes_tier as enum ('hot', 'chunks_only', 'tombstone');

create table public.retention_policies (
  key                    text primary key,
  hot_days               int  not null check (hot_days >= 0),
  chunks_days            int  not null check (chunks_days >= 0),
  min_approval_for_delete text not null default 'approved',
  description            text,
  created_at             timestamptz not null default now()
);

grant select on public.retention_policies to authenticated;
grant all on public.retention_policies to service_role;
alter table public.retention_policies enable row level security;

create policy "retention_policies operator read"
  on public.retention_policies for select to authenticated
  using (public.has_role(auth.uid(), 'operator') or public.has_role(auth.uid(), 'admin'));

create policy "retention_policies admin write"
  on public.retention_policies for all to authenticated
  using (public.has_role(auth.uid(), 'admin'))
  with check (public.has_role(auth.uid(), 'admin'));

alter table public.ingested_files
  add column if not exists records_class public.records_class not null default 'other',
  add column if not exists retention_policy_key text not null default 'standard'
    references public.retention_policies(key) on update cascade,
  add column if not exists revision_of uuid references public.ingested_files(id) on delete set null,
  add column if not exists revision_label text,
  add column if not exists legal_hold boolean not null default false,
  add column if not exists bytes_tier public.bytes_tier not null default 'hot';

create index if not exists ingested_files_records_class_idx on public.ingested_files (records_class);
create index if not exists ingested_files_revision_of_idx on public.ingested_files (revision_of) where revision_of is not null;
create index if not exists ingested_files_legal_hold_idx on public.ingested_files (legal_hold) where legal_hold;

create table public.legal_hold_audit (
  id         uuid primary key default gen_random_uuid(),
  file_id    uuid not null references public.ingested_files(id) on delete cascade,
  on_hold    boolean not null,
  reason     text,
  actor      uuid,
  created_at timestamptz not null default now()
);
create index legal_hold_audit_file_idx on public.legal_hold_audit (file_id, created_at desc);

grant select on public.legal_hold_audit to authenticated;
grant all on public.legal_hold_audit to service_role;
alter table public.legal_hold_audit enable row level security;

create policy "legal_hold_audit operator read"
  on public.legal_hold_audit for select to authenticated
  using (public.has_role(auth.uid(), 'operator') or public.has_role(auth.uid(), 'admin'));

create or replace function public.set_legal_hold(
  _file_id uuid,
  _on boolean,
  _reason text default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  _actor uuid := auth.uid();
begin
  if _actor is null or not public.has_role(_actor, 'admin') then
    raise exception 'forbidden: admin role required';
  end if;
  update public.ingested_files set legal_hold = _on where id = _file_id;
  if not found then raise exception 'ingested_file % not found', _file_id; end if;
  insert into public.legal_hold_audit (file_id, on_hold, reason, actor)
    values (_file_id, _on, _reason, _actor);
  return jsonb_build_object('file_id', _file_id, 'legal_hold', _on);
end;
$$;

revoke execute on function public.set_legal_hold(uuid, boolean, text) from public;
grant execute on function public.set_legal_hold(uuid, boolean, text) to authenticated;