create table public.connection_test_results (
  env_var_name text primary key,
  connector_id text not null,
  outcome text not null check (outcome in ('verified','skipped','failed','unknown')),
  latency_ms integer,
  error text,
  scope_hint jsonb,
  tested_at timestamptz not null default now(),
  tested_by uuid references auth.users(id) on delete set null
);

alter table public.connection_test_results enable row level security;

create policy "operator read connection_test_results"
on public.connection_test_results
for select
to authenticated
using (public.has_role(auth.uid(),'operator') or public.has_role(auth.uid(),'admin'));