-- W10-S2 · M2 slice 1 — lifecycle + approval-policy schema (#36)
--
-- Lands the trust-boundary DATA MODEL only. This is deliberately inert: files
-- get a `lifecycle` (default 'ingested'), per-class approval policies are
-- seeded, retrieval contracts gain `min_approval_state`, and the file event
-- stream learns the lifecycle event kinds — but nothing enforces any of it yet.
-- The behavioural wiring (ingest-callback policy stamping, a lifecycle
-- transition endpoint, the approval-aware `_v2` match RPCs, and the corpus
-- backfill) is M2 slice 2 — it must ship together with the backfill so existing
-- content is 'approved' before retrieval starts filtering, and the spec flags
-- the `_v2` RPC swap as the programme's riskiest change (wrapper week).

-- ---- enums -------------------------------------------------------------
create type public.doc_lifecycle as enum (
  'ingested', 'pending_review', 'auto_approved', 'approved',
  'superseded', 'archived', 'quarantined', 'rejected'
);

create type public.approval_mode as enum ('auto', 'operator', 'four_eyes');

-- ---- ingested_files: lifecycle columns ---------------------------------
alter table public.ingested_files
  add column if not exists lifecycle public.doc_lifecycle not null default 'ingested',
  add column if not exists approved_by uuid,
  add column if not exists approved_at timestamptz,
  add column if not exists approval_id uuid;

create index if not exists ingested_files_lifecycle_idx
  on public.ingested_files (lifecycle);

-- ---- document_approval_policies (per records_class, seeded) -------------
create table public.document_approval_policies (
  records_class   public.records_class primary key,
  mode            public.approval_mode not null,
  auto_conditions jsonb not null default '{}'::jsonb,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

-- Seeds per spec S2: consequential classes need an operator; low-risk classes
-- auto-approve when the parse is clean and a lawful basis is declared.
-- four_eyes ships dormant (no seed selects it while one operator).
insert into public.document_approval_policies (records_class, mode, auto_conditions) values
  ('contract',       'operator', '{}'::jsonb),
  ('certificate',    'operator', '{}'::jsonb),
  ('register',       'operator', '{}'::jsonb),
  ('model',          'operator', '{}'::jsonb),
  ('drawing',        'operator', '{}'::jsonb),
  ('correspondence', 'auto',     '{"require_clean_parse": true, "require_lawful_basis": true}'::jsonb),
  ('media',          'auto',     '{"require_clean_parse": true, "require_lawful_basis": true}'::jsonb),
  ('other',          'auto',     '{"require_clean_parse": true, "require_lawful_basis": true}'::jsonb)
on conflict (records_class) do nothing;

grant select on public.document_approval_policies to authenticated;
grant all on public.document_approval_policies to service_role;
alter table public.document_approval_policies enable row level security;

create policy "document_approval_policies operator read"
  on public.document_approval_policies for select to authenticated
  using (public.has_role(auth.uid(), 'operator') or public.has_role(auth.uid(), 'admin'));

create policy "document_approval_policies admin write"
  on public.document_approval_policies for all to authenticated
  using (public.has_role(auth.uid(), 'admin'))
  with check (public.has_role(auth.uid(), 'admin'));

create trigger document_approval_policies_touch
  before update on public.document_approval_policies
  for each row execute function public.update_updated_at_column();

-- ---- retrieval trust boundary: min_approval_state ----------------------
-- Default 'approved' = retrieval serves only approved content unless a contract
-- widens it. Inert until the _v2 match RPCs read it (M2 slice 2).
alter table public.retrieval_contracts
  add column if not exists min_approval_state text not null default 'approved'
    check (min_approval_state in ('any', 'auto_approved', 'approved'));

-- ---- file event stream: lifecycle event kinds --------------------------
alter table public.ingested_file_events
  drop constraint if exists ingested_file_events_event_type_check;

alter table public.ingested_file_events
  add constraint ingested_file_events_event_type_check
  check (event_type in (
    'uploaded', 'parse_started', 'parse_heartbeat', 'parsed', 'chunked', 'embedded',
    'failed', 'retry_queued', 'superseded', 'metadata_only',
    'entities_extracted', 'doc_embedded',
    'submitted_for_review', 'document_approved', 'document_auto_approved',
    'document_rejected', 'document_quarantined', 'revision_superseded'
  ));
