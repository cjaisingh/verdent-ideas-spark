create table if not exists public.voice_config (
  user_id uuid primary key references auth.users(id) on delete cascade,
  stt_provider text not null default 'browser-webspeech',
  tts_provider text not null default 'gemini',
  tts_voice text not null default 'Kore',
  transport text not null default 'browser',
  mic_label text,
  rork_enabled boolean not null default true,
  last_validated_at timestamptz,
  last_validation jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.voice_config enable row level security;

create policy "operator reads own voice_config"
  on public.voice_config for select to authenticated
  using (user_id = auth.uid() and (has_role(auth.uid(),'operator') or has_role(auth.uid(),'admin')));

create policy "operator inserts own voice_config"
  on public.voice_config for insert to authenticated
  with check (user_id = auth.uid() and (has_role(auth.uid(),'operator') or has_role(auth.uid(),'admin')));

create policy "operator updates own voice_config"
  on public.voice_config for update to authenticated
  using (user_id = auth.uid() and (has_role(auth.uid(),'operator') or has_role(auth.uid(),'admin')));

create trigger trg_voice_config_updated_at
  before update on public.voice_config
  for each row execute function public.update_updated_at_column();

alter publication supabase_realtime add table public.voice_config;