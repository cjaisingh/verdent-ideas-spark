
CREATE TABLE IF NOT EXISTS public.copilot_transcripts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid,
  agent_slug text,
  model text,
  started_at timestamptz NOT NULL DEFAULT now(),
  ended_at timestamptz,
  turn_count int NOT NULL DEFAULT 0,
  summary text,
  analysis jsonb,
  analyzed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.copilot_transcript_turns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  transcript_id uuid NOT NULL REFERENCES public.copilot_transcripts(id) ON DELETE CASCADE,
  ord int NOT NULL,
  role text NOT NULL CHECK (role IN ('user','assistant','tool','system')),
  content text NOT NULL DEFAULT '',
  model text,
  latency_ms int,
  tool_calls jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_transcript_turns_transcript_ord
  ON public.copilot_transcript_turns(transcript_id, ord);
CREATE INDEX IF NOT EXISTS idx_transcripts_started
  ON public.copilot_transcripts(started_at DESC);

ALTER TABLE public.copilot_transcripts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.copilot_transcript_turns ENABLE ROW LEVEL SECURITY;

CREATE POLICY "operators read transcripts" ON public.copilot_transcripts
  FOR SELECT TO authenticated
  USING (has_role(auth.uid(),'operator'::app_role) OR has_role(auth.uid(),'admin'::app_role));
CREATE POLICY "operators update transcripts" ON public.copilot_transcripts
  FOR UPDATE TO authenticated
  USING (has_role(auth.uid(),'operator'::app_role) OR has_role(auth.uid(),'admin'::app_role))
  WITH CHECK (has_role(auth.uid(),'operator'::app_role) OR has_role(auth.uid(),'admin'::app_role));
CREATE POLICY "operators delete transcripts" ON public.copilot_transcripts
  FOR DELETE TO authenticated
  USING (has_role(auth.uid(),'operator'::app_role) OR has_role(auth.uid(),'admin'::app_role));

CREATE POLICY "operators read transcript turns" ON public.copilot_transcript_turns
  FOR SELECT TO authenticated
  USING (has_role(auth.uid(),'operator'::app_role) OR has_role(auth.uid(),'admin'::app_role));

ALTER PUBLICATION supabase_realtime ADD TABLE public.copilot_transcripts;
ALTER PUBLICATION supabase_realtime ADD TABLE public.copilot_transcript_turns;
