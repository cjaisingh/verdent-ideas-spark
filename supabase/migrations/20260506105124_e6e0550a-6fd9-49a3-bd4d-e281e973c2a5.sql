
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;

CREATE TABLE public.operator_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  update_id bigint UNIQUE,
  chat_id bigint NOT NULL,
  direction text NOT NULL CHECK (direction IN ('inbound','outbound')),
  text text,
  intent text,
  raw jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.operator_messages ENABLE ROW LEVEL SECURITY;
CREATE POLICY "operators read operator_messages" ON public.operator_messages
  FOR SELECT TO authenticated USING (has_role(auth.uid(), 'operator'));
CREATE POLICY "no client write operator_messages" ON public.operator_messages
  FOR ALL TO authenticated USING (false) WITH CHECK (false);
CREATE INDEX idx_operator_messages_chat_id ON public.operator_messages(chat_id);
CREATE INDEX idx_operator_messages_created_at ON public.operator_messages(created_at DESC);

CREATE TABLE public.approval_queue (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  activity text NOT NULL,
  intent_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  risk text NOT NULL DEFAULT 'unknown' CHECK (risk IN ('safe','risky','unknown','blocker')),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected','expired','executed','failed')),
  telegram_message_id bigint,
  requested_by text,
  decided_by text,
  decided_at timestamptz,
  result jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.approval_queue ENABLE ROW LEVEL SECURITY;
CREATE POLICY "operators read approval_queue" ON public.approval_queue
  FOR SELECT TO authenticated USING (has_role(auth.uid(), 'operator'));
CREATE POLICY "operators update approval_queue" ON public.approval_queue
  FOR UPDATE TO authenticated USING (has_role(auth.uid(), 'operator')) WITH CHECK (has_role(auth.uid(), 'operator'));
CREATE INDEX idx_approval_queue_status ON public.approval_queue(status, created_at DESC);

CREATE TABLE public.rethink_tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  topic text NOT NULL,
  original_proposal jsonb NOT NULL DEFAULT '{}'::jsonb,
  reason text,
  temp_fix text,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','in_review','resolved')),
  created_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz
);
ALTER TABLE public.rethink_tasks ENABLE ROW LEVEL SECURITY;
CREATE POLICY "operators read rethink_tasks" ON public.rethink_tasks
  FOR SELECT TO authenticated USING (has_role(auth.uid(), 'operator'));
CREATE POLICY "operators write rethink_tasks" ON public.rethink_tasks
  FOR ALL TO authenticated USING (has_role(auth.uid(), 'operator')) WITH CHECK (has_role(auth.uid(), 'operator'));

CREATE TABLE public.activity_policies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  activity text NOT NULL UNIQUE,
  default_action text NOT NULL DEFAULT 'approve' CHECK (default_action IN ('auto','approve','block')),
  conditions jsonb NOT NULL DEFAULT '[]'::jsonb,
  notes text,
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.activity_policies ENABLE ROW LEVEL SECURITY;
CREATE POLICY "operators read activity_policies" ON public.activity_policies
  FOR SELECT TO authenticated USING (has_role(auth.uid(), 'operator'));
CREATE POLICY "operators write activity_policies" ON public.activity_policies
  FOR ALL TO authenticated USING (has_role(auth.uid(), 'operator')) WITH CHECK (has_role(auth.uid(), 'operator'));

CREATE TRIGGER update_activity_policies_updated_at
  BEFORE UPDATE ON public.activity_policies
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

INSERT INTO public.activity_policies (activity, default_action, notes) VALUES
  ('gmail.read', 'auto', 'Reading email summaries is safe'),
  ('gmail.draft', 'auto', 'Drafts are not sent'),
  ('gmail.send', 'approve', 'Always confirm before sending'),
  ('calendar.read', 'auto', 'Reading calendar is safe'),
  ('calendar.hold', 'auto', 'Holds on own calendar are reversible'),
  ('calendar.invite_external', 'approve', 'External invites need confirmation'),
  ('drive.read', 'auto', 'Reading files is safe'),
  ('drive.write', 'approve', 'Confirm before writing/modifying files'),
  ('awip.spawn_okr', 'approve', 'New OKRs need confirmation'),
  ('awip.supersede_okr', 'approve', 'Replacing an OKR needs confirmation');
