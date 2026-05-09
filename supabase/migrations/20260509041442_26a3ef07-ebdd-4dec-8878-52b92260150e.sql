-- Per-phase "queue every night" flag
ALTER TABLE public.roadmap_phases
  ADD COLUMN IF NOT EXISTS run_overnight boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS run_overnight_until date;

-- Auto-clear the flag once the phase is shipped/done/cancelled so we don't keep queuing
CREATE OR REPLACE FUNCTION public.clear_run_overnight_on_terminal_status()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.status::text IN ('shipped','done','cancelled') AND OLD.run_overnight = true THEN
    NEW.run_overnight := false;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS clear_run_overnight_on_terminal ON public.roadmap_phases;
CREATE TRIGGER clear_run_overnight_on_terminal
  BEFORE UPDATE OF status ON public.roadmap_phases
  FOR EACH ROW EXECUTE FUNCTION public.clear_run_overnight_on_terminal_status();