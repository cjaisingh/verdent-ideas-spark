-- Observability contract registry
create table if not exists public.observability_registry (
  id uuid primary key default gen_random_uuid(),
  surface_kind text not null check (surface_kind in ('cron','edge_fn','table','agent')),
  surface_id text not null,
  expected_cadence_minutes integer,
  watcher_kinds text[] not null default '{}',
  domain_silence_window_hours integer,
  owner text,
  notes text,
  declared_in text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (surface_kind, surface_id)
);

create index if not exists idx_observability_registry_kind on public.observability_registry (surface_kind);

alter table public.observability_registry enable row level security;

create policy "operator reads observability_registry"
  on public.observability_registry for select
  to authenticated
  using (public.has_role(auth.uid(), 'admin'));

create policy "operator writes observability_registry"
  on public.observability_registry for all
  to authenticated
  using (public.has_role(auth.uid(), 'admin'))
  with check (public.has_role(auth.uid(), 'admin'));

-- Telegram outbound delivery log
create table if not exists public.telegram_send_log (
  id uuid primary key default gen_random_uuid(),
  chat_id text,
  payload_hash text,
  status text not null check (status in ('success','failed','error')),
  http_status integer,
  error text,
  attempts integer not null default 1,
  caller text,
  created_at timestamptz not null default now()
);

create index if not exists idx_telegram_send_log_created on public.telegram_send_log (created_at desc);
create index if not exists idx_telegram_send_log_status on public.telegram_send_log (status, created_at desc);

alter table public.telegram_send_log enable row level security;

create policy "operator reads telegram_send_log"
  on public.telegram_send_log for select
  to authenticated
  using (public.has_role(auth.uid(), 'admin'));

alter publication supabase_realtime add table public.telegram_send_log;

-- Seed: 22 monitored cron jobs from SENTINEL_CADENCES + key edge fns
insert into public.observability_registry (surface_kind, surface_id, expected_cadence_minutes, watcher_kinds, owner, declared_in, notes)
values
  ('cron','sentinel-tick',15,array['cron_silence','five_xx_spike'],'sentinel','docs/sentinel.md','15-min watcher'),
  ('cron','tomorrow-plan-refresh',15,array['cron_silence'],'morning-review','docs/morning-review.md',null),
  ('cron','overnight-phase-runner-15m',15,array['cron_silence','cron_auth_failures_burst'],'night-agent','docs/phases-overnight-operator-guide.md',null),
  ('cron','automation-auth-monitor',15,array['cron_silence'],'platform',null,null),
  ('cron','secrets-health-check',720,array['cron_silence','secrets_health_stale'],'platform','mem://features/secret-rotation-safety',null),
  ('cron','morning-review',1440,array['cron_silence','job_error_rate'],'morning-review','docs/morning-review.md',null),
  ('cron','night-agent-open',1440,array['cron_silence'],'night-agent','docs/night-agent-test-mode.md',null),
  ('cron','night-agent-close',1440,array['cron_silence'],'night-agent',null,null),
  ('cron','scheduled-code-review',1440,array['cron_silence'],'platform',null,null),
  ('cron','lessons-daily-synth',1440,array['cron_silence','job_error_rate'],'lessons','docs/lessons-loop.md',null),
  ('cron','overnight-prequeue',1440,array['cron_silence'],'night-agent',null,null),
  ('cron','overnight-recommender',1440,array['cron_silence'],'night-agent','docs/overnight-recommender.md',null),
  ('cron','record-test-run',1440,array['cron_silence'],'ci',null,'investigate empty test_runs table'),
  ('cron','qa-validate',10080,array['cron_silence'],'ci',null,null),
  ('cron','scheduled-deep-audit-weekly',10080,array['cron_silence'],'deep-audit','docs/deep-audit.md',null),
  ('cron','scheduled-deep-audit-monthly',43200,array['cron_silence'],'deep-audit',null,null),
  ('cron','scheduled-app-walkthrough',1440,array['cron_silence'],'walkthrough','docs/app-walkthrough.md',null),
  ('cron','scheduled-awip-reviews-pull',10080,array['cron_silence'],'reviews','docs/awip-reviews.md',null),
  ('cron','scheduled-quarterly-review-open',43200,array['cron_silence'],'reviews','docs/quarterly-review.md',null),
  ('cron','scheduled-tomorrow-plan-refresh',15,array['cron_silence'],'morning-review',null,null),
  ('cron','ci-status-sync-30m',30,array['domain_silence'],'ci','docs/ci-cd.md','writes to discussion_actions, not automation_runs'),
  ('cron','scheduled-heygen-poll',2,array['cron_silence','heygen_videos_failed'],'heygen','docs/gemini-tts.md',null),
  -- Edge functions with their own watchers
  ('edge_fn','telegram-send',null,array['telegram_send_failures_burst','telegram_outbound_silent'],'platform','mem://features/alert-telegram-delivery','outbound delivery'),
  ('edge_fn','telegram-webhook',null,array['telegram_webhook_silent'],'platform','mem://features/telegram-webhook-recovery','inbound webhook'),
  ('edge_fn','gemini-tts',null,array['five_xx_spike'],'voice','docs/gemini-tts.md',null),
  ('edge_fn','companion-cloud-chat',null,array['companion_streams_stalled'],'companion','mem://features/companion-resume',null),
  ('edge_fn','sentinel-tick',null,array['five_xx_spike','job_error_rate'],'sentinel','docs/sentinel.md',null),
  ('edge_fn','session-bootstrap',null,array['five_xx_spike'],'platform','docs/session-lifecycle.md',null),
  ('edge_fn','session-summary-log',null,array['five_xx_spike'],'platform','docs/session-lifecycle.md',null)
on conflict (surface_kind, surface_id) do update
  set expected_cadence_minutes = excluded.expected_cadence_minutes,
      watcher_kinds = excluded.watcher_kinds,
      owner = excluded.owner,
      declared_in = excluded.declared_in,
      notes = excluded.notes,
      updated_at = now();