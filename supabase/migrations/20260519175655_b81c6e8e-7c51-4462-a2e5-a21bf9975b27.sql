
-- Operator Inbox: extend operator_messages, add sources registry, views, operator update policy.

alter table public.operator_messages
  add column if not exists source text not null default 'dm',
  add column if not exists kind text,
  add column if not exists kind_source text,
  add column if not exists kind_confidence numeric,
  add column if not exists promoted_action_id uuid references public.discussion_actions(id) on delete set null;

alter table public.operator_messages
  drop constraint if exists operator_messages_source_chk;
alter table public.operator_messages
  add constraint operator_messages_source_chk
  check (source in ('dm','group','channel','manual_paste'));

alter table public.operator_messages
  drop constraint if exists operator_messages_kind_chk;
alter table public.operator_messages
  add constraint operator_messages_kind_chk
  check (kind is null or kind in ('idea','research','suggestion','question','chat'));

alter table public.operator_messages
  drop constraint if exists operator_messages_kind_source_chk;
alter table public.operator_messages
  add constraint operator_messages_kind_source_chk
  check (kind_source is null or kind_source in ('prefix','llm','manual'));

create index if not exists idx_operator_messages_kind
  on public.operator_messages (kind, created_at desc);

create index if not exists idx_operator_messages_unpromoted
  on public.operator_messages (created_at desc)
  where promoted_action_id is null and kind in ('idea','research','suggestion');

-- Allow operators to update inbox-kind columns (existing "no client write" permissive policy is OR'd with this).
drop policy if exists "operators update operator_messages kind" on public.operator_messages;
create policy "operators update operator_messages kind"
  on public.operator_messages
  for update to authenticated
  using (has_role(auth.uid(), 'operator'::app_role))
  with check (has_role(auth.uid(), 'operator'::app_role));

-- Sources registry — which Telegram chats feed the inbox.
create table if not exists public.operator_inbox_sources (
  chat_id bigint primary key,
  kind text not null check (kind in ('dm','group','channel')),
  label text not null,
  enabled boolean not null default true,
  notes text,
  created_at timestamptz not null default now()
);

alter table public.operator_inbox_sources enable row level security;

drop policy if exists "operators read operator_inbox_sources" on public.operator_inbox_sources;
create policy "operators read operator_inbox_sources"
  on public.operator_inbox_sources for select to authenticated
  using (has_role(auth.uid(), 'operator'::app_role));

drop policy if exists "operators write operator_inbox_sources" on public.operator_inbox_sources;
create policy "operators write operator_inbox_sources"
  on public.operator_inbox_sources for all to authenticated
  using (has_role(auth.uid(), 'operator'::app_role))
  with check (has_role(auth.uid(), 'operator'::app_role));

-- Seed the known operator DM.
insert into public.operator_inbox_sources (chat_id, kind, label, enabled, notes)
values (7139482467, 'dm', 'Operator DM', true, 'Primary AWIP operator chat')
on conflict (chat_id) do nothing;

-- Realtime
alter publication supabase_realtime add table public.operator_inbox_sources;

-- Views
create or replace view public.v_operator_inbox_24h as
select m.id,
       m.created_at,
       m.chat_id,
       m.source,
       m.kind,
       m.kind_source,
       m.kind_confidence,
       m.text,
       m.intent,
       m.promoted_action_id,
       s.label as source_label,
       da.short_num as action_short_num,
       da.status as action_status
  from public.operator_messages m
  left join public.operator_inbox_sources s on s.chat_id = m.chat_id
  left join public.discussion_actions da on da.id = m.promoted_action_id
 where m.direction = 'inbound'
   and m.created_at >= now() - interval '24 hours'
 order by m.created_at desc;

grant select on public.v_operator_inbox_24h to authenticated;

create or replace view public.v_operator_inbox_unpromoted as
select m.id,
       m.created_at,
       m.chat_id,
       m.source,
       m.kind,
       m.text,
       s.label as source_label
  from public.operator_messages m
  left join public.operator_inbox_sources s on s.chat_id = m.chat_id
 where m.direction = 'inbound'
   and m.kind in ('idea','research','suggestion')
   and m.promoted_action_id is null
 order by m.created_at desc;

grant select on public.v_operator_inbox_unpromoted to authenticated;

-- Unique index so auto-promote is idempotent by (subject_type, subject_id).
create unique index if not exists discussion_actions_operator_message_unique
  on public.discussion_actions (subject_type, subject_id)
  where subject_type = 'operator_message';
