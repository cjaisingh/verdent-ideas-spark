-- Decision Authority v0
create table if not exists public.decision_authorities (
  id uuid primary key default gen_random_uuid(),
  entity text not null,
  field text not null default '*',
  source text not null,
  precedence int not null,
  weight numeric not null default 1.0 check (weight >= 0 and weight <= 1),
  override_policy text not null default 'soft' check (override_policy in ('hard','operator_only','soft')),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (entity, field, source)
);

create index if not exists idx_decision_authorities_entity_field
  on public.decision_authorities (entity, field, precedence);

alter table public.decision_authorities enable row level security;

create policy "operators read decision authorities"
  on public.decision_authorities for select
  using (public.has_role(auth.uid(),'operator') or public.has_role(auth.uid(),'admin'));

create policy "operators write decision authorities"
  on public.decision_authorities for all
  using (public.has_role(auth.uid(),'operator') or public.has_role(auth.uid(),'admin'))
  with check (public.has_role(auth.uid(),'operator') or public.has_role(auth.uid(),'admin'));

create trigger decision_authorities_updated_at
  before update on public.decision_authorities
  for each row execute function public.update_updated_at_column();

-- Append-only audit log
create table if not exists public.decision_authority_events (
  id uuid primary key default gen_random_uuid(),
  rule_id uuid,
  entity text not null,
  field text not null,
  source text not null,
  event_type text not null check (event_type in ('created','updated','deleted')),
  actor uuid,
  actor_label text,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

alter table public.decision_authority_events enable row level security;

create policy "operators read decision authority events"
  on public.decision_authority_events for select
  using (public.has_role(auth.uid(),'operator') or public.has_role(auth.uid(),'admin'));

-- Trigger to emit events
create or replace function public.log_decision_authority_event()
returns trigger language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); label text;
begin
  select email into label from auth.users where id = uid;
  if label is null then label := 'system'; end if;

  if TG_OP = 'INSERT' then
    insert into public.decision_authority_events(rule_id, entity, field, source, event_type, actor, actor_label, payload)
      values (new.id, new.entity, new.field, new.source, 'created', uid, label,
              jsonb_build_object('precedence', new.precedence, 'weight', new.weight,
                                 'override_policy', new.override_policy, 'notes', new.notes));
    return new;
  elsif TG_OP = 'UPDATE' then
    insert into public.decision_authority_events(rule_id, entity, field, source, event_type, actor, actor_label, payload)
      values (new.id, new.entity, new.field, new.source, 'updated', uid, label,
              jsonb_build_object(
                'from', jsonb_build_object('precedence', old.precedence, 'weight', old.weight, 'override_policy', old.override_policy, 'notes', old.notes),
                'to',   jsonb_build_object('precedence', new.precedence, 'weight', new.weight, 'override_policy', new.override_policy, 'notes', new.notes)
              ));
    return new;
  elsif TG_OP = 'DELETE' then
    insert into public.decision_authority_events(rule_id, entity, field, source, event_type, actor, actor_label, payload)
      values (old.id, old.entity, old.field, old.source, 'deleted', uid, label,
              jsonb_build_object('precedence', old.precedence, 'weight', old.weight, 'override_policy', old.override_policy));
    return old;
  end if;
  return null;
end $$;

create trigger decision_authorities_log
  after insert or update or delete on public.decision_authorities
  for each row execute function public.log_decision_authority_event();

-- Resolver function (v0: returns rules; claims pipeline lands in a later slice)
create or replace function public.resolve_truth(_entity text, _entity_id uuid, _field text default '*')
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  rules jsonb;
begin
  if not (public.has_role(auth.uid(),'operator') or public.has_role(auth.uid(),'admin')) then
    raise exception 'not authorized';
  end if;

  select coalesce(jsonb_agg(r order by r.precedence), '[]'::jsonb)
    into rules
  from (
    select source, precedence, weight, override_policy, notes
    from public.decision_authorities
    where entity = _entity
      and (field = _field or field = '*')
    order by
      case when field = _field then 0 else 1 end,
      precedence
  ) r;

  return jsonb_build_object(
    'entity', _entity,
    'entity_id', _entity_id,
    'field', _field,
    'winner', null,
    'status', 'no-claims-yet',
    'rules', rules
  );
end $$;

-- Seed rules: operator > ai for every ontology entity
insert into public.decision_authorities (entity, field, source, precedence, weight, override_policy, notes)
values
  ('Tenant',           '*', 'operator', 1, 1.0, 'operator_only', 'Default seed: operator owns Tenant truth'),
  ('Tenant',           '*', 'ai',       9, 0.4, 'soft',          'AI suggestions only'),
  ('OkrNode',          '*', 'operator', 1, 1.0, 'operator_only', 'Default seed: operator owns OKR truth'),
  ('OkrNode',          '*', 'ai',       9, 0.4, 'soft',          'AI suggestions only'),
  ('Capability',       '*', 'operator', 1, 1.0, 'operator_only', 'Default seed: operator owns capability manifest'),
  ('Capability',       '*', 'ai',       9, 0.4, 'soft',          'AI suggestions only'),
  ('RoadmapPhase',     '*', 'operator', 1, 1.0, 'operator_only', 'Default seed: operator owns phase definition'),
  ('RoadmapPhase',     '*', 'ai',       9, 0.4, 'soft',          'AI suggestions only'),
  ('DiscussionAction', '*', 'operator', 1, 1.0, 'operator_only', 'Default seed: operator owns action state'),
  ('DiscussionAction', '*', 'ai',       9, 0.4, 'soft',          'AI suggestions only'),
  ('Lesson',           '*', 'operator', 1, 1.0, 'operator_only', 'Default seed: operator owns lesson safety'),
  ('Lesson',           '*', 'ai',       9, 0.4, 'soft',          'AI synthesis only'),
  ('SentinelFinding',  '*', 'operator', 1, 1.0, 'operator_only', 'Default seed: operator triages findings'),
  ('SentinelFinding',  '*', 'ai',       9, 0.4, 'soft',          'AI auto-detection'),
  ('AuditFinding',     '*', 'operator', 1, 1.0, 'operator_only', 'Default seed: operator owns audit verdicts'),
  ('AuditFinding',     '*', 'ai',       9, 0.4, 'soft',          'AI auto-detection'),
  ('Capacity',         '*', 'operator', 1, 1.0, 'operator_only', 'Default seed: operator owns capacity model'),
  ('Capacity',         '*', 'ai',       9, 0.4, 'soft',          'AI suggestions only'),
  ('TestRun',          '*', 'ci',       1, 1.0, 'hard',          'CI is sole authority on test outcomes'),
  ('TestRun',          '*', 'operator', 5, 0.8, 'soft',          'Operator can annotate but not override CI'),
  ('CapabilityEvent',  '*', 'system',   1, 1.0, 'hard',          'System-emitted, immutable')
on conflict (entity, field, source) do nothing;

-- Realtime
alter publication supabase_realtime add table public.decision_authorities;
alter publication supabase_realtime add table public.decision_authority_events;