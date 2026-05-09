
-- Companion threads (one per conversation)
CREATE TABLE public.companion_threads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL DEFAULT 'New conversation',
  agent_kind text NOT NULL DEFAULT 'general',
  model text,
  ollama_base_url text,
  created_by uuid NOT NULL,
  archived_at timestamptz,
  seed_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_companion_threads_owner_updated ON public.companion_threads (created_by, updated_at DESC);

ALTER TABLE public.companion_threads ENABLE ROW LEVEL SECURITY;

CREATE POLICY "owner read companion_threads" ON public.companion_threads
  FOR SELECT TO authenticated
  USING (created_by = auth.uid() AND has_role(auth.uid(), 'operator'::app_role));

CREATE POLICY "owner insert companion_threads" ON public.companion_threads
  FOR INSERT TO authenticated
  WITH CHECK (created_by = auth.uid() AND has_role(auth.uid(), 'operator'::app_role));

CREATE POLICY "owner update companion_threads" ON public.companion_threads
  FOR UPDATE TO authenticated
  USING (created_by = auth.uid() AND has_role(auth.uid(), 'operator'::app_role))
  WITH CHECK (created_by = auth.uid() AND has_role(auth.uid(), 'operator'::app_role));

CREATE POLICY "owner delete companion_threads" ON public.companion_threads
  FOR DELETE TO authenticated
  USING (created_by = auth.uid() AND has_role(auth.uid(), 'operator'::app_role));

CREATE TRIGGER trg_companion_threads_updated
  BEFORE UPDATE ON public.companion_threads
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Companion messages (turns within a thread)
CREATE TABLE public.companion_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  thread_id uuid NOT NULL REFERENCES public.companion_threads(id) ON DELETE CASCADE,
  role text NOT NULL,
  content text NOT NULL DEFAULT '',
  parts jsonb NOT NULL DEFAULT '[]'::jsonb,
  model text,
  latency_ms integer,
  escalated_action_id uuid,
  rag_chunk_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_companion_messages_thread_time ON public.companion_messages (thread_id, created_at);

ALTER TABLE public.companion_messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "owner read companion_messages" ON public.companion_messages
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.companion_threads t
    WHERE t.id = thread_id AND t.created_by = auth.uid()
      AND has_role(auth.uid(), 'operator'::app_role)
  ));

CREATE POLICY "owner insert companion_messages" ON public.companion_messages
  FOR INSERT TO authenticated
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.companion_threads t
    WHERE t.id = thread_id AND t.created_by = auth.uid()
      AND has_role(auth.uid(), 'operator'::app_role)
  ));

CREATE POLICY "owner update companion_messages" ON public.companion_messages
  FOR UPDATE TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.companion_threads t
    WHERE t.id = thread_id AND t.created_by = auth.uid()
      AND has_role(auth.uid(), 'operator'::app_role)
  ));

CREATE POLICY "owner delete companion_messages" ON public.companion_messages
  FOR DELETE TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.companion_threads t
    WHERE t.id = thread_id AND t.created_by = auth.uid()
      AND has_role(auth.uid(), 'operator'::app_role)
  ));

-- Realtime
ALTER PUBLICATION supabase_realtime ADD TABLE public.companion_threads;
ALTER PUBLICATION supabase_realtime ADD TABLE public.companion_messages;

-- Retention (30 days for messages, threads kept indefinitely)
INSERT INTO public.retention_settings (table_name, retention_days, description)
VALUES ('companion_messages', 30, 'AWIP Companion chat turns (local LLM discussion layer)')
ON CONFLICT (table_name) DO NOTHING;
