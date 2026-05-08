ALTER TABLE public.alert_settings REPLICA IDENTITY FULL;
ALTER TABLE public.alert_cost_thresholds REPLICA IDENTITY FULL;
ALTER PUBLICATION supabase_realtime ADD TABLE public.alert_settings;