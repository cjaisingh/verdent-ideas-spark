CREATE TABLE public.api_call_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  route text NOT NULL,
  method text NOT NULL,
  actor text,
  idempotency_key text,
  idempotent_replay boolean NOT NULL DEFAULT false,
  status_code integer NOT NULL,
  duration_ms integer,
  tenant_id uuid,
  request_summary jsonb NOT NULL DEFAULT '{}'::jsonb,
  response_summary jsonb NOT NULL DEFAULT '{}'::jsonb,
  error text
);

CREATE INDEX idx_api_call_logs_created_at ON public.api_call_logs (created_at DESC);
CREATE INDEX idx_api_call_logs_route ON public.api_call_logs (route);
CREATE INDEX idx_api_call_logs_idem ON public.api_call_logs (idempotency_key);

ALTER TABLE public.api_call_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "operators read api_call_logs"
ON public.api_call_logs
FOR SELECT
TO authenticated
USING (has_role(auth.uid(), 'operator'::app_role));

CREATE POLICY "no client write api_call_logs"
ON public.api_call_logs
FOR ALL
TO authenticated
USING (false)
WITH CHECK (false);