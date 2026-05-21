create table if not exists public.adr_bench_results (
  id uuid primary key default gen_random_uuid(),
  adr text not null,
  ran_at timestamptz not null,
  dataset_hash text not null,
  metrics jsonb not null default '{}'::jsonb,
  notes text,
  tripped_triggers text[] not null default '{}'::text[],
  source text not null default 'script',
  created_at timestamptz not null default now()
);

create index if not exists idx_adr_bench_results_adr_ranat
  on public.adr_bench_results (adr, ran_at desc);

alter table public.adr_bench_results enable row level security;

drop policy if exists "operators read adr_bench_results" on public.adr_bench_results;
create policy "operators read adr_bench_results"
  on public.adr_bench_results for select to authenticated
  using (public.has_role(auth.uid(), 'admin'));

drop policy if exists "operators insert adr_bench_results" on public.adr_bench_results;
create policy "operators insert adr_bench_results"
  on public.adr_bench_results for insert to authenticated
  with check (public.has_role(auth.uid(), 'admin'));

alter publication supabase_realtime add table public.adr_bench_results;