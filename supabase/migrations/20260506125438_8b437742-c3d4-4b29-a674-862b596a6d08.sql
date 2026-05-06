CREATE TABLE public.telegram_gateway_logs (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now(),
  endpoint text NOT NULL,
  attempt integer NOT NULL DEFAULT 1,
  status_code integer,
  latency_ms integer,
  ok boolean NOT NULL DEFAULT false,
  error text,
  detail jsonb
);

CREATE INDEX idx_telegram_gateway_logs_created_at
  ON public.telegram_gateway_logs (created_at DESC);

ALTER TABLE public.telegram_gateway_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "operators read telegram_gateway_logs"
  ON public.telegram_gateway_logs
  FOR SELECT
  TO authenticated
  USING (has_role(auth.uid(), 'operator'::app_role));

CREATE POLICY "no client write telegram_gateway_logs"
  ON public.telegram_gateway_logs
  FOR ALL
  TO authenticated
  USING (false)
  WITH CHECK (false);
