create type public.doc_lifecycle as enum (
  'ingested', 'pending_review', 'auto_approved', 'approved',
  'superseded', 'archived', 'quarantined', 'rejected'
);

create type public.approval_mode as enum ('auto', 'operator', 'four_eyes');

alter table public.ingested_files
  add column if not exists lifecycle public.doc_lifecycle not null default 'ingested',
  add column if not exists approved_by uuid,
  add column if not exists approved_at timestamptz,
  add column if not exists approval_id uuid;

create index if not exists ingested_files_lifecycle_idx on public.ingested_files (lifecycle);

create table public.document_approval_policies (
  records_class   public.records_class primary key,
  mode            public.approval_mode not null,
  auto_conditions jsonb not null default '{}'::jsonb,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

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

alter table public.retrieval_contracts
  add column if not exists min_approval_state text not null default 'approved'
    check (min_approval_state in ('any', 'auto_approved', 'approved'));

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