ALTER TABLE public.roadmap_autolog_settings REPLICA IDENTITY FULL;
ALTER PUBLICATION supabase_realtime ADD TABLE public.roadmap_autolog_settings;