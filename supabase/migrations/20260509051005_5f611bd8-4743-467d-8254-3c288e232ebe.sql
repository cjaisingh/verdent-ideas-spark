
-- WS4 Logger foundation: edge request logs + frontend error logs
CREATE TABLE IF NOT EXISTS public.edge_request_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id text NOT NULL,
  function_name text NOT NULL,
  method text,
  path text,
  status int,
  latency_ms int,
  user_id_hash text,
  classified_error text,
  error_message text,
  meta jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_edge_request_logs_created_at ON public.edge_request_logs (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_edge_request_logs_function ON public.edge_request_logs (function_name, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_edge_request_logs_status ON public.edge_request_logs (status) WHERE status >= 400;
CREATE INDEX IF NOT EXISTS idx_edge_request_logs_request_id ON public.edge_request_logs (request_id);

ALTER TABLE public.edge_request_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "operators read edge logs"
  ON public.edge_request_logs FOR SELECT
  USING (public.has_role(auth.uid(), 'operator') OR public.has_role(auth.uid(), 'admin'));

-- No INSERT policy: edge functions write via service role.

CREATE TABLE IF NOT EXISTS public.frontend_error_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id text,
  user_id_hash text,
  url text,
  user_agent text,
  message text NOT NULL,
  stack text,
  source text,
  lineno int,
  colno int,
  kind text NOT NULL DEFAULT 'error',
  meta jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_frontend_error_logs_created_at ON public.frontend_error_logs (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_frontend_error_logs_kind ON public.frontend_error_logs (kind, created_at DESC);

ALTER TABLE public.frontend_error_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "operators read frontend errors"
  ON public.frontend_error_logs FOR SELECT
  USING (public.has_role(auth.uid(), 'operator') OR public.has_role(auth.uid(), 'admin'));

-- Anyone (anon + authed) can submit frontend errors. Edge function strips auth-sensitive bits before insert.
CREATE POLICY "anyone may submit frontend errors"
  ON public.frontend_error_logs FOR INSERT
  WITH CHECK (true);

-- Realtime
ALTER PUBLICATION supabase_realtime ADD TABLE public.edge_request_logs;
ALTER PUBLICATION supabase_realtime ADD TABLE public.frontend_error_logs;

-- Retention (30 days), reuse existing auto_purge_if_enabled cron
INSERT INTO public.retention_settings (table_name, retention_days, description)
  VALUES ('edge_request_logs', 30, 'Structured edge function request logs')
  ON CONFLICT (table_name) DO NOTHING;
INSERT INTO public.retention_settings (table_name, retention_days, description)
  VALUES ('frontend_error_logs', 30, 'Browser-side errors captured by the app error boundary')
  ON CONFLICT (table_name) DO NOTHING;
