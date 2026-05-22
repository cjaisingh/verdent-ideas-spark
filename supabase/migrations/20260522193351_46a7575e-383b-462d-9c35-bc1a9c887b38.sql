CREATE TABLE public.module_service_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owning_module text NOT NULL,
  label text NOT NULL,
  token_hash text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz,
  last_used_at timestamptz,
  revoked_at timestamptz,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL
);

CREATE INDEX idx_module_service_tokens_module ON public.module_service_tokens(owning_module) WHERE revoked_at IS NULL;
CREATE INDEX idx_module_service_tokens_hash ON public.module_service_tokens(token_hash);

ALTER TABLE public.module_service_tokens ENABLE ROW LEVEL SECURITY;

CREATE POLICY "operators read module tokens"
  ON public.module_service_tokens FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'operator'::app_role));

CREATE POLICY "admins write module tokens"
  ON public.module_service_tokens FOR ALL
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role));

CREATE TABLE public.module_heartbeats (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owning_module text NOT NULL,
  version text,
  capability_ids text[] NOT NULL DEFAULT '{}',
  sender text,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_module_heartbeats_module_created ON public.module_heartbeats(owning_module, created_at DESC);
CREATE INDEX idx_module_heartbeats_created ON public.module_heartbeats(created_at DESC);

ALTER TABLE public.module_heartbeats ENABLE ROW LEVEL SECURITY;

CREATE POLICY "operators read heartbeats"
  ON public.module_heartbeats FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'operator'::app_role));

ALTER PUBLICATION supabase_realtime ADD TABLE public.capability_events;
ALTER PUBLICATION supabase_realtime ADD TABLE public.module_heartbeats;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='observability_registry') THEN
    INSERT INTO public.observability_registry (surface_kind, surface_id, watcher_kinds, owner, notes, declared_in)
    VALUES
      ('table', 'module_heartbeats', ARRAY['module_silent_24h']::text[], 'capability-architect',
       'Fires when a registered module has not emitted a heartbeat in 24h.', 'mem://features/module-contracts'),
      ('table', 'capability_events', ARRAY['module_register_idempotency_replay_burst']::text[], 'event-engineer',
       'Fires when >50 idempotent register replays land in 1h.', 'mem://features/module-contracts')
    ON CONFLICT DO NOTHING;
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.resolve_module_token(_hash text)
RETURNS TABLE(owning_module text, label text, token_id uuid)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT owning_module, label, id
  FROM public.module_service_tokens
  WHERE token_hash = _hash
    AND revoked_at IS NULL
    AND (expires_at IS NULL OR expires_at > now())
  LIMIT 1;
$$;

REVOKE ALL ON FUNCTION public.resolve_module_token(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.resolve_module_token(text) TO service_role;