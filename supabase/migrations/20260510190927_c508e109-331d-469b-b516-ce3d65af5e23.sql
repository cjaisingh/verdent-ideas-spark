
-- ============================================================
-- PR-1 · Daily analytics rollups
-- ============================================================

CREATE TABLE public.analytics_daily_ai_usage (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  rollup_date DATE NOT NULL,
  job TEXT NOT NULL,
  model TEXT NOT NULL,
  calls INTEGER NOT NULL DEFAULT 0,
  errors INTEGER NOT NULL DEFAULT 0,
  cost_usd NUMERIC NOT NULL DEFAULT 0,
  prompt_tokens BIGINT NOT NULL DEFAULT 0,
  completion_tokens BIGINT NOT NULL DEFAULT 0,
  p50_latency_ms INTEGER,
  p95_latency_ms INTEGER,
  computed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (rollup_date, job, model)
);
ALTER TABLE public.analytics_daily_ai_usage ENABLE ROW LEVEL SECURITY;
CREATE POLICY "operators read analytics_daily_ai_usage" ON public.analytics_daily_ai_usage
  FOR SELECT TO authenticated USING (has_role(auth.uid(), 'operator'::app_role) OR has_role(auth.uid(), 'admin'::app_role));
CREATE POLICY "no client write analytics_daily_ai_usage" ON public.analytics_daily_ai_usage
  FOR ALL TO authenticated USING (false) WITH CHECK (false);
CREATE INDEX idx_analytics_daily_ai_usage_date ON public.analytics_daily_ai_usage (rollup_date DESC);
ALTER PUBLICATION supabase_realtime ADD TABLE public.analytics_daily_ai_usage;

CREATE TABLE public.analytics_daily_automation (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  rollup_date DATE NOT NULL,
  job TEXT NOT NULL,
  runs INTEGER NOT NULL DEFAULT 0,
  errors INTEGER NOT NULL DEFAULT 0,
  error_rate NUMERIC NOT NULL DEFAULT 0,
  avg_duration_ms INTEGER,
  p95_duration_ms INTEGER,
  computed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (rollup_date, job)
);
ALTER TABLE public.analytics_daily_automation ENABLE ROW LEVEL SECURITY;
CREATE POLICY "operators read analytics_daily_automation" ON public.analytics_daily_automation
  FOR SELECT TO authenticated USING (has_role(auth.uid(), 'operator'::app_role) OR has_role(auth.uid(), 'admin'::app_role));
CREATE POLICY "no client write analytics_daily_automation" ON public.analytics_daily_automation
  FOR ALL TO authenticated USING (false) WITH CHECK (false);
CREATE INDEX idx_analytics_daily_automation_date ON public.analytics_daily_automation (rollup_date DESC);
ALTER PUBLICATION supabase_realtime ADD TABLE public.analytics_daily_automation;

CREATE TABLE public.analytics_daily_cost (
  rollup_date DATE PRIMARY KEY,
  ai_cost_usd NUMERIC NOT NULL DEFAULT 0,
  ai_calls INTEGER NOT NULL DEFAULT 0,
  ai_errors INTEGER NOT NULL DEFAULT 0,
  top_job TEXT,
  top_job_cost_usd NUMERIC,
  computed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.analytics_daily_cost ENABLE ROW LEVEL SECURITY;
CREATE POLICY "operators read analytics_daily_cost" ON public.analytics_daily_cost
  FOR SELECT TO authenticated USING (has_role(auth.uid(), 'operator'::app_role) OR has_role(auth.uid(), 'admin'::app_role));
CREATE POLICY "no client write analytics_daily_cost" ON public.analytics_daily_cost
  FOR ALL TO authenticated USING (false) WITH CHECK (false);
ALTER PUBLICATION supabase_realtime ADD TABLE public.analytics_daily_cost;

-- ============================================================
-- PR-2 · Daily snapshots
-- ============================================================

CREATE TABLE public.daily_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  snapshot_date DATE NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('system','contract')),
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  summary TEXT,
  ai_brief TEXT,
  ai_model TEXT,
  ai_cost_usd NUMERIC,
  generated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (snapshot_date, kind)
);
ALTER TABLE public.daily_snapshots ENABLE ROW LEVEL SECURITY;
CREATE POLICY "operators read daily_snapshots" ON public.daily_snapshots
  FOR SELECT TO authenticated USING (has_role(auth.uid(), 'operator'::app_role) OR has_role(auth.uid(), 'admin'::app_role));
CREATE POLICY "no client write daily_snapshots" ON public.daily_snapshots
  FOR ALL TO authenticated USING (false) WITH CHECK (false);
CREATE INDEX idx_daily_snapshots_date ON public.daily_snapshots (snapshot_date DESC, kind);
ALTER PUBLICATION supabase_realtime ADD TABLE public.daily_snapshots;

-- ============================================================
-- PR-3 · Ingestion framework
-- ============================================================

CREATE TABLE public.ingestion_sources (
  source_key TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  config JSONB NOT NULL DEFAULT '{}'::jsonb,
  enabled BOOLEAN NOT NULL DEFAULT true,
  description TEXT,
  last_run_at TIMESTAMPTZ,
  last_status TEXT,
  last_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.ingestion_sources ENABLE ROW LEVEL SECURITY;
CREATE POLICY "operators read ingestion_sources" ON public.ingestion_sources
  FOR SELECT TO authenticated USING (has_role(auth.uid(), 'operator'::app_role) OR has_role(auth.uid(), 'admin'::app_role));
CREATE POLICY "admins write ingestion_sources" ON public.ingestion_sources
  FOR ALL TO authenticated USING (has_role(auth.uid(), 'admin'::app_role)) WITH CHECK (has_role(auth.uid(), 'admin'::app_role));
ALTER PUBLICATION supabase_realtime ADD TABLE public.ingestion_sources;

CREATE TRIGGER trg_ingestion_sources_updated_at BEFORE UPDATE ON public.ingestion_sources
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TABLE public.ingestion_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_key TEXT NOT NULL,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'running' CHECK (status IN ('running','ok','error','skipped')),
  rows_in INTEGER NOT NULL DEFAULT 0,
  rows_upserted INTEGER NOT NULL DEFAULT 0,
  rows_failed INTEGER NOT NULL DEFAULT 0,
  duration_ms INTEGER,
  trigger TEXT NOT NULL DEFAULT 'cron',
  idempotency_key TEXT,
  error TEXT,
  detail JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (source_key, idempotency_key)
);
ALTER TABLE public.ingestion_runs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "operators read ingestion_runs" ON public.ingestion_runs
  FOR SELECT TO authenticated USING (has_role(auth.uid(), 'operator'::app_role) OR has_role(auth.uid(), 'admin'::app_role));
CREATE POLICY "no client write ingestion_runs" ON public.ingestion_runs
  FOR ALL TO authenticated USING (false) WITH CHECK (false);
CREATE INDEX idx_ingestion_runs_source_started ON public.ingestion_runs (source_key, started_at DESC);
ALTER PUBLICATION supabase_realtime ADD TABLE public.ingestion_runs;

-- Seed the one bundled source
INSERT INTO public.ingestion_sources (source_key, kind, enabled, description, config)
  VALUES ('awip_docs_refresh', 'awip_docs_refresh', true,
          'Re-index docs/ markdown into awip_docs / awip_doc_chunks for RAG.',
          '{}'::jsonb)
  ON CONFLICT (source_key) DO NOTHING;

-- ============================================================
-- PR-4 · Cache warm
-- ============================================================

CREATE TABLE public.cache_warm_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  route TEXT NOT NULL,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  duration_ms INTEGER,
  ok BOOLEAN NOT NULL DEFAULT true,
  error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.cache_warm_runs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "operators read cache_warm_runs" ON public.cache_warm_runs
  FOR SELECT TO authenticated USING (has_role(auth.uid(), 'operator'::app_role) OR has_role(auth.uid(), 'admin'::app_role));
CREATE POLICY "no client write cache_warm_runs" ON public.cache_warm_runs
  FOR ALL TO authenticated USING (false) WITH CHECK (false);
CREATE INDEX idx_cache_warm_runs_started ON public.cache_warm_runs (started_at DESC);
ALTER PUBLICATION supabase_realtime ADD TABLE public.cache_warm_runs;

-- ============================================================
-- Retention
-- ============================================================

INSERT INTO public.retention_settings (table_name, retention_days, description) VALUES
  ('analytics_daily_ai_usage', 365, 'Daily AI usage rollup — kept 1 year for YoY comparison.'),
  ('analytics_daily_automation', 365, 'Daily automation rollup — kept 1 year.'),
  ('analytics_daily_cost', 365, 'Daily cost summary — kept 1 year.'),
  ('cache_warm_runs', 30, 'Cache-warm log — short-lived diagnostic.'),
  ('ingestion_runs', 365, 'Per-source ingest history — kept 1 year.')
ON CONFLICT (table_name) DO NOTHING;

-- ============================================================
-- Helper RPC: list every nightly job in one place for /admin/night-shift
-- ============================================================

CREATE OR REPLACE FUNCTION public.list_all_nightly_jobs()
RETURNS TABLE(
  jobid bigint,
  jobname text,
  schedule text,
  active boolean,
  category text,
  last_status text,
  last_start timestamptz,
  last_end timestamptz
)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = 'public', 'cron'
AS $$
BEGIN
  IF NOT (public.has_role(auth.uid(), 'operator') OR public.has_role(auth.uid(), 'admin')) THEN
    RAISE EXCEPTION 'not authorized';
  END IF;
  RETURN QUERY
  SELECT j.jobid, j.jobname::text, j.schedule::text, j.active,
         CASE
           WHEN j.jobname LIKE '%audit%' OR j.jobname LIKE '%review%' OR j.jobname = 'scheduled-app-walkthrough' THEN 'audit'
           WHEN j.jobname LIKE '%ingest%' OR j.jobname LIKE '%awip-reviews%' THEN 'ingest'
           WHEN j.jobname LIKE '%rollup%' OR j.jobname LIKE '%snapshot%' THEN 'rollup'
           WHEN j.jobname LIKE '%cache%' THEN 'cache'
           WHEN j.jobname LIKE '%night-agent%' OR j.jobname LIKE '%overnight%' THEN 'night-agent'
           WHEN j.jobname LIKE '%retention%' OR j.jobname LIKE '%lessons%' THEN 'hygiene'
           WHEN j.jobname LIKE '%sentinel%' OR j.jobname = 'scheduled-morning-review' THEN 'monitor'
           ELSE 'other'
         END AS category,
         d.status::text, d.start_time, d.end_time
  FROM cron.job j
  LEFT JOIN LATERAL (
    SELECT status, start_time, end_time
    FROM cron.job_run_details r
    WHERE r.jobid = j.jobid
    ORDER BY r.start_time DESC NULLS LAST
    LIMIT 1
  ) d ON true
  WHERE j.jobname LIKE 'scheduled-%'
     OR j.jobname IN ('night-agent-open','night-agent-close','overnight-phase-runner-15m','overnight-prequeue','retention-sweep-daily','nightly-rollup-analytics','snapshot-daily-report','ingest-external-data','cache-warm')
  ORDER BY j.schedule, j.jobname;
END;
$$;
