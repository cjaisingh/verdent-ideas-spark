CREATE TABLE IF NOT EXISTS public.alert_cost_thresholds (
  job text PRIMARY KEY,
  cost_per_run_usd numeric(10,4),
  cost_per_day_usd numeric(10,4),
  alert_on_cost boolean NOT NULL DEFAULT true,
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.alert_cost_thresholds ENABLE ROW LEVEL SECURITY;

CREATE POLICY "operators read alert_cost_thresholds"
  ON public.alert_cost_thresholds FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'operator'::app_role));

CREATE POLICY "operators write alert_cost_thresholds"
  ON public.alert_cost_thresholds FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'operator'::app_role))
  WITH CHECK (public.has_role(auth.uid(), 'operator'::app_role));

CREATE TRIGGER trg_alert_cost_thresholds_updated
  BEFORE UPDATE ON public.alert_cost_thresholds
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

ALTER PUBLICATION supabase_realtime ADD TABLE public.alert_cost_thresholds;
ALTER TABLE public.alert_cost_thresholds REPLICA IDENTITY FULL;