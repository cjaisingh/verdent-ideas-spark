
-- Onboarding sessions: agent confirms goals/capabilities/approvals before executing
CREATE TABLE public.agent_onboarding_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_slug text NOT NULL,
  actor text NOT NULL,
  user_id uuid,
  intent text NOT NULL,
  goal_text text,
  capability_id text,
  activity text,
  risk text NOT NULL DEFAULT 'unknown',
  required_capabilities text[] NOT NULL DEFAULT '{}',
  required_approvals text[] NOT NULL DEFAULT '{}',
  checklist jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'pending',
  approval_id uuid,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);

CREATE INDEX idx_agent_onboarding_status ON public.agent_onboarding_sessions(status, created_at DESC);
CREATE INDEX idx_agent_onboarding_agent ON public.agent_onboarding_sessions(agent_slug, created_at DESC);

ALTER TABLE public.agent_onboarding_sessions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "operators read agent_onboarding_sessions"
  ON public.agent_onboarding_sessions FOR SELECT TO authenticated
  USING (has_role(auth.uid(), 'operator'::app_role));

CREATE POLICY "operators update agent_onboarding_sessions"
  ON public.agent_onboarding_sessions FOR UPDATE TO authenticated
  USING (has_role(auth.uid(), 'operator'::app_role))
  WITH CHECK (has_role(auth.uid(), 'operator'::app_role));

CREATE POLICY "no client insert agent_onboarding_sessions"
  ON public.agent_onboarding_sessions FOR INSERT TO authenticated
  WITH CHECK (false);

CREATE POLICY "no client delete agent_onboarding_sessions"
  ON public.agent_onboarding_sessions FOR DELETE TO authenticated
  USING (false);

CREATE TRIGGER update_agent_onboarding_updated_at
  BEFORE UPDATE ON public.agent_onboarding_sessions
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Realtime
ALTER PUBLICATION supabase_realtime ADD TABLE public.agent_onboarding_sessions;
