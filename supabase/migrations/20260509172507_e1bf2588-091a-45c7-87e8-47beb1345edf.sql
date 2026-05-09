ALTER TABLE public.sentinel_findings REPLICA IDENTITY FULL;
ALTER TABLE public.automation_runs REPLICA IDENTITY FULL;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname='supabase_realtime' AND tablename='automation_runs') THEN
    EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE public.automation_runs';
  END IF;
END $$;