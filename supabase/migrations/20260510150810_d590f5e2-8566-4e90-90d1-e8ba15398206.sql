
create table public.awip_reviews (
  id uuid primary key default gen_random_uuid(),
  source_repo text not null,
  source_path text not null,
  file_sha text not null,
  review_date date,
  reviewer text,
  scope text,
  summary text,
  raw_markdown text not null,
  parsed jsonb not null default '{}'::jsonb,
  fetched_at timestamptz not null default now(),
  processed_at timestamptz,
  process_status text not null default 'pending',
  process_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint awip_reviews_status_chk check (process_status in ('pending','processed','error')),
  constraint awip_reviews_unique_file unique (source_repo, source_path, file_sha)
);

create index awip_reviews_date_idx on public.awip_reviews (review_date desc);
create index awip_reviews_status_idx on public.awip_reviews (process_status, fetched_at desc);

alter table public.awip_reviews enable row level security;

create policy "operators read awip_reviews" on public.awip_reviews
  for select to authenticated using (has_role(auth.uid(), 'operator'::app_role));
create policy "operators write awip_reviews" on public.awip_reviews
  for all to authenticated
  using (has_role(auth.uid(), 'operator'::app_role))
  with check (has_role(auth.uid(), 'operator'::app_role));

create trigger awip_reviews_updated before update on public.awip_reviews
  for each row execute function public.update_updated_at_column();

create table public.awip_review_findings (
  id uuid primary key default gen_random_uuid(),
  review_id uuid not null references public.awip_reviews(id) on delete cascade,
  ext_id text,
  title text not null,
  severity text not null default 'info',
  area text,
  recommendation text,
  evidence text,
  actionable boolean not null default true,
  discussion_action_id uuid references public.discussion_actions(id) on delete set null,
  sentinel_finding_id uuid references public.sentinel_findings(id) on delete set null,
  rag_doc_id uuid references public.awip_docs(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint awip_review_findings_severity_chk check (severity in ('info','low','medium','high','critical'))
);

create index awip_review_findings_review_idx on public.awip_review_findings (review_id);
create index awip_review_findings_severity_idx on public.awip_review_findings (severity);

alter table public.awip_review_findings enable row level security;

create policy "operators read awip_review_findings" on public.awip_review_findings
  for select to authenticated using (has_role(auth.uid(), 'operator'::app_role));
create policy "operators write awip_review_findings" on public.awip_review_findings
  for all to authenticated
  using (has_role(auth.uid(), 'operator'::app_role))
  with check (has_role(auth.uid(), 'operator'::app_role));

alter publication supabase_realtime add table public.awip_reviews;
alter publication supabase_realtime add table public.awip_review_findings;
