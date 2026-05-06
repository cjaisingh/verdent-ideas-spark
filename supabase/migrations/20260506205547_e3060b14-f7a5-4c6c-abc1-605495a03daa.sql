
-- Alerts: configurable webhook for failure notifications + dedupe log
CREATE TABLE public.alert_settings (
  id boolean PRIMARY KEY DEFAULT true CHECK (id = true),
  webhook_url text,
  enabled boolean NOT NULL DEFAULT true,
  alert_on_review_error boolean NOT NULL DEFAULT true,
  alert_on_high_finding boolean NOT NULL DEFAULT true,
  alert_on_test_fail boolean NOT NULL DEFAULT true,
  alert_on_qa_fail boolean NOT NULL DEFAULT true,
  dedupe_minutes integer NOT NULL DEFAULT 60,
  updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO public.alert_settings (id) VALUES (true);

ALTER TABLE public.alert_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "operators read alert_settings" ON public.alert_settings
  FOR SELECT TO authenticated USING (has_role(auth.uid(), 'operator'::app_role));

CREATE POLICY "operators write alert_settings" ON public.alert_settings
  FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'operator'::app_role))
  WITH CHECK (has_role(auth.uid(), 'operator'::app_role));

CREATE TABLE public.alert_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  job text NOT NULL,
  reason text NOT NULL,
  message text,
  delivered boolean NOT NULL DEFAULT false,
  status_code integer,
  error text,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX alert_log_job_created_idx ON public.alert_log (job, created_at DESC);

ALTER TABLE public.alert_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "operators read alert_log" ON public.alert_log
  FOR SELECT TO authenticated USING (has_role(auth.uid(), 'operator'::app_role));

CREATE POLICY "no client write alert_log" ON public.alert_log
  FOR ALL TO authenticated USING (false) WITH CHECK (false);
