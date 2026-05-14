-- Hermes slice 3 — companion session auto-resume

-- 1. Extend companion_messages with stream lifecycle
ALTER TABLE public.companion_messages
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'complete',
  ADD COLUMN IF NOT EXISTS streamed_at timestamptz;

ALTER TABLE public.companion_messages
  DROP CONSTRAINT IF EXISTS companion_messages_status_check;
ALTER TABLE public.companion_messages
  ADD CONSTRAINT companion_messages_status_check
  CHECK (status IN ('pending','streaming','complete','interrupted','error'));

CREATE INDEX IF NOT EXISTS idx_companion_messages_thread_status
  ON public.companion_messages (thread_id, status);

-- 2. Per-operator session state (last-active thread)
CREATE TABLE IF NOT EXISTS public.companion_session_state (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  last_thread_id uuid REFERENCES public.companion_threads(id) ON DELETE SET NULL,
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.companion_session_state ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "owner read companion_session_state" ON public.companion_session_state;
CREATE POLICY "owner read companion_session_state"
  ON public.companion_session_state
  FOR SELECT TO authenticated
  USING (user_id = auth.uid() AND has_role(auth.uid(), 'operator'::app_role));

DROP POLICY IF EXISTS "owner insert companion_session_state" ON public.companion_session_state;
CREATE POLICY "owner insert companion_session_state"
  ON public.companion_session_state
  FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid() AND has_role(auth.uid(), 'operator'::app_role));

DROP POLICY IF EXISTS "owner update companion_session_state" ON public.companion_session_state;
CREATE POLICY "owner update companion_session_state"
  ON public.companion_session_state
  FOR UPDATE TO authenticated
  USING (user_id = auth.uid() AND has_role(auth.uid(), 'operator'::app_role))
  WITH CHECK (user_id = auth.uid() AND has_role(auth.uid(), 'operator'::app_role));

DROP TRIGGER IF EXISTS set_companion_session_state_updated_at ON public.companion_session_state;
CREATE TRIGGER set_companion_session_state_updated_at
  BEFORE UPDATE ON public.companion_session_state
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

ALTER PUBLICATION supabase_realtime ADD TABLE public.companion_session_state;