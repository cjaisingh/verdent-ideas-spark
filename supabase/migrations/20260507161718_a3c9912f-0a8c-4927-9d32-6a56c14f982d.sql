
-- Catalog of Copilot agents (shared across operators)
CREATE TABLE public.copilot_agents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text NOT NULL UNIQUE,
  name text NOT NULL,
  wake_word text NOT NULL UNIQUE,
  description text,
  system_prompt text NOT NULL DEFAULT '',
  tts_voice text NOT NULL DEFAULT 'aura-2-orion-en',
  language text NOT NULL DEFAULT 'en',
  default_greeting text NOT NULL DEFAULT 'Copilot ready.',
  allowed_capability_ids text[] NOT NULL DEFAULT '{}',
  allowed_tables text[] NOT NULL DEFAULT '{}',
  max_risk text NOT NULL DEFAULT 'medium' CHECK (max_risk IN ('low','medium','high')),
  enabled boolean NOT NULL DEFAULT true,
  "order" integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.copilot_agents ENABLE ROW LEVEL SECURITY;

CREATE POLICY "operators read copilot_agents"
  ON public.copilot_agents FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'operator'));

CREATE POLICY "admins write copilot_agents"
  ON public.copilot_agents FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE TRIGGER copilot_agents_updated_at
  BEFORE UPDATE ON public.copilot_agents
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Per-user overrides for each agent
CREATE TABLE public.copilot_agent_overrides (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  agent_id uuid NOT NULL REFERENCES public.copilot_agents(id) ON DELETE CASCADE,
  tts_voice text,
  greeting text,
  mic_gain numeric,
  out_volume numeric,
  noise_gate numeric,
  enabled boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, agent_id)
);

ALTER TABLE public.copilot_agent_overrides ENABLE ROW LEVEL SECURITY;

CREATE POLICY "users read own overrides"
  ON public.copilot_agent_overrides FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "users insert own overrides"
  ON public.copilot_agent_overrides FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "users update own overrides"
  ON public.copilot_agent_overrides FOR UPDATE TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE POLICY "users delete own overrides"
  ON public.copilot_agent_overrides FOR DELETE TO authenticated
  USING (auth.uid() = user_id);

CREATE TRIGGER copilot_agent_overrides_updated_at
  BEFORE UPDATE ON public.copilot_agent_overrides
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Track active agent per operator
ALTER TABLE public.copilot_settings
  ADD COLUMN active_agent_id uuid REFERENCES public.copilot_agents(id) ON DELETE SET NULL;

-- Realtime
ALTER PUBLICATION supabase_realtime ADD TABLE public.copilot_agents;
ALTER PUBLICATION supabase_realtime ADD TABLE public.copilot_agent_overrides;

-- Seed two starter agents
INSERT INTO public.copilot_agents
  (slug, name, wake_word, description, system_prompt, tts_voice, default_greeting,
   allowed_capability_ids, allowed_tables, max_risk, "order")
VALUES
  ('dev', 'Rex', 'rex',
   'Developer copilot — roadmap, code reviews, test runs.',
   'You are Rex, a terse developer copilot for the AWIP operator. Focus on roadmap progress, code reviews, and test results. Never make destructive changes without explicit confirmation.',
   'aura-2-orion-en',
   'Rex online. What are we shipping?',
   ARRAY['code-review','roadmap-status','test-runs','deploy-status'],
   ARRAY['roadmap_tasks','roadmap_sprints','roadmap_phases','roadmap_work_log','roadmap_review_findings','test_runs','automation_runs'],
   'medium', 1),
  ('admin', 'Ada', 'ada',
   'Admin copilot — users, roles, retention, alerts.',
   'You are Ada, the admin copilot. You handle user roles, retention windows, and alerting. Always require explicit confirmation for any role change or destructive purge.',
   'aura-2-luna-en',
   'Ada here. Operator console is yours.',
   ARRAY['user-management','role-management','retention','alerts','db-explorer'],
   ARRAY['user_roles','role_change_audit','alert_log','alert_settings','retention_settings','memory_audit_log','db_explorer_audit'],
   'high', 2);
