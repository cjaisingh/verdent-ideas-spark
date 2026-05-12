
create table public.connection_audit_log (
  id uuid primary key default gen_random_uuid(),
  connector_id text not null,
  env_var_name text not null,
  action text not null check (action in ('unlink_intent','relink_intent','verified_after_relink')),
  actor_user_id uuid not null default auth.uid(),
  note text,
  created_at timestamptz not null default now()
);

create index idx_connection_audit_log_connector on public.connection_audit_log (connector_id, created_at desc);

alter table public.connection_audit_log enable row level security;

create policy "operators read connection audit"
on public.connection_audit_log for select
to authenticated
using (public.has_role(auth.uid(),'operator') or public.has_role(auth.uid(),'admin'));

create policy "operators insert connection audit"
on public.connection_audit_log for insert
to authenticated
with check (
  (public.has_role(auth.uid(),'operator') or public.has_role(auth.uid(),'admin'))
  and actor_user_id = auth.uid()
);
