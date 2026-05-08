-- Discussion sessions per code-review finding
CREATE TABLE public.roadmap_finding_discussions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  finding_id uuid NOT NULL REFERENCES public.roadmap_review_findings(id) ON DELETE CASCADE,
  mode text NOT NULL CHECK (mode IN ('copilot','lovable_chat')),
  started_by_user_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  ended_at timestamptz
);
CREATE INDEX idx_finding_discussions_finding ON public.roadmap_finding_discussions(finding_id, created_at DESC);
ALTER TABLE public.roadmap_finding_discussions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "operators read finding_discussions" ON public.roadmap_finding_discussions
  FOR SELECT TO authenticated USING (has_role(auth.uid(),'operator'::app_role));
CREATE POLICY "operators insert finding_discussions" ON public.roadmap_finding_discussions
  FOR INSERT TO authenticated WITH CHECK (has_role(auth.uid(),'operator'::app_role));
CREATE POLICY "operators update finding_discussions" ON public.roadmap_finding_discussions
  FOR UPDATE TO authenticated USING (has_role(auth.uid(),'operator'::app_role)) WITH CHECK (has_role(auth.uid(),'operator'::app_role));

-- Transcript turns
CREATE TABLE public.roadmap_finding_discussion_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  discussion_id uuid NOT NULL REFERENCES public.roadmap_finding_discussions(id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('user','copilot','system')),
  source text NOT NULL CHECK (source IN ('voice','text','system')),
  body text NOT NULL,
  model text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_finding_discussion_messages_disc ON public.roadmap_finding_discussion_messages(discussion_id, created_at);
ALTER TABLE public.roadmap_finding_discussion_messages ENABLE ROW LEVEL SECURITY;
CREATE POLICY "operators read discussion_messages" ON public.roadmap_finding_discussion_messages
  FOR SELECT TO authenticated USING (has_role(auth.uid(),'operator'::app_role));
CREATE POLICY "operators insert discussion_messages" ON public.roadmap_finding_discussion_messages
  FOR INSERT TO authenticated WITH CHECK (has_role(auth.uid(),'operator'::app_role));

-- Decision + status columns on findings
ALTER TABLE public.roadmap_review_findings
  ADD COLUMN discussion_status text NOT NULL DEFAULT 'none' CHECK (discussion_status IN ('none','in_lovable_chat','copilot_open','paused','resolved')),
  ADD COLUMN decision_outcome text CHECK (decision_outcome IN ('accept_risk','mitigate','convert_to_task','dismiss')),
  ADD COLUMN decision_summary text,
  ADD COLUMN decision_recorded_at timestamptz,
  ADD COLUMN decision_recorded_by uuid;

-- Realtime
ALTER PUBLICATION supabase_realtime ADD TABLE public.roadmap_finding_discussions;
ALTER PUBLICATION supabase_realtime ADD TABLE public.roadmap_finding_discussion_messages;