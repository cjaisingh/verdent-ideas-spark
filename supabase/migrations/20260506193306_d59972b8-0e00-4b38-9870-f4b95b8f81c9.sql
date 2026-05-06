ALTER TABLE public.roadmap_autolog_skips REPLICA IDENTITY FULL;
ALTER PUBLICATION supabase_realtime ADD TABLE public.roadmap_autolog_skips;