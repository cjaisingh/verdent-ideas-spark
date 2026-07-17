-- W10-S1 · M1 — records layer (#36, smallest reviewable slice per plan.md)
--
-- Gives every ingested file a records identity: class, retention policy,
-- revision chain, legal hold, and a byte-storage tier. Schema + policies only;
-- the deterministic classifier ships alongside in _shared/contracts/records-class.ts.
-- Behavioural pieces (retention sweeper, quota enforcement, revision detection in
-- ingest-file) and S2 lifecycle/approval land in later slices.

-- ---- enums -------------------------------------------------------------
create type public.records_class as enum (
  'contract', 'certificate', 'register', 'model', 'drawing',
  'correspondence', 'media', 'other'
);

create type public.bytes_tier as enum ('hot', 'chunks_only', 'tombstone');

-- ---- retention_policies (seeded) ---------------------------------------
create table public.retention_policies (
  key                    text primary key,
  hot_days               int  not null check (hot_days >= 0),
  chunks_days            int  not null check (chunks_days >= 0),
  min_approval_for_delete text not null default 'approved',
  description            text,
  created_at             timestamptz not null default now()
);

-- Seed the standard schedule. These are the starting retention schedule the
-- DPA/solicitor engagement (plan.md First action #6) will ratify; tune later.
insert into public.retention_policies (key, hot_days, chunks_days, min_approval_for_delete, description) values
  ('standard', 90,  730,  'approved',      'Default: hot 90d, chunks retained 2y.'),
  ('contract', 365, 3650, 'approved',      'Contracts & certificates: hot 1y, chunks 10y.'),
  ('media',    30,  365,  'approved',      'Media/binary: hot 30d, chunks 1y.'),
  ('working',  30,  90,   'auto_approved', 'Working/correspondence: short retention.')
on conflict (key) do nothing;

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

-- ---- ingested_files: records identity columns --------------------------
-- retention_policy_key defaults to 'standard', which is seeded above so the
-- FK validates against existing rows during the ALTER.
alter table public.ingested_files
  add column if not exists records_class public.records_class not null default 'other',
  add column if not exists retention_policy_key text not null default 'standard'
    references public.retention_policies(key) on update cascade,
  add column if not exists revision_of uuid references public.ingested_files(id) on delete set null,
  add column if not exists revision_label text,
  add column if not exists legal_hold boolean not null default false,
  add column if not exists bytes_tier public.bytes_tier not null default 'hot';

create index if not exists ingested_files_records_class_idx
  on public.ingested_files (records_class);
create index if not exists ingested_files_revision_of_idx
  on public.ingested_files (revision_of) where revision_of is not null;
create index if not exists ingested_files_legal_hold_idx
  on public.ingested_files (legal_hold) where legal_hold;

-- ---- legal_hold_audit + admin-gated setter -----------------------------
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

-- Legal hold is admin-only; SECURITY DEFINER so the write + audit are atomic
-- and the RLS on ingested_files/legal_hold_audit is enforced via the explicit
-- role check rather than the caller's grants.
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
