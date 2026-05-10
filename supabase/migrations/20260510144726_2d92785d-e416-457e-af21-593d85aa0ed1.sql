
-- A. Capability verify column
ALTER TABLE public.capabilities ADD COLUMN IF NOT EXISTS verify jsonb;
COMMENT ON COLUMN public.capabilities.verify IS
  'Optional self-test: { kind: http|sql|edge, target, method?, expect: { status?, json_has?, min_rows?, max_ms? }, auth?: service|none }';

-- B. walkthrough_runs
CREATE TABLE IF NOT EXISTS public.walkthrough_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  trigger text NOT NULL DEFAULT 'cron',
  status text NOT NULL DEFAULT 'running'
    CHECK (status IN ('running','ok','partial','failed','error')),
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  total int NOT NULL DEFAULT 0,
  passed int NOT NULL DEFAULT 0,
  failed int NOT NULL DEFAULT 0,
  skipped int NOT NULL DEFAULT 0,
  duration_ms int,
  summary jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_walkthrough_runs_started ON public.walkthrough_runs(started_at DESC);

ALTER TABLE public.walkthrough_runs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "operators read walkthrough_runs" ON public.walkthrough_runs;
CREATE POLICY "operators read walkthrough_runs" ON public.walkthrough_runs
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'operator') OR public.has_role(auth.uid(), 'admin'));
DROP POLICY IF EXISTS "no client write walkthrough_runs" ON public.walkthrough_runs;
CREATE POLICY "no client write walkthrough_runs" ON public.walkthrough_runs
  FOR ALL TO authenticated USING (false) WITH CHECK (false);

ALTER PUBLICATION supabase_realtime ADD TABLE public.walkthrough_runs;

-- C. walkthrough_checks
CREATE TABLE IF NOT EXISTS public.walkthrough_checks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid NOT NULL REFERENCES public.walkthrough_runs(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('http','sql','edge','route')),
  target text NOT NULL,
  capability_id text REFERENCES public.capabilities(id) ON DELETE SET NULL,
  status text NOT NULL CHECK (status IN ('pass','fail','skip','error')),
  latency_ms int,
  http_status int,
  error text,
  detail jsonb NOT NULL DEFAULT '{}'::jsonb,
  severity text NOT NULL DEFAULT 'medium'
    CHECK (severity IN ('info','low','medium','high','critical')),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_walkthrough_checks_run ON public.walkthrough_checks(run_id);
CREATE INDEX IF NOT EXISTS idx_walkthrough_checks_status ON public.walkthrough_checks(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_walkthrough_checks_target ON public.walkthrough_checks(target);

ALTER TABLE public.walkthrough_checks ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "operators read walkthrough_checks" ON public.walkthrough_checks;
CREATE POLICY "operators read walkthrough_checks" ON public.walkthrough_checks
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'operator') OR public.has_role(auth.uid(), 'admin'));
DROP POLICY IF EXISTS "no client write walkthrough_checks" ON public.walkthrough_checks;
CREATE POLICY "no client write walkthrough_checks" ON public.walkthrough_checks
  FOR ALL TO authenticated USING (false) WITH CHECK (false);

ALTER PUBLICATION supabase_realtime ADD TABLE public.walkthrough_checks;

-- D. Safe SQL check helper (whitelisted SELECT only)
CREATE OR REPLACE FUNCTION public.run_capability_sql_check(_sql text, _min_rows int DEFAULT 0)
RETURNS TABLE(row_count bigint, ok boolean)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  trimmed text;
  cnt bigint;
BEGIN
  trimmed := btrim(_sql);
  -- Only allow a single SELECT statement; reject anything containing semicolons (other than trailing) or DDL/DML keywords.
  IF trimmed !~* '^select\s' THEN
    RAISE EXCEPTION 'only SELECT statements are allowed';
  END IF;
  IF trimmed ~* '\b(insert|update|delete|drop|alter|truncate|grant|revoke|create|copy|call|do|comment|vacuum|analyze|reindex)\b' THEN
    RAISE EXCEPTION 'disallowed keyword in check sql';
  END IF;
  -- Strip a single trailing semicolon if present, then forbid any remaining ones.
  trimmed := regexp_replace(trimmed, ';\s*$', '');
  IF position(';' in trimmed) > 0 THEN
    RAISE EXCEPTION 'multiple statements not allowed';
  END IF;

  SET LOCAL statement_timeout = '5s';
  EXECUTE 'SELECT count(*) FROM (' || trimmed || ') _sub' INTO cnt;
  row_count := cnt;
  ok := cnt >= _min_rows;
  RETURN NEXT;
END;
$$;

REVOKE ALL ON FUNCTION public.run_capability_sql_check(text, int) FROM public;
GRANT EXECUTE ON FUNCTION public.run_capability_sql_check(text, int) TO service_role;
