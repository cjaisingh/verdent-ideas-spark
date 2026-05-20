
-- 1) Mappings table (job pattern → module)
CREATE TABLE IF NOT EXISTS public.ai_module_mappings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pattern text NOT NULL,
  module text NOT NULL,
  priority int NOT NULL DEFAULT 100,
  enabled boolean NOT NULL DEFAULT true,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_ai_module_mappings_enabled_priority
  ON public.ai_module_mappings(enabled, priority DESC);

ALTER TABLE public.ai_module_mappings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "operators read ai_module_mappings" ON public.ai_module_mappings;
CREATE POLICY "operators read ai_module_mappings"
  ON public.ai_module_mappings FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(),'operator') OR public.has_role(auth.uid(),'admin'));

DROP POLICY IF EXISTS "operators write ai_module_mappings" ON public.ai_module_mappings;
CREATE POLICY "operators write ai_module_mappings"
  ON public.ai_module_mappings FOR ALL
  TO authenticated
  USING (public.has_role(auth.uid(),'operator') OR public.has_role(auth.uid(),'admin'))
  WITH CHECK (public.has_role(auth.uid(),'operator') OR public.has_role(auth.uid(),'admin'));

DROP TRIGGER IF EXISTS trg_ai_module_mappings_updated ON public.ai_module_mappings;
CREATE TRIGGER trg_ai_module_mappings_updated
BEFORE UPDATE ON public.ai_module_mappings
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 2) Pins (module → task for a date window)
CREATE TABLE IF NOT EXISTS public.ai_module_task_pins (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  module text NOT NULL,
  task_id uuid NOT NULL REFERENCES public.roadmap_tasks(id) ON DELETE CASCADE,
  effective_from timestamptz NOT NULL,
  effective_to timestamptz,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (effective_to IS NULL OR effective_to > effective_from)
);
CREATE INDEX IF NOT EXISTS idx_ai_module_task_pins_module_window
  ON public.ai_module_task_pins(module, effective_from DESC);

ALTER TABLE public.ai_module_task_pins ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "operators read ai_module_task_pins" ON public.ai_module_task_pins;
CREATE POLICY "operators read ai_module_task_pins"
  ON public.ai_module_task_pins FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(),'operator') OR public.has_role(auth.uid(),'admin'));

DROP POLICY IF EXISTS "operators write ai_module_task_pins" ON public.ai_module_task_pins;
CREATE POLICY "operators write ai_module_task_pins"
  ON public.ai_module_task_pins FOR ALL
  TO authenticated
  USING (public.has_role(auth.uid(),'operator') OR public.has_role(auth.uid(),'admin'))
  WITH CHECK (public.has_role(auth.uid(),'operator') OR public.has_role(auth.uid(),'admin'));

DROP TRIGGER IF EXISTS trg_ai_module_task_pins_updated ON public.ai_module_task_pins;
CREATE TRIGGER trg_ai_module_task_pins_updated
BEFORE UPDATE ON public.ai_module_task_pins
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 3) Seed with the existing hardcoded mappings (idempotent on pattern+module)
INSERT INTO public.ai_module_mappings (pattern, module, priority, notes) VALUES
  ('whats-new%',       'whats-new',       100, 'seeded from infer_ai_job_module v1'),
  ('companion%',       'companion',       100, 'seeded from infer_ai_job_module v1'),
  ('gemini-tts%',      'voice',           100, 'seeded from infer_ai_job_module v1'),
  ('morning-review%',  'morning-review',  100, 'seeded from infer_ai_job_module v1'),
  ('daily-plan%',      'tomorrow-plan',   100, 'seeded from infer_ai_job_module v1'),
  ('tomorrow-plan%',   'tomorrow-plan',   100, 'seeded from infer_ai_job_module v1'),
  ('lessons%',         'lessons',         100, 'seeded from infer_ai_job_module v1'),
  ('awip-reviews%',    'awip-reviews',    100, 'seeded from infer_ai_job_module v1'),
  ('night-agent%',     'night-agent',     100, 'seeded from infer_ai_job_module v1'),
  ('overnight%',       'night-agent',     100, 'seeded from infer_ai_job_module v1'),
  ('sentinel%',        'sentinel',        100, 'seeded from infer_ai_job_module v1'),
  ('route-operator%',  'operator-inbox',  100, 'seeded from infer_ai_job_module v1'),
  ('operator-inbox%',  'operator-inbox',  100, 'seeded from infer_ai_job_module v1'),
  ('deep-audit%',      'deep-audit',      100, 'seeded from infer_ai_job_module v1'),
  ('qa-%',             'qa',              100, 'seeded from infer_ai_job_module v1'),
  ('heygen%',          'heygen-videos',   100, 'seeded from infer_ai_job_module v1'),
  ('telegram%',        'telegram',        100, 'seeded from infer_ai_job_module v1')
ON CONFLICT DO NOTHING;

-- 4) Rewrite infer_ai_job_module to read from the table
CREATE OR REPLACE FUNCTION public.infer_ai_job_module(_job text)
RETURNS text
LANGUAGE sql STABLE
SET search_path = public
AS $$
  SELECT module
    FROM public.ai_module_mappings
   WHERE enabled = true
     AND _job ILIKE pattern
   ORDER BY priority DESC, length(pattern) DESC
   LIMIT 1
$$;

-- 5) Extend backfill to honour pins first, then heuristic
CREATE OR REPLACE FUNCTION public.backfill_ai_usage_attribution()
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  m_updated int := 0;
  p_updated int := 0;
  t_updated int := 0;
BEGIN
  IF NOT (public.has_role(auth.uid(),'operator') OR public.has_role(auth.uid(),'admin') OR auth.uid() IS NULL) THEN
    RAISE EXCEPTION 'not authorized';
  END IF;

  -- module from job pattern
  UPDATE public.ai_usage_log
     SET module = public.infer_ai_job_module(job)
   WHERE module IS NULL
     AND public.infer_ai_job_module(job) IS NOT NULL;
  GET DIAGNOSTICS m_updated = ROW_COUNT;

  -- pinned task wins
  WITH cand AS (
    SELECT l.id AS log_id,
           (SELECT p.task_id
              FROM public.ai_module_task_pins p
             WHERE p.module = l.module
               AND p.effective_from <= l.created_at
               AND (p.effective_to IS NULL OR p.effective_to > l.created_at)
             ORDER BY p.effective_from DESC
             LIMIT 1) AS pinned_task
      FROM public.ai_usage_log l
     WHERE l.task_id IS NULL AND l.module IS NOT NULL
  )
  UPDATE public.ai_usage_log l
     SET task_id = c.pinned_task
    FROM cand c
   WHERE l.id = c.log_id AND c.pinned_task IS NOT NULL;
  GET DIAGNOSTICS p_updated = ROW_COUNT;

  -- heuristic fallback: most-recent task in same module updated ≤ log time
  WITH cand AS (
    SELECT l.id AS log_id,
           (SELECT t.id FROM public.roadmap_tasks t
             WHERE t.module = l.module
               AND t.status::text NOT IN ('cancelled')
               AND t.updated_at <= l.created_at
             ORDER BY t.updated_at DESC
             LIMIT 1) AS picked_task
      FROM public.ai_usage_log l
     WHERE l.task_id IS NULL AND l.module IS NOT NULL
  )
  UPDATE public.ai_usage_log l
     SET task_id = c.picked_task
    FROM cand c
   WHERE l.id = c.log_id AND c.picked_task IS NOT NULL;
  GET DIAGNOSTICS t_updated = ROW_COUNT;

  RETURN jsonb_build_object(
    'module_backfilled',       m_updated,
    'task_id_backfilled_pin',  p_updated,
    'task_id_backfilled_heur', t_updated
  );
END $$;

GRANT EXECUTE ON FUNCTION public.backfill_ai_usage_attribution() TO authenticated;
