create table public.roadmap_phase_overnight_runs (
  id uuid primary key default gen_random_uuid(),
  phase_id uuid not null references public.roadmap_phases(id) on delete cascade,
  phase_key text not null,
  requested_by uuid not null,
  requested_at timestamptz not null default now(),
  scheduled_for date not null default (now() at time zone 'utc')::date,
  status text not null default 'queued',
  started_at timestamptz,
  finished_at timestamptz,
  result jsonb,
  error text,
  model text,
  created_at timestamptz not null default now()
);

create index idx_overnight_runs_status on public.roadmap_phase_overnight_runs(status, scheduled_for);
create index idx_overnight_runs_phase on public.roadmap_phase_overnight_runs(phase_id, requested_at desc);

alter table public.roadmap_phase_overnight_runs enable row level security;

create policy "operators read overnight runs"
  on public.roadmap_phase_overnight_runs for select
  to authenticated using (has_role(auth.uid(),'operator'));

create policy "operators queue overnight runs"
  on public.roadmap_phase_overnight_runs for insert
  to authenticated
  with check (has_role(auth.uid(),'operator') and requested_by = auth.uid() and status = 'queued');

-- updates/deletes blocked from clients; runner uses service role
create policy "no client update overnight runs"
  on public.roadmap_phase_overnight_runs for update
  to authenticated using (false) with check (false);
create policy "no client delete overnight runs"
  on public.roadmap_phase_overnight_runs for delete
  to authenticated using (false);

alter publication supabase_realtime add table public.roadmap_phase_overnight_runs;

-- Operator-cancellable via SECURITY DEFINER RPC (only their own queued rows)
create or replace function public.cancel_overnight_run(_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not has_role(auth.uid(), 'operator') then
    raise exception 'not authorized';
  end if;
  update public.roadmap_phase_overnight_runs
     set status = 'cancelled',
         finished_at = now()
   where id = _id
     and status = 'queued'
     and requested_by = auth.uid();
  if not found then
    raise exception 'run not found, not queued, or not owned by caller';
  end if;
end;
$$;