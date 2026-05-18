ALTER TABLE public.roadmap_phase_overnight_runs ALTER COLUMN requested_by DROP NOT NULL;

UPDATE public.roadmap_phases SET run_overnight = true WHERE key = 'phase-5' AND run_overnight IS DISTINCT FROM true;