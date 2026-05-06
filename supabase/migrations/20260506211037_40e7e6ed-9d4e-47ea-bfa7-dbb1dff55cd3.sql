
CREATE TABLE IF NOT EXISTS public.retention_settings (
  table_name text PRIMARY KEY,
  retention_days integer NOT NULL DEFAULT 0,
  description text,
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.retention_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "operators read retention_settings" ON public.retention_settings
  FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'operator'));
CREATE POLICY "operators write retention_settings" ON public.retention_settings
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'operator'))
  WITH CHECK (public.has_role(auth.uid(), 'operator'));

INSERT INTO public.retention_settings (table_name, retention_days, description) VALUES
  ('api_call_logs',          90,  'Every contract API call'),
  ('alert_log',              60,  'Webhook alert dispatch attempts'),
  ('automation_runs',        90,  'Cron / automation invocations'),
  ('telegram_gateway_logs',  30,  'Telegram outbound gateway log'),
  ('operator_messages',      365, 'Operator chat messages'),
  ('okr_node_events',        0,   'OKR mutations (audit; default keep forever)'),
  ('capability_events',      0,   'Capability manifest changes (audit; default keep forever)'),
  ('roadmap_autolog_skips',  30,  'Suppressed auto-log entries'),
  ('roadmap_task_activity',  365, 'Task field-change history'),
  ('roadmap_work_log',       365, 'AI / human turn log')
ON CONFLICT (table_name) DO NOTHING;

CREATE OR REPLACE FUNCTION public.retention_stats()
RETURNS TABLE(table_name text, retention_days integer, row_count bigint, oldest timestamptz)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r record;
  cnt bigint;
  oldest_ts timestamptz;
BEGIN
  IF NOT public.has_role(auth.uid(), 'operator') THEN
    RAISE EXCEPTION 'not authorized';
  END IF;
  FOR r IN SELECT rs.table_name, rs.retention_days FROM public.retention_settings rs ORDER BY rs.table_name LOOP
    EXECUTE format('SELECT count(*), min(created_at) FROM public.%I', r.table_name)
      INTO cnt, oldest_ts;
    table_name := r.table_name;
    retention_days := r.retention_days;
    row_count := cnt;
    oldest := oldest_ts;
    RETURN NEXT;
  END LOOP;
END;
$$;

CREATE OR REPLACE FUNCTION public.purge_expired_rows(_table text DEFAULT NULL)
RETURNS TABLE(table_name text, deleted bigint)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r record;
  del bigint;
BEGIN
  IF NOT public.has_role(auth.uid(), 'operator') THEN
    RAISE EXCEPTION 'not authorized';
  END IF;
  FOR r IN
    SELECT rs.table_name, rs.retention_days
    FROM public.retention_settings rs
    WHERE rs.retention_days > 0
      AND (_table IS NULL OR rs.table_name = _table)
  LOOP
    EXECUTE format(
      'WITH d AS (DELETE FROM public.%I WHERE created_at < now() - ($1 || '' days'')::interval RETURNING 1) SELECT count(*) FROM d',
      r.table_name
    ) INTO del USING r.retention_days;
    table_name := r.table_name;
    deleted := del;
    RETURN NEXT;
  END LOOP;
END;
$$;
