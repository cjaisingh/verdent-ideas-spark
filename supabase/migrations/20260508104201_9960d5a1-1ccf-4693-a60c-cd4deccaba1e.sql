
-- night_shifts
CREATE TABLE public.night_shifts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  started_at timestamptz NOT NULL DEFAULT now(),
  ended_at timestamptz,
  window_start timestamptz NOT NULL,
  window_end timestamptz NOT NULL,
  commit_sha text,
  status text NOT NULL DEFAULT 'running',
  summary jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.night_shifts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "operators read night_shifts" ON public.night_shifts FOR SELECT TO authenticated USING (has_role(auth.uid(),'operator'));
CREATE POLICY "operators delete night_shifts" ON public.night_shifts FOR DELETE TO authenticated USING (has_role(auth.uid(),'operator'));
CREATE POLICY "no client write night_shifts" ON public.night_shifts FOR INSERT TO authenticated WITH CHECK (false);
CREATE POLICY "no client update night_shifts" ON public.night_shifts FOR UPDATE TO authenticated USING (false) WITH CHECK (false);

-- night_observations
CREATE TABLE public.night_observations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shift_id uuid NOT NULL REFERENCES public.night_shifts(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('job_review','code_review','qa','tests','error')),
  severity text NOT NULL DEFAULT 'info',
  subject_ref jsonb NOT NULL DEFAULT '{}'::jsonb,
  summary text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX night_observations_shift_idx ON public.night_observations(shift_id);
ALTER TABLE public.night_observations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "operators read night_observations" ON public.night_observations FOR SELECT TO authenticated USING (has_role(auth.uid(),'operator'));
CREATE POLICY "no client write night_observations" ON public.night_observations FOR ALL TO authenticated USING (false) WITH CHECK (false);

-- night_proposals
CREATE TABLE public.night_proposals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shift_id uuid NOT NULL REFERENCES public.night_shifts(id) ON DELETE CASCADE,
  source_observation_id uuid REFERENCES public.night_observations(id) ON DELETE SET NULL,
  kind text NOT NULL CHECK (kind IN ('promote_job','file_finding')),
  target_ref jsonb NOT NULL DEFAULT '{}'::jsonb,
  rationale text,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','accepted','rejected')),
  decided_by uuid,
  decided_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX night_proposals_shift_idx ON public.night_proposals(shift_id);
CREATE INDEX night_proposals_status_idx ON public.night_proposals(status);
ALTER TABLE public.night_proposals ENABLE ROW LEVEL SECURITY;
CREATE POLICY "operators read night_proposals" ON public.night_proposals FOR SELECT TO authenticated USING (has_role(auth.uid(),'operator'));
CREATE POLICY "operators update night_proposals" ON public.night_proposals FOR UPDATE TO authenticated USING (has_role(auth.uid(),'operator')) WITH CHECK (has_role(auth.uid(),'operator'));
CREATE POLICY "no client insert night_proposals" ON public.night_proposals FOR INSERT TO authenticated WITH CHECK (false);

-- realtime
ALTER PUBLICATION supabase_realtime ADD TABLE public.night_shifts;
ALTER PUBLICATION supabase_realtime ADD TABLE public.night_observations;
ALTER PUBLICATION supabase_realtime ADD TABLE public.night_proposals;

-- enable flag on memory_settings
ALTER TABLE public.memory_settings ADD COLUMN IF NOT EXISTS night_agent_enabled boolean NOT NULL DEFAULT true;
