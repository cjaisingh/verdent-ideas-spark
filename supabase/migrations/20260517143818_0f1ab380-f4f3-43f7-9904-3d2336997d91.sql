CREATE TABLE public.credit_alerts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  year_month text NOT NULL,
  threshold_pct int NOT NULL CHECK (threshold_pct IN (80, 100)),
  projected_pct numeric(6,2) NOT NULL,
  burn_per_day numeric(10,2) NOT NULL,
  budget int NOT NULL,
  fired_at timestamptz NOT NULL DEFAULT now(),
  acknowledged_at timestamptz,
  sentinel_finding_id uuid,
  telegram_message_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (year_month, threshold_pct)
);

ALTER TABLE public.credit_alerts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "operators read credit_alerts" ON public.credit_alerts
  FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'operator'));
CREATE POLICY "operators insert credit_alerts" ON public.credit_alerts
  FOR INSERT TO authenticated WITH CHECK (public.has_role(auth.uid(), 'operator'));
CREATE POLICY "operators update credit_alerts" ON public.credit_alerts
  FOR UPDATE TO authenticated USING (public.has_role(auth.uid(), 'operator'));
CREATE POLICY "operators delete credit_alerts" ON public.credit_alerts
  FOR DELETE TO authenticated USING (public.has_role(auth.uid(), 'operator'));

ALTER PUBLICATION supabase_realtime ADD TABLE public.credit_alerts;
ALTER TABLE public.credit_alerts REPLICA IDENTITY FULL;

ALTER TABLE public.credit_settings
  ADD COLUMN IF NOT EXISTS operator_telegram_chat_id text,
  ADD COLUMN IF NOT EXISTS alerts_enabled boolean NOT NULL DEFAULT true;