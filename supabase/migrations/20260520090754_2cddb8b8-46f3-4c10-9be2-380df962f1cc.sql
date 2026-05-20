alter table public.operator_inbox_sources
  add column if not exists lane text not null default 'operator';
alter table public.operator_inbox_sources
  drop constraint if exists operator_inbox_sources_lane_chk;
alter table public.operator_inbox_sources
  add constraint operator_inbox_sources_lane_chk
  check (lane in ('operator','caprica'));

alter table public.operator_messages
  add column if not exists lane text not null default 'operator';
alter table public.operator_messages
  drop constraint if exists operator_messages_lane_chk;
alter table public.operator_messages
  add constraint operator_messages_lane_chk
  check (lane in ('operator','caprica'));

create index if not exists idx_operator_messages_lane
  on public.operator_messages (lane, created_at desc);

drop view if exists public.v_operator_inbox_24h;
drop view if exists public.v_operator_inbox_unpromoted;
drop view if exists public.v_caprica_inbox_24h;

create view public.v_operator_inbox_24h as
select m.id, m.created_at, m.chat_id, m.source, m.kind, m.kind_source,
       m.kind_confidence, m.text, m.intent, m.promoted_action_id, m.lane,
       s.label as source_label,
       da.short_num as action_short_num, da.status as action_status
  from public.operator_messages m
  left join public.operator_inbox_sources s on s.chat_id = m.chat_id
  left join public.discussion_actions da on da.id = m.promoted_action_id
 where m.direction = 'inbound' and m.lane = 'operator'
   and m.created_at >= now() - interval '24 hours'
 order by m.created_at desc;
grant select on public.v_operator_inbox_24h to authenticated;

create view public.v_operator_inbox_unpromoted as
select m.id, m.created_at, m.chat_id, m.source, m.kind, m.text, m.lane,
       s.label as source_label
  from public.operator_messages m
  left join public.operator_inbox_sources s on s.chat_id = m.chat_id
 where m.direction = 'inbound' and m.lane = 'operator'
   and m.kind in ('idea','research','suggestion')
   and m.promoted_action_id is null
 order by m.created_at desc;
grant select on public.v_operator_inbox_unpromoted to authenticated;

create view public.v_caprica_inbox_24h as
select m.id, m.created_at, m.chat_id, m.source, m.kind, m.text, m.lane,
       s.label as source_label
  from public.operator_messages m
  left join public.operator_inbox_sources s on s.chat_id = m.chat_id
 where m.direction = 'inbound' and m.lane = 'caprica'
   and m.created_at >= now() - interval '24 hours'
 order by m.created_at desc;
grant select on public.v_caprica_inbox_24h to authenticated;