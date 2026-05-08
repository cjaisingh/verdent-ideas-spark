ALTER TABLE public.roadmap_phases
  ADD COLUMN manual_override_rationale text,
  ADD COLUMN manual_override_by text,
  ADD COLUMN manual_override_at timestamptz;

ALTER TABLE public.roadmap_phase_signoffs
  ADD COLUMN override_rationale text;