CREATE TABLE public.roadmap_phase_signoffs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  phase_id uuid NOT NULL REFERENCES public.roadmap_phases(id) ON DELETE CASCADE,
  phase_key text NOT NULL,
  approval_id uuid,
  approver text,
  approver_user_id uuid,
  decided_at timestamptz NOT NULL DEFAULT now(),
  gate_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_phase_signoffs_phase ON public.roadmap_phase_signoffs(phase_id, decided_at DESC);
CREATE INDEX idx_phase_signoffs_decided ON public.roadmap_phase_signoffs(decided_at DESC);

ALTER TABLE public.roadmap_phase_signoffs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "operators read phase_signoffs"
  ON public.roadmap_phase_signoffs FOR SELECT
  TO authenticated
  USING (has_role(auth.uid(), 'operator'::app_role));

CREATE POLICY "no client write phase_signoffs"
  ON public.roadmap_phase_signoffs FOR ALL
  TO authenticated
  USING (false) WITH CHECK (false);

ALTER PUBLICATION supabase_realtime ADD TABLE public.roadmap_phase_signoffs;