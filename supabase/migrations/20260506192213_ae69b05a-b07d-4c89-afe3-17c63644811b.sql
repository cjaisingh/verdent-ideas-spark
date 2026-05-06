ALTER TABLE public.roadmap_autolog_settings
  ADD COLUMN IF NOT EXISTS source_lovable_agent boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS source_ai_gateway boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS source_awip_api boolean NOT NULL DEFAULT true;